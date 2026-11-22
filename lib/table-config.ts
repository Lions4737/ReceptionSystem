import { database } from '../db';
import { HttpError, operationId, requireRole, requireStaff, response } from './auth';
import { emptyTable } from './empty-table';
import { MAX_TABLE_NAME_LENGTH, MAX_TABLE_SEATS, type GameTable } from './types';

// Keep removed tables for historical tickets and allow their configuration to be reused.
const occupied = "status IN ('called','seated','playing')";

export async function configureTable(request: Request, body: Record<string, unknown>) {
  const staff = await requireStaff(request);
  requireRole(staff, ['admin', 'operator']);
  const db = database(), op = operationId(body);
  const previous = await db.prepare('SELECT actor FROM operations WHERE id=?').bind(op).first<{ actor: string }>();
  if (previous) {
    if (previous.actor !== staff.user_id) throw new HttpError(403, 'この操作を確認する権限がありません。');
    return response({ ok: true });
  }

  const action = body.action;
  if (!['create', 'update', 'archive', 'restore', 'lock', 'empty'].includes(String(action))) throw new HttpError(400, 'テーブルの操作を選んでください。');
  let before: GameTable | null = null;
  let id: string;
  if (action === 'create') {
    const ids = (await db.prepare('SELECT id FROM game_tables').all<{ id: string }>()).results;
    const used = new Set(ids.map(t => t.id));
    // A ... Z, AA ... AZ, BA ...; do not reuse IDs referenced by past tickets.
    let number = 0;
    do {
      let n = ++number;
      id = '';
      while (n > 0) { id = String.fromCharCode(65 + (n - 1) % 26) + id; n = Math.floor((n - 1) / 26); }
    } while (used.has(id));
  } else {
    if (typeof body.table !== 'string') throw new HttpError(400, 'テーブルを選んでください。');
    id = body.table;
    before = await db.prepare('SELECT * FROM game_tables WHERE id=?').bind(id).first<GameTable>();
    if (!before) throw new HttpError(404, 'テーブルが見つかりません。');
    if (before.version !== body.version) throw new HttpError(409, '他の端末で変更されています。最新の状態から編集し直してください。');
    if ((action === 'restore') !== (before.archived_at !== null)) throw new HttpError(409, 'テーブルの状態が変わっています。最新の状態を確認してください。');
  }

  if (action === 'empty') return emptyTable(before!, body, staff, op);

  let name = before?.name ?? '', kind = before?.kind ?? 'beginner', seats = before?.seat_count ?? MAX_TABLE_SEATS;
  if (action === 'lock' && typeof body.locked !== 'boolean') throw new HttpError(400, 'ロックの設定を確認してください。');
  if (action === 'create' || action === 'update') {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > MAX_TABLE_NAME_LENGTH) throw new HttpError(400, `テーブル名は1〜${MAX_TABLE_NAME_LENGTH}文字で入力してください。`);
    if (body.kind !== 'beginner' && body.kind !== 'expert') throw new HttpError(400, '対象を選んでください。');
    if (typeof body.seat_count !== 'number' || !Number.isInteger(body.seat_count) || body.seat_count < 1 || body.seat_count > MAX_TABLE_SEATS) throw new HttpError(400, `席数は1〜${MAX_TABLE_SEATS}席で入力してください。`);
    name = body.name.trim(); kind = body.kind; seats = body.seat_count;
  }

  const now = Date.now();
  let statement: D1PreparedStatement;
  if (action === 'create') {
    statement = db.prepare('INSERT INTO game_tables(id,name,kind,seat_count,last_op) VALUES(?,?,?,?,?)').bind(id, name, kind, seats, op);
  } else if (action === 'update') {
    // Recheck seat reservations in the same write: a concurrent call must not
    // place a guest on a seat that is being removed. Kind may change while occupied.
    statement = db.prepare(`UPDATE game_tables SET name=?,kind=?,seat_count=?,version=version+1,last_op=?
      WHERE id=? AND version=? AND archived_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM tickets WHERE table_id=game_tables.id AND ${occupied} AND seat>?)`)
      .bind(name, kind, seats, op, id, before!.version, seats);
  } else if (action === 'lock') {
    statement = db.prepare('UPDATE game_tables SET assignment_locked=?,version=version+1,last_op=? WHERE id=? AND version=? AND archived_at IS NULL')
      .bind(Number(body.locked), op, id, before!.version);
  } else if (action === 'archive') {
    statement = db.prepare(`UPDATE game_tables SET archived_at=?,paused_at=NULL,version=version+1,last_op=?
      WHERE id=? AND version=? AND archived_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM tickets WHERE table_id=game_tables.id AND ${occupied})`)
      .bind(now, op, id, before!.version);
  } else {
    statement = db.prepare('UPDATE game_tables SET archived_at=NULL,paused_at=NULL,version=version+1,last_op=? WHERE id=? AND version=? AND archived_at IS NOT NULL')
      .bind(op, id, before!.version);
  }
  const after = { id, name, kind, seat_count: seats, assignment_locked: action === 'lock' ? Number(body.locked) : before?.assignment_locked ?? 0, archived_at: action === 'archive' ? now : null };
  const results = await db.batch([
    statement,
    db.prepare('INSERT INTO operations(id,actor,action,before_json,after_json,created_at) SELECT ?,?,?,?,?,? FROM game_tables WHERE id=? AND last_op=?')
      .bind(op, staff.user_id, `table_${action}`, before ? JSON.stringify(before) : null, JSON.stringify(after), now, id, op),
  ]);
  if (!results[0].meta.changes) throw new HttpError(409, action === 'archive'
    ? '利用中のテーブルは削除できません。呼び出し・プレイが終了してからお試しください。'
    : '利用中の席は減らせず、利用中のテーブルの対象も変更できません。最新の状態を確認してください。');
  return response({ ok: true, table: id }, action === 'create' ? 201 : 200);
}
