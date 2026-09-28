CREATE TABLE `local_profile` (
	`id` text PRIMARY KEY DEFAULT 'local' NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "local_profile_one_row" CHECK("local_profile"."id" = 'local')
);
