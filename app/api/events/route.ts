import { baseDatabase } from '@/db';
import { failure, HttpError, payload, requireRole, requireStaff, response } from '@/lib/auth';
import { createEvent } from '@/lib/events';

export async function POST(request: Request) {
  try {
    requireRole(await requireStaff(request), ['admin', 'operator']);
    const {name, slug} = await payload(request);
    return response({slug: await createEvent(name, slug)}, 201);
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    requireRole(await requireStaff(request), ['admin']);
    const {slug, enabled} = await payload(request);
    if (typeof slug !== 'string' || typeof enabled !== 'boolean') {
      throw new HttpError(400, 'イベントと利用可否を指定してください。');
    }
    const result = await baseDatabase().prepare('UPDATE events SET enabled=? WHERE slug=?')
      .bind(Number(enabled), slug).run();
    if (!result.meta.changes) throw new HttpError(404, 'イベントが見つかりません。');
    return response({ok: true});
  } catch (error) {
    return failure(error);
  }
}
