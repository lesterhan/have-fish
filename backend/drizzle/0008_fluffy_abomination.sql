ALTER TABLE "postings" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "deleted_at" timestamp;