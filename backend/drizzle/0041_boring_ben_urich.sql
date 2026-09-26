ALTER TABLE "accounts" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "csv_parsers" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;