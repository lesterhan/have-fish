CREATE TABLE "import_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"file_hash" text NOT NULL,
	"file_name" text NOT NULL,
	"version" integer NOT NULL,
	"row_count" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"last_error" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "import_sessions_user_id_file_hash_unique" UNIQUE("user_id","file_hash")
);
--> statement-breakpoint
ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;