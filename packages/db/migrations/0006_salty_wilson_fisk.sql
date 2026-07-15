CREATE TYPE "public"."localization_run_status" AS ENUM('queued', 'running', 'waiting_provider', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."publish_status" AS ENUM('building', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "experiments" (
	"experiment_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"creative_id" text NOT NULL,
	"language" text NOT NULL,
	"platform" text NOT NULL,
	"record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locale_packs" (
	"locale_pack_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"locale" text NOT NULL,
	"pack_version" integer NOT NULL,
	"content_hash" char(64) NOT NULL,
	"record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "localization_runs" (
	"localization_run_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"status" "localization_run_status" NOT NULL,
	"idempotency_key" text NOT NULL,
	"request" jsonb NOT NULL,
	"record" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publishes" (
	"publish_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"status" "publish_status" NOT NULL,
	"idempotency_key" text NOT NULL,
	"request" jsonb NOT NULL,
	"record" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locale_packs" ADD CONSTRAINT "locale_packs_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "localization_runs" ADD CONSTRAINT "localization_runs_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishes" ADD CONSTRAINT "publishes_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "experiments_creative_platform_uidx" ON "experiments" USING btree ("creative_id","platform");--> statement-breakpoint
CREATE INDEX "experiments_project_created_idx" ON "experiments" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "locale_packs_project_locale_version_uidx" ON "locale_packs" USING btree ("project_id","locale","pack_version");--> statement-breakpoint
CREATE INDEX "locale_packs_project_locale_idx" ON "locale_packs" USING btree ("project_id","locale");--> statement-breakpoint
CREATE INDEX "locale_packs_hash_idx" ON "locale_packs" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "localization_runs_project_idempotency_uidx" ON "localization_runs" USING btree ("project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "localization_runs_project_status_idx" ON "localization_runs" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "publishes_project_idempotency_uidx" ON "publishes" USING btree ("project_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "publishes_project_status_idx" ON "publishes" USING btree ("project_id","status");