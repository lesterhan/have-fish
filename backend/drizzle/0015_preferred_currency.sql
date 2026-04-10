ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "preferred_currency" text NOT NULL DEFAULT 'CAD';
