CREATE TABLE `attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`hash` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`table_id` text,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`ticket_id` integer,
	`before_json` text,
	`after_json` text,
	`reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_operations_created` ON `operations` (`created_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL,
	`actor` text NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_payments_ticket` ON `payments` (`ticket_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_payment_type_per_ticket` ON `payments` (`ticket_id`,`type`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`table_id` text,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_expiry` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`fee` integer DEFAULT 500 NOT NULL,
	`minutes` integer DEFAULT 30 NOT NULL,
	`chips` integer DEFAULT 1000 NOT NULL,
	`beginner_open` integer DEFAULT 1 NOT NULL,
	`expert_open` integer DEFAULT 1 NOT NULL,
	`event_name` text DEFAULT 'POKER FESTIVAL' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`paused_at` integer,
	`version` integer DEFAULT 0 NOT NULL,
	`last_op` text
);
--> statement-breakpoint
CREATE TABLE `tickets` (
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
	CONSTRAINT "valid_seat" CHECK("tickets"."seat" IS NULL OR "tickets"."seat" BETWEEN 1 AND 9),
	CONSTRAINT "valid_kind" CHECK("tickets"."kind" IN ('beginner','expert')),
	CONSTRAINT "valid_status" CHECK("tickets"."status" IN ('waiting','called','seated','playing','finished','hold','cancelled')),
	CONSTRAINT "assigned_seat" CHECK("tickets"."status" NOT IN ('called','seated','playing') OR ("tickets"."table_id" IS NOT NULL AND "tickets"."seat" IS NOT NULL)),
	CONSTRAINT "nonnegative_score" CHECK("tickets"."final_chips" IS NULL OR "tickets"."final_chips" >= 0)
);
--> statement-breakpoint
CREATE INDEX `idx_tickets_queue` ON `tickets` (`day`,`kind`,`status`,`queued_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_tickets_player` ON `tickets` (`player_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_ticket_per_player` ON `tickets` (`player_id`) WHERE "tickets"."status" IN ('waiting','called','seated','playing','hold');--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_player_per_seat` ON `tickets` (`table_id`,`seat`) WHERE "tickets"."status" IN ('called','seated','playing');--> statement-breakpoint
INSERT INTO settings(id) VALUES(1);
--> statement-breakpoint
INSERT INTO game_tables(id,name,kind) VALUES('A','テーブル A','expert'),('B','テーブル B','beginner'),('C','テーブル C','beginner');
