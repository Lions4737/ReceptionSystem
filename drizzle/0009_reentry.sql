ALTER TABLE `settings` ADD `reentry_fee_beginner` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `reentry_fee_expert` integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `reentry_chips_beginner` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `reentry_chips_expert` integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE `tickets` ADD `reentry_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tickets` ADD `reentry_chips` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Keep the CSV backup in step with re-entry counts and added chips.
DROP TRIGGER save_ticket_csv_on_update;
--> statement-breakpoint
DROP VIEW ticket_csv_source;
--> statement-breakpoint
CREATE VIEW ticket_csv_source AS
SELECT t.id AS ticket_id, (
  SELECT group_concat(csv_cell, ',')
  FROM (
    SELECT '"' || CASE WHEN substr(value, 1, 1) IN ('=', '+', '@', '-', char(9), char(13))
      THEN '''' ELSE '' END || replace(coalesce(value, ''), '"', '""') || '"' AS csv_cell
    FROM json_each(json_array(
      t.day,
      CASE t.kind WHEN 'beginner' THEN 'B' WHEN 'expert' THEN 'E' ELSE 'T' END || '-' || printf('%03d', t.id),
      t.nickname, t.kind, t.status, t.table_id, t.seat, t.paid, t.fee,
      CASE WHEN t.started_at <> 0 THEN strftime('%Y-%m-%dT%H:%M:%fZ', t.started_at / 1000.0, 'unixepoch') END,
      CASE WHEN t.ends_at <> 0 THEN strftime('%Y-%m-%dT%H:%M:%fZ', t.ends_at / 1000.0, 'unixepoch') END,
      CASE WHEN t.finished_at <> 0 THEN strftime('%Y-%m-%dT%H:%M:%fZ', t.finished_at / 1000.0, 'unixepoch') END,
      t.initial_chips, t.final_chips, t.reentry_count, t.reentry_chips
    ))
    ORDER BY key
  )
) AS csv_row
FROM tickets AS t;
--> statement-breakpoint
INSERT OR REPLACE INTO ticket_csv_backup SELECT * FROM ticket_csv_source;
--> statement-breakpoint
CREATE TRIGGER save_ticket_csv_on_update AFTER UPDATE OF day, nickname, kind, status, table_id, seat, paid, fee, started_at, ends_at, finished_at, initial_chips, final_chips, reentry_count, reentry_chips ON tickets
BEGIN
  INSERT OR REPLACE INTO ticket_csv_backup SELECT * FROM ticket_csv_source WHERE ticket_id = NEW.id;
END;
