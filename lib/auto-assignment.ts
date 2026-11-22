import { currentNamespace, database } from '../db';
import { HttpError, response } from './auth';
import { MAX_TABLE_SEATS, type Session, type Ticket } from './types';

// Choose and reserve a seat in one write. The caller chooses the person; the
// server chooses a matching table using live occupancy after payment, when they are guided to their seat.
// Draw the table first so a larger table does not get extra chances just because
// it has more empty seats. Materialize both draws to keep the table/seat paired.
export async function autoSeatTicket(ticket: Ticket, staff: Session, op: string, now: number) {
  const db = database();
  const results = await db.batch([
    db.prepare(`WITH RECURSIVE numbers(seat) AS (
      SELECT 1 UNION ALL SELECT seat+1 FROM numbers WHERE seat<?
    ), table_load AS MATERIALIZED (
      SELECT g.id,g.seat_count,COUNT(t.id) AS used_count,
        SUM(CASE WHEN t.seat BETWEEN 1 AND 4 THEN 1 WHEN t.seat BETWEEN 6 AND 9 THEN -1 ELSE 0 END) AS balance
      FROM game_tables g
      LEFT JOIN tickets t ON t.table_id=g.id AND t.status IN ('called','seated','playing')
      WHERE g.kind=? AND g.archived_at IS NULL AND g.paused_at IS NULL AND g.assignment_locked=0
      GROUP BY g.id,g.seat_count
    ), candidates AS MATERIALIZED (
      SELECT g.id AS table_id,g.used_count,g.balance,n.seat,
        g.balance + CASE WHEN n.seat BETWEEN 1 AND 4 THEN 1 WHEN n.seat BETWEEN 6 AND 9 THEN -1 ELSE 0 END AS next_balance
      FROM table_load g JOIN numbers n ON n.seat<=g.seat_count
      WHERE NOT EXISTS(SELECT 1 FROM tickets t WHERE t.table_id=g.id AND t.seat=n.seat AND t.status IN ('called','seated','playing'))
    ), eligible AS MATERIALIZED (
      SELECT * FROM candidates WHERE abs(next_balance)<=2 OR abs(next_balance)<abs(balance)
    ), selected_table AS MATERIALIZED (
      SELECT table_id FROM eligible GROUP BY table_id,used_count
      ORDER BY used_count,random() LIMIT 1
    ), allocation AS MATERIALIZED (
      SELECT table_id,seat FROM eligible
      WHERE table_id=(SELECT table_id FROM selected_table)
      ORDER BY seat IN (1,9), abs(next_balance), random() LIMIT 1
    )
    UPDATE tickets SET status='seated',
      table_id=(SELECT table_id FROM allocation),seat=(SELECT seat FROM allocation),
      version=version+1,last_op=?
    WHERE id=? AND version=? AND status='called' AND paid=1 AND EXISTS(SELECT 1 FROM allocation)`)
      .bind(MAX_TABLE_SEATS, ticket.kind, op, ticket.id, ticket.version),
    db.prepare(`INSERT INTO operations(id,actor,action,ticket_id,before_json,after_json,created_at)
      SELECT ?,?,'auto-assign',id,?,
        json_object('status',status,'table_id',table_id,'seat',seat,'called_at',called_at,'version',version),?
      FROM tickets WHERE id=? AND last_op=?`)
      .bind(op, staff.user_id, JSON.stringify(ticket), now, ticket.id, op),
    // Seating ends the beginner lecture (shared table, see drizzle/0014).
    db.prepare('DELETE FROM ticket_lectures WHERE event_namespace=? AND ticket_id=? AND EXISTS(SELECT 1 FROM tickets WHERE id=? AND last_op=?)')
      .bind(currentNamespace(), ticket.id, ticket.id, op),
  ]);
  if (!results[0].meta.changes) throw new HttpError(409, '左右の人数差の条件を満たす空席がないか、受付が更新されています。最新の状態を確認してください。');
  return response({ ok: true });
}
