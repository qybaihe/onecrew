CREATE TABLE "creative_generation_batches" (
	"batch_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"input_hash" char(64) NOT NULL,
	"record" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creative_generation_batches" ADD CONSTRAINT "creative_generation_batches_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creative_generation_batches_project_idempotency_uidx" ON "creative_generation_batches" USING btree ("project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "creative_generation_batches_project_status_idx" ON "creative_generation_batches" USING btree ("project_id","status");