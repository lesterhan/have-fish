CREATE TABLE "local_profile" (
	"id" text PRIMARY KEY DEFAULT 'local' NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "local_profile_one_row" CHECK ("local_profile"."id" = 'local')
);
--> statement-breakpoint
ALTER TABLE "local_profile" ADD CONSTRAINT "local_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;