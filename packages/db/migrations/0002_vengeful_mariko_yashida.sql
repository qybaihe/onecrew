CREATE TABLE "provider_cache" (
	"input_hash" char(64) NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"mode" "provider_mode" NOT NULL,
	"output" jsonb NOT NULL,
	"actual_cost_cny" numeric(14, 4) NOT NULL,
	"source_job_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "provider_cache_pk" PRIMARY KEY("input_hash","provider","model","mode")
);
--> statement-breakpoint
CREATE TABLE "provider_callbacks" (
	"event_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_job_id" text NOT NULL,
	"body_hash" char(64) NOT NULL,
	"callback" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_job_runs" (
	"job_id" text PRIMARY KEY NOT NULL,
	"route" text NOT NULL,
	"request" jsonb NOT NULL,
	"queue_job_id" text,
	"external_job_id" text,
	"callback_url" text,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_cache" ADD CONSTRAINT "provider_cache_source_job_id_jobs_job_id_fk" FOREIGN KEY ("source_job_id") REFERENCES "public"."jobs"("job_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_job_runs" ADD CONSTRAINT "provider_job_runs_job_id_jobs_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("job_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_cache_expiry_idx" ON "provider_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "provider_callbacks_external_idx" ON "provider_callbacks" USING btree ("provider","external_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_job_runs_external_uidx" ON "provider_job_runs" USING btree ("external_job_id");--> statement-breakpoint
CREATE INDEX "provider_job_runs_queue_idx" ON "provider_job_runs" USING btree ("queue_job_id");