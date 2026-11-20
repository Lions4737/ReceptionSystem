import { database } from '../db';
import { HttpError } from './auth';
import { assignedStatuses, manualStatuses, manualStatusIssue, manualStatusPaid } from './manual-status';
import { type GameTable, type Session, type Status, type Ticket } from './types';

export async function statusCorrection(ticket: Ticket, body: Record<string, unknown>, staff: Session, now: number) {
  const target = body.status as Status;
  if (!manualStatuses.includes(target)) throw new HttpError(400, 'ステータスを選んでください。');
  const issue = manualStatusIssue(ticket, target, staff.role);
  if (issue) throw new HttpError(409, issue);
  const moving = ticket.status === target && (target === 'seated' || target === 'playing') &&
    (body.table !== undefined || body.seat !== undefined);
  if (moving && target === 'playing' && staff.role !== 'admin') throw new HttpError(403, 'プレイ中の席の変更は責任者が行ってください。');
  if (ticket.status === target && !moving) throw new HttpError(409, '現在と異なるステータスを選んでください。');
  if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 200)) throw new HttpError(400, '変更メモは200文字以内で入力してください。');
  const db = database();
  // A refunded ticket cannot be charged again under the one-payment-per-ticket model.
  if (ticket.status === 'cancelled' && await db.prepare("SELECT id FROM payments WHERE ticket_id=? AND type='refund'").bind(ticket.id).first()) throw new HttpError(409, '返金済みの受付は戻せません。新しい受付を登録してください。');

  const changes: Record<string, string | number | null> = moving ? {} : { status: target, paid: manualStatusPaid(ticket,target) };
  let table: GameTable | null = null;
  if (target === 'called') {
    Object.assign(changes, { table_id: null, seat: null, called_at: now, started_at: null, ends_at: null, finished_at: null, final_chips: null, paused_ms: 0 });
  } else if (assignedStatuses.includes(target)) {
    if (typeof body.table !== 'string' || !body.table) throw new HttpError(400, '案内するテーブルを選んでください。');
    table = await db.prepare('SELECT * FROM game_tables WHERE id=? AND archived_at IS NULL').bind(body.table).first<GameTable>();
    const keepsSeat = !!table && assignedStatuses.includes(ticket.status) && ticket.table_id === table.id && ticket.seat === body.seat;
    if (!table || table.kind !== ticket.kind || (table.paused_at !== null && !(target === 'seated' && keepsSeat))) throw new HttpError(409, '対象が一致し、一時停止していないテーブルを選んでください。');
    if (moving && keepsSeat) throw new HttpError(409, '別の席を選んでください。');
    if (moving && target === 'playing' && !await db.prepare('SELECT id FROM game_tables WHERE id=? AND paused_at IS NULL AND archived_at IS NULL').bind(ticket.table_id).first()) {
      throw new HttpError(409, '移動元のテーブルを再開してから席を変更してください。');
    }
    if (table.assignment_locked && !keepsSeat) throw new HttpError(409, 'このテーブルは割り振りロック中です。別のテーブルを選んでください。');
    if (typeof body.seat !== 'number' || !Number.isInteger(body.seat) || body.seat < 1 || body.seat > table.seat_count) throw new HttpError(400, '席番号を確認してください。');
    if (await db.prepare("SELECT id FROM tickets WHERE table_id=? AND seat=? AND status IN ('called','seated','playing') AND id<>?").bind(table.id, body.seat, ticket.id).first()) throw new HttpError(409, 'その席は使用中です。別の席を選んでください。');
    if (moving) return { changes: { table_id: table.id, seat: body.seat }, table };
    Object.assign(changes, { table_id: table.id, seat: body.seat, called_at: now, started_at: null, ends_at: null, finished_at: null, final_chips: null, paused_ms: 0 });
    if (target === 'playing') Object.assign(changes, { started_at: now, ends_at: now + ticket.minutes * 60000 });
  } else if (target === 'finished') {
    if (typeof body.score !== 'number' || !Number.isInteger(body.score) || body.score < 0 || body.score > 10000000) throw new HttpError(400, '最終チップ数を入力してください（0点も入力できます）。');
    table = ticket.table_id ? await db.prepare('SELECT * FROM game_tables WHERE id=? AND archived_at IS NULL').bind(ticket.table_id).first<GameTable>() : null;
    Object.assign(changes, { finished_at: now, final_chips: body.score, paused_ms: ticket.paused_ms + (ticket.status === 'playing' && table && table.paused_at !== null ? Math.max(0, now - table.paused_at) : 0) });
  } else {
    Object.assign(changes, { table_id: null, seat: null, called_at: null, started_at: null, ends_at: null, finished_at: null, final_chips: null, paused_ms: 0 });
    if (target === 'waiting') changes.queued_at = now;
  }
  // Guard table configuration and pause/resume changes in the same ticket write.
  // Seat and active-ticket uniqueness are additionally enforced by the DB indexes.
  return { changes, table };
}
