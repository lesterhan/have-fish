ALTER TABLE "import_rules" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "import_rules" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "import_rules" ADD COLUMN "category_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_rules" ADD CONSTRAINT "import_rules_group_id_expense_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."expense_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_rules" ADD CONSTRAINT "import_rules_category_id_group_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."group_categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
