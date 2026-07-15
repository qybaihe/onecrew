CREATE TABLE "creative_workflow_groups" (
	"group_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"generation_kind" text NOT NULL,
	"record" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creative_workflow_groups" ADD CONSTRAINT "creative_workflow_groups_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creative_workflow_groups_project_name_uidx" ON "creative_workflow_groups" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "creative_workflow_groups_project_idx" ON "creative_workflow_groups" USING btree ("project_id","updated_at");