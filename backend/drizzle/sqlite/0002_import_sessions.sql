CREATE TABLE `import_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`file_hash` text NOT NULL,
	`file_name` text NOT NULL,
	`version` integer NOT NULL,
	`row_count` integer NOT NULL,
	`payload` text NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_sessions_user_id_file_hash_unique` ON `import_sessions` (`user_id`,`file_hash`);