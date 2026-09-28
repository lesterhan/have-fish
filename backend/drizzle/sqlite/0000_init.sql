CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `account_coverage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`from_date` text NOT NULL,
	`through_date` text NOT NULL,
	`source` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_coverage_range_ordered" CHECK("account_coverage"."from_date" <= "account_coverage"."through_date"),
	CONSTRAINT "account_coverage_source_valid" CHECK("account_coverage"."source" IN ('import', 'reconcile', 'manual', 'empty'))
);
--> statement-breakpoint
CREATE INDEX `account_coverage_user_account_from_idx` ON `account_coverage` (`user_id`,`account_id`,`from_date`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`path` text NOT NULL,
	`path_key` text NOT NULL,
	`name` text,
	`default_currency` text,
	`type` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_user_path_key_idx` ON `accounts` (`user_id`,`path_key`) WHERE "accounts"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `csv_parsers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_header` text NOT NULL,
	`column_mapping` text NOT NULL,
	`default_account_id` text,
	`is_multi_currency` integer DEFAULT false NOT NULL,
	`default_fee_account_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_fee_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `expense_group_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`invited_by_user_id` text NOT NULL,
	`invitee_email` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`group_id`) REFERENCES `expense_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `expense_group_invites_group_id_idx` ON `expense_group_invites` (`group_id`);--> statement-breakpoint
CREATE INDEX `expense_group_invites_invitee_email_idx` ON `expense_group_invites` (`invitee_email`);--> statement-breakpoint
CREATE TABLE `expense_group_members` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`share_weight` integer DEFAULT 1 NOT NULL,
	`default_expense_account_id` text,
	`default_payment_account_id` text,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `expense_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_expense_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_payment_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `expense_group_members_user_id_idx` ON `expense_group_members` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `expense_group_members_group_id_user_id_unique` ON `expense_group_members` (`group_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `expense_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`default_currency` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`base_currency` text NOT NULL,
	`quote_currency` text NOT NULL,
	`rate` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `group_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `expense_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `group_categories_group_id_idx` ON `group_categories` (`group_id`);--> statement-breakpoint
CREATE TABLE `group_category_member_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `group_categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_category_member_accounts_category_id_user_id_unique` ON `group_category_member_accounts` (`category_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `group_category_weights` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`user_id` text NOT NULL,
	`weight` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `group_categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_category_weights_category_id_user_id_unique` ON `group_category_weights` (`category_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `group_expense_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_id` text NOT NULL,
	`user_id` text NOT NULL,
	`amount` text NOT NULL,
	FOREIGN KEY (`expense_id`) REFERENCES `group_expenses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_expense_splits_expense_id_user_id_unique` ON `group_expense_splits` (`expense_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `group_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`category_id` text,
	`paid_by_user_id` text NOT NULL,
	`description` text NOT NULL,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`date` text NOT NULL,
	`transaction_id` text,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`group_id`) REFERENCES `expense_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `group_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`paid_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `group_expenses_group_id_idx` ON `group_expenses` (`group_id`);--> statement-breakpoint
CREATE INDEX `group_expenses_category_id_idx` ON `group_expenses` (`category_id`);--> statement-breakpoint
CREATE TABLE `group_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`settled_amount` text,
	`settled_currency` text,
	`fx_rate` text,
	`batch_id` text,
	`date` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`payer_account_id` text,
	`payer_transaction_id` text,
	`receiver_transaction_id` text,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`group_id`) REFERENCES `expense_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payer_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payer_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`receiver_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `group_settlements_group_id_idx` ON `group_settlements` (`group_id`);--> statement-breakpoint
CREATE INDEX `group_settlements_batch_id_idx` ON `group_settlements` (`batch_id`);--> statement-breakpoint
CREATE TABLE `import_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pattern` text NOT NULL,
	`account_id` text,
	`group_id` text,
	`category_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`match_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `expense_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `group_categories`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "import_rules_one_target" CHECK(("import_rules"."account_id" IS NOT NULL AND "import_rules"."group_id" IS NULL AND "import_rules"."category_id" IS NULL)
        OR ("import_rules"."account_id" IS NULL AND "import_rules"."group_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `postings` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`account_id` text NOT NULL,
	`amount` text NOT NULL,
	`currency` text DEFAULT 'CAD' NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `postings_transaction_id_idx` ON `postings` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `postings_account_id_idx` ON `postings` (`account_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`description` text,
	`group_expense_id` text,
	`import_fingerprint` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_user_import_fingerprint_idx` ON `transactions` (`user_id`,`import_fingerprint`) WHERE "transactions"."import_fingerprint" is not null;--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`default_offset_account_id` text,
	`default_conversion_account_id` text,
	`default_assets_root_path` text DEFAULT 'assets' NOT NULL,
	`default_liabilities_root_path` text DEFAULT 'liabilities' NOT NULL,
	`default_expenses_root_path` text DEFAULT 'expenses' NOT NULL,
	`default_equity_root_path` text DEFAULT 'equity' NOT NULL,
	`default_income_root_path` text DEFAULT 'income' NOT NULL,
	`default_adjustments_account_id` text,
	`preferred_currency` text DEFAULT 'CAD' NOT NULL,
	`preferences` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_offset_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_conversion_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_adjustments_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
