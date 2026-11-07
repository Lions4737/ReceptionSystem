-- Apply post-payment seating to older, unpaid calls without changing payment,
-- queue or call times. Retain each released reservation in the audit log.
INSERT INTO operations(id,actor,action,ticket_id,before_json,after_json,reason,created_at)
SELECT 'release-unpaid-seat:' || id || ':' || version,'migration','release-unpaid-seat',id,
  json_object('status',status,'paid',paid,'table_id',table_id,'seat',seat,'version',version),
  json_object('status',status,'paid',paid,'table_id',NULL,'seat',NULL,'version',version+1),
  '入金後に席を割り振る運用へ変更',CAST(strftime('%s','now') AS INTEGER)*1000
FROM tickets WHERE status='called' AND paid=0 AND (table_id IS NOT NULL OR seat IS NOT NULL);
--> statement-breakpoint
UPDATE tickets SET table_id=NULL,seat=NULL,version=version+1,
  last_op='release-unpaid-seat:' || id || ':' || version
WHERE status='called' AND paid=0 AND (table_id IS NOT NULL OR seat IS NOT NULL);
