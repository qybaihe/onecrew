CREATE TYPE "public"."audit_outcome" AS ENUM('accepted', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."human_gate_status" AS ENUM('waiting', 'resolved', 'cancelled');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"audit_id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"event_id" text NOT NULL,
	"project_id" text,
	"actor_open_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"expected_version" integer,
	"outcome" "audit_outcome" NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feishu_record_links" (
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"app_token" text NOT NULL,
	"table_id" text NOT NULL,
	"record_id" text NOT NULL,
	"local_version" integer NOT NULL,
	"remote_revision" integer,
	"field_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feishu_record_links_pk" PRIMARY KEY("entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "human_gates" (
	"gate_id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"project_id" text NOT NULL,
	"node" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"expected_target_version" integer NOT NULL,
	"status" "human_gate_status" NOT NULL,
	"resolution" text,
	"actor_open_id" text,
	"event_id" text,
	"state" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "human_gates" ADD CONSTRAINT "human_gates_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_source_event_action_uidx" ON "audit_logs" USING btree ("source","event_id","action");--> statement-breakpoint
CREATE INDEX "audit_project_created_idx" ON "audit_logs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feishu_record_uidx" ON "feishu_record_links" USING btree ("app_token","table_id","record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "human_gates_event_uidx" ON "human_gates" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "human_gates_workflow_status_idx" ON "human_gates" USING btree ("workflow_id","status");--> statement-breakpoint
CREATE INDEX "human_gates_target_idx" ON "human_gates" USING btree ("target_type","target_id");