CREATE TYPE "public"."qc_run_status" AS ENUM('queued', 'running', 'waiting_provider', 'waiting_human', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "qc_runs" (
	"qc_run_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"shot_id" text,
	"source_job_id" text,
	"status" "qc_run_status" NOT NULL,
	"idempotency_key" text NOT NULL,
	"request" jsonb NOT NULL,
	"record" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qc_runs" ADD CONSTRAINT "qc_runs_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_runs" ADD CONSTRAINT "qc_runs_shot_id_shots_shot_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("shot_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_runs" ADD CONSTRAINT "qc_runs_source_job_id_jobs_job_id_fk" FOREIGN KEY ("source_job_id") REFERENCES "public"."jobs"("job_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "qc_runs_project_idempotency_uidx" ON "qc_runs" USING btree ("project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "qc_runs_project_status_idx" ON "qc_runs" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "qc_runs_shot_idx" ON "qc_runs" USING btree ("shot_id");--> statement-breakpoint
CREATE INDEX "qc_runs_source_job_idx" ON "qc_runs" USING btree ("source_job_id");