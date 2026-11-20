import { baseDatabase, eventTables, namespaceSql, scopedDatabase } from '@/db';
import { LEGACY_EVENT_SLUG } from './event-path';
import { HttpError } from './auth';
import { MAX_EVENT_TITLE_LENGTH } from './branding';

export type FestivalEvent = { slug: string; namespace: string; enabled: number };

export async function findEvent(slug: string) {
  return baseDatabase().prepare('SELECT slug, namespace, enabled FROM events WHERE slug=?').bind(slug).first<FestivalEvent>();
}

export async function listEvents(db = baseDatabase()) {
  return (await db.prepare('SELECT slug, namespace, enabled FROM events ORDER BY rowid').all<FestivalEvent>()).results;
}

export async function eventTitle(event: FestivalEvent) {
  const row = await scopedDatabase(baseDatabase(), event.namespace)
    .prepare('SELECT event_name FROM settings WHERE id=1').first<{event_name: string}>();
  return row?.event_name;
}

export async function createEvent(name: unknown, slug: unknown) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_EVENT_TITLE_LENGTH) {
    throw new HttpError(400, 'イベント名を入力してください（80文字以内）。');
  }
  if (typeof slug !== 'string' || !/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/.test(slug) || slug.length > 48) {
    throw new HttpError(400, 'URL名は半角英字・数字・ハイフンで入力してください（48文字以内）。');
  }
  const db = baseDatabase();
  if (slug === LEGACY_EVENT_SLUG || await findEvent(slug)) throw new HttpError(409, 'そのURL名はすでに使われています。');
  const namespace = 'evt_' + crypto.randomUUID().replaceAll('-', '') + '_';
  // Copy only the schema, including constraints, indexes and CSV backup triggers.
  const schema = (await db.prepare(`
    SELECT name, tbl_name, sql FROM sqlite_master
    WHERE sql IS NOT NULL AND tbl_name IN (${[...eventTables].map(() => '?').join(',')})
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END
  `).bind(...eventTables).all<{name: string; sql: string}>()).results
  const names = new Set([...eventTables, ...schema.map(row => row.name)]);
  await db.batch([
    db.prepare('INSERT INTO events (slug, namespace, enabled) VALUES (?, ?, 0)').bind(slug, namespace),
    ...schema.map(row => db.prepare(namespaceSql(row.sql, namespace, names))),
    scopedDatabase(db, namespace).prepare('INSERT INTO settings (id, event_name) VALUES (1, ?)').bind(name.trim()),
  ]);
  return slug;
}
