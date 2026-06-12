CREATE TABLE IF NOT EXISTS "group_category_weights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"weight" integer NOT NULL,
	CONSTRAINT "group_category_weights_category_id_user_id_unique" UNIQUE("category_id","user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_category_weights" ADD CONSTRAINT "group_category_weights_category_id_group_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."group_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_category_weights" ADD CONSTRAINT "group_category_weights_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "group_category_member_accounts" DROP COLUMN IF EXISTS "share_weight";