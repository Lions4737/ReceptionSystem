import { env } from "cloudflare:workers";
import { AsyncLocalStorage } from 'node:async_hooks';

const bindings = env as unknown as {DB:D1Database;SETUP_KEY?:string;STAFF_PASSWORD?:string};
const eventScope = new AsyncLocalStorage<string>();

export const eventTables = new Set([
  'attempts', 'invites', 'operations', 'payments', 'sessions', 'settings',
  'game_tables', 'tickets', 'player_recovery', 'ticket_csv_backup', 'ticket_csv_source',
]);

// Match whole SQL identifiers, leaving string literals and comments intact.
export function namespaceSql(sql: string, namespace: string, names = eventTables) {
  if (!namespace) return sql;
  if (!/^evt_[a-f0-9]{32}_$/.test(namespace)) throw new Error('Invalid event namespace');
  return sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]+`|\[[^\]]+\]|\b[a-zA-Z_][a-zA-Z_0-9]*\b/g, token => {
    const quoted = /^["`\[]/.test(token);
    const name = quoted ? token.slice(1, -1) : token;
    return names.has(name.toLowerCase()) ? '"' + namespace + name.toLowerCase() + '"' : token;
  });
}

export function baseDatabase(): D1Database {
  if (!bindings.DB) throw new Error("D1 binding unavailable");
  return bindings.DB;
}

export function scopedDatabase(db: D1Database, namespace: string): Pick<D1Database, 'prepare' | 'batch'> {
  if (!namespace) return db;
  return {
    prepare: (sql: string) => db.prepare(namespaceSql(sql, namespace)),
    batch: db.batch.bind(db),
  };
}

export function currentNamespace() { return eventScope.getStore() ?? ''; }

export function withEvent<T>(namespace: string, callback: () => T) {
  return eventScope.run(namespace, callback);
}

export function database() { return scopedDatabase(baseDatabase(), currentNamespace()); }
export function setupKey(): string { return bindings.SETUP_KEY ?? ""; }
export function staffPassword(): string { return bindings.STAFF_PASSWORD ?? ""; }
