import { database } from '../db';
import { HttpError, response } from './auth';
import { planTableMoves } from './table-moves';
import type { GameTable, Session, Ticket } from './types';

const occupied = "status IN ('called','seated','playing')";
const changed = '卓や席の状態が変わりました。移動先を確認し直してください。';

export async function emptyTable(source: GameTable, body: Record<string, unknown>, staff: Session, op: string) {
  const db = database();
  const [tableRows, ticketRows] = await db.batch([
    db.prepare('SELECT * FROM game_tables WHERE archived_at IS NULL'),
    db.prepare(`SELECT * FROM tickets WHERE ${occupied}`),
  ]);
  const tables = tableRows.results as unknown as GameTable[];
  const tickets = ticketRows.results as unknown as Ticket[];
  const plan = planTableMoves(source, tables, tickets);
  if (!plan.occupants.length) throw new HttpError(409, 'この卓はすでに空です。');
  if (plan.available < plan.occupants.length) throw new HttpError(409,
    `同じ対象タグの他の卓に空席が${plan.available}席しかありません。あと${plan.occupants.length - plan.available}席必要です。ロック中の卓は移動先に含みません。`);
  const requested = body.moves;
  if (!Array.isArray(requested) || requested.length !== plan.moves.length || plan.moves.some((move, i) => {
    const value = requested[i];
    return !value || typeof value !== 'object' || Object.entries(move).some(([key, v]) => value[key] !== v);
  })) throw new HttpError(409, changed);

  const now = Date.now();
  const afterTable = { ...source, assignment_locked: 1, paused_at: null, version: source.version + 1, last_op: op };
  const afterTickets = plan.moves.map(move => {
    const ticket = plan.occupants.find(t => t.id === move.ticket_id)!;
    const destination = tables.find(table => table.id === move.table_id)!;
    // Preserve remaining time on the destination clock. On resume its full
    // pause duration is added, so the transfer offsets time before arrival.
    const clockDelta = ticket.status === 'playing'
      ? (destination.paused_at ?? now) - (source.paused_at ?? now) : 0;
    return { ...ticket, table_id: move.table_id, seat: move.seat, version: ticket.version + 1, last_op: op,
      ends_at: ticket.ends_at === null ? null : ticket.ends_at + clockDelta,
      paused_ms: ticket.paused_ms + clockDelta };
  });
  // The first write validates every source ticket and destination seat. D1 batches
  // are transactional: nobody moves (and the source stays open) if any guard fails.
  // The source version also invalidates concurrent assignments that read it before locking.
  const statements = [
    db.prepare(`WITH moves AS (SELECT value FROM json_each(?))
      UPDATE game_tables SET assignment_locked=1,paused_at=NULL,version=version+1,last_op=?
      WHERE id=? AND version=? AND archived_at IS NULL
        AND (SELECT COUNT(*) FROM tickets WHERE table_id=game_tables.id AND ${occupied})=?
        AND NOT EXISTS (
          SELECT 1 FROM moves m
          WHERE NOT EXISTS (SELECT 1 FROM tickets t WHERE t.id=json_extract(m.value,'$.ticket_id')
            AND t.version=json_extract(m.value,'$.ticket_version') AND t.table_id=game_tables.id AND t.${occupied})
          OR NOT EXISTS (SELECT 1 FROM game_tables dest WHERE dest.id=json_extract(m.value,'$.table_id')
            AND dest.version=json_extract(m.value,'$.table_version') AND dest.kind=game_tables.kind
            AND dest.archived_at IS NULL AND dest.assignment_locked=0
            AND json_extract(m.value,'$.seat') BETWEEN 1 AND dest.seat_count)
          OR EXISTS (SELECT 1 FROM tickets used WHERE used.table_id=json_extract(m.value,'$.table_id')
            AND used.seat=json_extract(m.value,'$.seat') AND used.${occupied})
        )`).bind(JSON.stringify(plan.moves), op, source.id, source.version, plan.occupants.length),
    ...afterTickets.map(ticket => db.prepare(`UPDATE tickets SET table_id=?,seat=?,
      ends_at=?,paused_ms=?,
      version=version+1,last_op=?
      WHERE id=? AND EXISTS(SELECT 1 FROM game_tables WHERE id=? AND version=? AND last_op=?)`)
      .bind(ticket.table_id, ticket.seat, ticket.ends_at, ticket.paused_ms, op, ticket.id, source.id, source.version + 1, op)),
    db.prepare(`INSERT INTO operations(id,actor,action,before_json,after_json,reason,created_at)
      SELECT ?,?,'table_empty',?,?,?,? FROM game_tables WHERE id=? AND version=? AND last_op=?`)
      .bind(op, staff.user_id, JSON.stringify({ table: source, tickets: plan.occupants }),
        JSON.stringify({ table: afterTable, tickets: afterTickets }),
        `${source.name}の${plan.occupants.length}人を他の卓へ移動`, now, source.id, source.version + 1, op),
  ];
  try {
    const results = await db.batch(statements);
    if (!results[0].meta.changes) throw new HttpError(409, changed);
  } catch (error) {
    // A simultaneous retry may have committed the same operation while this
    // request was planning. The unique operation ID rolls the retry back.
    const previous = await db.prepare('SELECT actor,action FROM operations WHERE id=?').bind(op).first<{ actor: string; action: string }>();
    if (previous?.actor === staff.user_id && previous.action === 'table_empty') return response({ ok: true });
    throw error;
  }
  return response({ ok: true });
}
