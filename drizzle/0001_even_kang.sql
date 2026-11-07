CREATE TABLE `player_recovery` (
	`hash` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
