// Paid tickets can still be marked "called" while waiting for a seat.
const eligible = "status = 'called' AND paid = 0 AND called_at <= ?";

export function autoHoldStatements(db: D1Database, now: number): D1PreparedStatement[] {
  const cutoff = now - 60 * 60 * 1000;
  const operationPrefix = crypto.randomUUID() + '-';
  return [
    db.prepare(`
      INSERT INTO operations (id, actor, action, ticket_id, before_json, after_json, reason, created_at)
      SELECT ? || id, 'system', 'hold', id,
        json_object('status', status, 'table_id', table_id, 'seat', seat, 'version', version),
        json_object('status', 'hold', 'table_id', NULL, 'seat', NULL, 'version', version + 1),
        '呼び出しから1時間経過', ?
      FROM tickets WHERE ${eligible}
    `).bind(operationPrefix, now, cutoff),
    db.prepare(`
      UPDATE tickets SET status = 'hold', table_id = NULL, seat = NULL,
        version = version + 1, last_op = ? || id
      WHERE ${eligible}
    `).bind(operationPrefix, cutoff),
  ];
}
