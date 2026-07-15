DROP INDEX "renders_manifest_hash_idx";--> statement-breakpoint
ALTER TABLE "renders" ADD COLUMN "render_mode" text DEFAULT 'preview' NOT NULL;--> statement-breakpoint
UPDATE "renders" SET "record" = jsonb_set("record", '{renderMode}', '"preview"'::jsonb, true) WHERE NOT ("record" ? 'renderMode');--> statement-breakpoint
CREATE INDEX "renders_manifest_hash_idx" ON "renders" USING btree ("manifest_hash","render_mode","code_version");
