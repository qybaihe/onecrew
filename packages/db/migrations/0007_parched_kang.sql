CREATE TYPE "public"."creative_entity_kind" AS ENUM('character', 'scene', 'prop');--> statement-breakpoint
CREATE TYPE "public"."creative_entity_status" AS ENUM('draft', 'ready', 'archived');--> statement-breakpoint
CREATE TYPE "public"."episode_status" AS ENUM('draft', 'planning', 'ready', 'rendered', 'archived');--> statement-breakpoint
CREATE TYPE "public"."frame_type" AS ENUM('first', 'last', 'key');--> statement-breakpoint
CREATE TABLE "creative_entities" (
	"entity_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"episode_id" text,
	"kind" "creative_entity_kind" NOT NULL,
	"name" text NOT NULL,
	"spec" jsonb NOT NULL,
	"status" "creative_entity_status" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"episode_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"episode_number" integer NOT NULL,
	"spec" jsonb NOT NULL,
	"status" "episode_status" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frame_prompts" (
	"frame_prompt_id" text PRIMARY KEY NOT NULL,
	"shot_id" text NOT NULL,
	"frame_type" "frame_type" NOT NULL,
	"spec" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creative_entities" ADD CONSTRAINT "creative_entities_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_entities" ADD CONSTRAINT "creative_entities_episode_id_episodes_episode_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("episode_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frame_prompts" ADD CONSTRAINT "frame_prompts_shot_id_shots_shot_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("shot_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creative_entities_project_kind_idx" ON "creative_entities" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX "creative_entities_episode_idx" ON "creative_entities" USING btree ("episode_id");--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_project_number_uidx" ON "episodes" USING btree ("project_id","episode_number");--> statement-breakpoint
CREATE INDEX "episodes_project_status_idx" ON "episodes" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "frame_prompts_shot_type_idx" ON "frame_prompts" USING btree ("shot_id","frame_type");