/// <reference types="@cloudflare/workers-types" />
declare module "cloudflare:workers" {
  export const env: { DB: D1Database; SETUP_KEY?: string; STAFF_PASSWORD?: string };
}
