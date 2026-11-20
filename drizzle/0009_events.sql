CREATE TABLE events (
  slug TEXT PRIMARY KEY NOT NULL,
  namespace TEXT UNIQUE NOT NULL
);
--> statement-breakpoint
INSERT INTO events (slug, namespace) VALUES ('komaba-festival', '');
