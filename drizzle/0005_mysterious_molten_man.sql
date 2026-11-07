PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` text NOT NULL,
	`day` text NOT NULL,
	`nickname` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`queued_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`called_at` integer,
	`table_id` text,
	`seat` integer,
	`paid` integer DEFAULT 0 NOT NULL,
	`fee` integer NOT NULL,
	`minutes` integer NOT NULL,
	`initial_chips` integer NOT NULL,
	`final_chips` integer,
	`started_at` integer,
	`ends_at` integer,
	`finished_at` integer,
	`paused_ms` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`last_op` text NOT NULL,
	FOREIGN KEY (`table_id`) REFERENCES `game_tables`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "valid_seat" CHECK("__new_tickets"."seat" IS NULL OR "__new_tickets"."seat" BETWEEN 1 AND 9),
	CONSTRAINT "valid_kind" CHECK("__new_tickets"."kind" IN ('beginner','expert')),
	CONSTRAINT "valid_status" CHECK("__new_tickets"."status" IN ('waiting','called','seated','playing','finished','hold','cancelled')),
	CONSTRAINT "assigned_seat" CHECK("__new_tickets"."status" NOT IN ('seated','playing') OR ("__new_tickets"."table_id" IS NOT NULL AND "__new_tickets"."seat" IS NOT NULL)),
	CONSTRAINT "nonnegative_score" CHECK("__new_tickets"."final_chips" IS NULL OR "__new_tickets"."final_chips" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_tickets`("id", "player_id", "day", "nickname", "kind", "status", "queued_at", "created_at", "called_at", "table_id", "seat", "paid", "fee", "minutes", "initial_chips", "final_chips", "started_at", "ends_at", "finished_at", "paused_ms", "version", "last_op") SELECT "id", "player_id", "day", "nickname", "kind", "status", "queued_at", "created_at", "called_at", "table_id", "seat", "paid", "fee", "minutes", "initial_chips", "final_chips", "started_at", "ends_at", "finished_at", "paused_ms", "version", "last_op" FROM `tickets`;--> statement-breakpoint
DROP TABLE `tickets`;--> statement-breakpoint
ALTER TABLE `__new_tickets` RENAME TO `tickets`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
CREATE INDEX `idx_tickets_queue` ON `tickets` (`day`,`kind`,`status`,`queued_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_tickets_player` ON `tickets` (`player_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_ticket_per_player` ON `tickets` (`player_id`) WHERE "tickets"."status" IN ('waiting','called','seated','playing','hold');--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_player_per_seat` ON `tickets` (`table_id`,`seat`) WHERE "tickets"."status" IN ('called','seated','playing');