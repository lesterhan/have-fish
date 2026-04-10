CREATE TABLE "fx_rates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "date" text NOT NULL,
  "base_currency" text NOT NULL,
  "quote_currency" text NOT NULL,
  "rate" numeric(12, 6) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  UNIQUE ("date", "base_currency", "quote_currency")
);
