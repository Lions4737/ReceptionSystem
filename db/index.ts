import { env } from "cloudflare:workers";
const bindings = env as unknown as {DB:D1Database;SETUP_KEY?:string;STAFF_PASSWORD?:string};
export function database(): D1Database {
  if (!bindings.DB) throw new Error("D1 binding unavailable");
  return bindings.DB;
}
export function setupKey(): string { return bindings.SETUP_KEY ?? ""; }
export function staffPassword(): string { return bindings.STAFF_PASSWORD ?? ""; }
