/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { scopedDatabase, withEvent } from "../db";
import { findEvent, listEvents } from "../lib/events";
import { DEFAULT_EVENT_SLUG, LEGACY_EVENT_SLUG, eventPath } from "../lib/event-path";
import { autoHoldStatements } from "../lib/auto-hold";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

function unavailableEvent() {
  return Response.json({error: 'このイベントは現在利用できません。'}, {
    status: 403,
    headers: {'Cache-Control': 'no-store'},
  });
}

const worker = {
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = Date.now();
    await Promise.all((await listEvents(env.DB)).filter(event => event.enabled).map(event =>
      env.DB.batch(autoHoldStatements(scopedDatabase(env.DB, event.namespace), now))));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (/^\/(?:join|me|restore|display)\/?$/.test(url.pathname) || /^\/staff(?:\/|$)/.test(url.pathname)) {
      url.pathname = eventPath(url.pathname);
      return Response.redirect(url, 307);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    const slug = url.pathname.match(/^\/event\/([^/]+)(?:\/|$)/)?.[1];
    if (slug === LEGACY_EVENT_SLUG) {
      url.pathname = eventPath(url.pathname.slice(('/event/' + slug).length));
      return Response.redirect(url, 307);
    }
    if (slug) {
      const event = await findEvent(slug);
      if (!event) return new Response('イベントが見つかりません。', { status: 404 });
      const eventRoute = url.pathname.slice(('/event/' + slug).length).replace(/\/$/, '');
      if (!event.enabled && !['/staff/login', '/api/login', '/api/logout'].includes(eventRoute)) {
        if (/^\/staff(?:\/|$)/.test(eventRoute)) return Response.redirect(new URL('/event', url), 307);
        return unavailableEvent();
      }
      return withEvent(event.namespace, () => handler.fetch(request, env, ctx));
    }

    if (url.pathname.startsWith('/api/') && !['/api/events', '/api/login', '/api/logout'].includes(url.pathname.replace(/\/$/, ''))) {
      if (!(await findEvent(DEFAULT_EVENT_SLUG))?.enabled) return unavailableEvent();
    }
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
