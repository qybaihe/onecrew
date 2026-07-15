CREATE TYPE "public"."asset_status" AS ENUM('draft', 'approved', 'rejected', 'archived');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'waiting_human', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'running', 'waiting_human', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."provider_mode" AS ENUM('mock', 'sandbox', 'real');--> statement-breakpoint
CREATE TYPE "public"."qc_decision" AS ENUM('pass', 'regenerate', 'switch_model', 'manual');--> statement-breakpoint
CREATE TYPE "public"."render_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."shot_status" AS ENUM('planned', 'generating', 'qc', 'approved', 'failed');--> statement-breakpoint
CREATE TABLE "assets" (
	"asset_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"shot_id" text,
	"parent_asset_id" text,
	"type" text NOT NULL,
	"asset_version" integer NOT NULL,
	"record" jsonb NOT NULL,
	"status" "asset_status" NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"content_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" char(64) NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "idempotency_keys_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	CONSTRAINT "idempotency_keys_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"job_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"shot_id" text,
	"capability" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"mode" "provider_mode" NOT NULL,
	"status" "job_status" NOT NULL,
	"attempt" integer NOT NULL,
	"estimated_cost_cny" numeric(14, 4),
	"actual_cost_cny" numeric(14, 4),
	"input_hash" char(64) NOT NULL,
	"idempotency_key" text NOT NULL,
	"record" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"project_id" text PRIMARY KEY NOT NULL,
	"spec" jsonb NOT NULL,
	"status" "project_status" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qc_records" (
	"qc_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"shot_id" text,
	"decision" "qc_decision" NOT NULL,
	"record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renders" (
	"render_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"composition_id" text NOT NULL,
	"locale" text NOT NULL,
	"aspect_ratio" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"record" jsonb NOT NULL,
	"manifest_hash" char(64) NOT NULL,
	"design_pack_version" text NOT NULL,
	"code_version" text NOT NULL,
	"status" "render_status" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shots" (
	"shot_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"spec" jsonb NOT NULL,
	"status" "shot_status" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_shot_id_shots_shot_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("shot_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_shot_id_shots_shot_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("shot_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_records" ADD CONSTRAINT "qc_records_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qc_records" ADD CONSTRAINT "qc_records_shot_id_shots_shot_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("shot_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renders" ADD CONSTRAINT "renders_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_version_uidx" ON "assets" USING btree ("asset_id","asset_version");--> statement-breakpoint
CREATE INDEX "assets_project_type_idx" ON "assets" USING btree ("project_id","type");--> statement-breakpoint
CREATE INDEX "assets_parent_idx" ON "assets" USING btree ("parent_asset_id");--> statement-breakpoint
CREATE INDEX "assets_hash_idx" ON "assets" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_sequence_uidx" ON "idempotency_keys" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "idempotency_expiry_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_project_idempotency_uidx" ON "jobs" USING btree ("project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_project_status_idx" ON "jobs" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "jobs_shot_idx" ON "jobs" USING btree ("shot_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "qc_project_created_idx" ON "qc_records" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "qc_shot_idx" ON "qc_records" USING btree ("shot_id");--> statement-breakpoint
CREATE INDEX "renders_project_status_idx" ON "renders" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "renders_manifest_hash_idx" ON "renders" USING btree ("manifest_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "shots_project_sequence_uidx" ON "shots" USING btree ("project_id","sequence");--> statement-breakpoint
CREATE INDEX "shots_project_status_idx" ON "shots" USING btree ("project_id","status");