ALTER TABLE `settings` ADD `auto_assign_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `game_tables` ADD `assignment_locked` integer DEFAULT 0 NOT NULL;