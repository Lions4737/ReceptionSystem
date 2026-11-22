-- Beginner lecture flag (初心者講習中) for a paid, called beginner before seat
-- assignment. Shared across events like event_reentry_settings: event tables
-- are copied per namespace, so adding a column to tickets would not reach
-- events created earlier.
CREATE TABLE ticket_lectures (
  event_namespace TEXT NOT NULL,
  ticket_id INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  PRIMARY KEY (event_namespace, ticket_id)
);
