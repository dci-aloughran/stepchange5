CREATE TYPE "public"."accessibility_need_type" AS ENUM('mobility_aid', 'clear_route', 'turning_area', 'transfer_area', 'reach_range', 'step_free', 'seating_support', 'trip_hazard_avoidance', 'visual', 'hearing', 'dexterity', 'cognitive', 'sensory');--> statement-breakpoint
CREATE TYPE "public"."accessibility_scope" AS ENUM('home', 'room', 'person');--> statement-breakpoint
CREATE TYPE "public"."availability" AS ENUM('in_stock', 'out_of_stock', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."feature_type" AS ENUM('door', 'window', 'bay_window', 'fireplace', 'radiator', 'stairs', 'column', 'built_in', 'other');--> statement-breakpoint
CREATE TYPE "public"."journey_type" AS ENUM('buyer', 'homeowner');--> statement-breakpoint
CREATE TYPE "public"."measurement_status" AS ENUM('user_confirmed', 'source_printed', 'calculated', 'estimated', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."person_role" AS ENUM('adult', 'child', 'regular_visitor');--> statement-breakpoint
CREATE TYPE "public"."recommendation_status" AS ENUM('active', 'replaced', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('draft', 'accepted', 'edited', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('not_configured', 'clean', 'infected', 'error');--> statement-breakpoint
CREATE TYPE "public"."upload_purpose" AS ENUM('floor_plan', 'room_photo', 'inspiration');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('quarantined', 'rejected', 'available');--> statement-breakpoint
CREATE TYPE "public"."visual_tier" AS ENUM('practical', 'recommended', 'aspirational');--> statement-breakpoint
CREATE TYPE "public"."wall" AS ENUM('north', 'east', 'south', 'west');--> statement-breakpoint
CREATE TABLE "accessibility_needs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"scope" "accessibility_scope" NOT NULL,
	"room_id" uuid,
	"person_id" uuid,
	"need_type" "accessibility_need_type" NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"journey_type" "journey_type",
	"device" text,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "architectural_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"type" "feature_type" NOT NULL,
	"wall" "wall",
	"offset_cm" double precision,
	"width_cm" double precision,
	"height_cm" double precision,
	"status" "measurement_status" DEFAULT 'unknown' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"brief_id" uuid,
	"layout_id" uuid,
	"vibe" text NOT NULL,
	"tier" "visual_tier" DEFAULT 'recommended' NOT NULL,
	"source_upload_id" uuid,
	"image_blob_pathname" text,
	"dimension_basis" "measurement_status" DEFAULT 'unknown' NOT NULL,
	"disclosure" text NOT NULL,
	"looks_like_my_room" boolean,
	"status" "review_status" DEFAULT 'draft' NOT NULL,
	"model_version" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "existing_possessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"room_id" uuid,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"width_cm" double precision,
	"depth_cm" double precision,
	"height_cm" double precision,
	"keep" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"home_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "functional_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"household_need" text NOT NULL,
	"room_constraints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommended_use" text NOT NULL,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uncertainties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "review_status" DEFAULT 'draft' NOT NULL,
	"model_version" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"household_id" uuid,
	"name" text NOT NULL,
	"journey_type" "journey_type" DEFAULT 'homeowner' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"address" text,
	"listing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retention_state" text DEFAULT 'active' NOT NULL,
	"retain_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text DEFAULT 'My household' NOT NULL,
	"lifestyle" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"practical_needs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"budget_total_pence" integer,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspiration_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"upload_id" uuid,
	"source_url" text,
	"kind" text DEFAULT 'image' NOT NULL,
	"reaction" text DEFAULT 'love' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kill_switches" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"brief_id" uuid NOT NULL,
	"placements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"zones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation" jsonb,
	"status" "review_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value_cm" double precision,
	"status" "measurement_status" NOT NULL,
	"source" text NOT NULL,
	"source_upload_id" uuid,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"label" text NOT NULL,
	"role" "person_role" NOT NULL,
	"age_years" integer,
	"routines" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer" text NOT NULL,
	"connector" text NOT NULL,
	"source_product_id" text NOT NULL,
	"source_variant_id" text,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"width_cm" double precision,
	"depth_cm" double precision,
	"height_cm" double precision,
	"dimension_status" "measurement_status" DEFAULT 'unknown' NOT NULL,
	"colour" text,
	"material" text,
	"price_pence" integer,
	"currency" text,
	"availability" "availability" DEFAULT 'unknown' NOT NULL,
	"image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delivers_to_uk" boolean,
	"canonical_url" text,
	"checkout_url" text,
	"licence_status" text DEFAULT 'unknown' NOT NULL,
	"sponsored" boolean DEFAULT false NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"brief_id" uuid,
	"requirement_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"rank_inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "recommendation_status" DEFAULT 'active' NOT NULL,
	"include_in_budget" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"home_id" uuid NOT NULL,
	"floor_id" uuid,
	"name" text NOT NULL,
	"room_type" text DEFAULT 'other' NOT NULL,
	"selected" boolean DEFAULT true NOT NULL,
	"width_cm" double precision,
	"length_cm" double precision,
	"height_cm" double precision,
	"dimension_status" "measurement_status" DEFAULT 'unknown' NOT NULL,
	"polygon" jsonb,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taste_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"attributes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "review_status" DEFAULT 'draft' NOT NULL,
	"model_version" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"home_id" uuid,
	"room_id" uuid,
	"purpose" "upload_purpose" NOT NULL,
	"original_name" text NOT NULL,
	"declared_mime" text,
	"detected_mime" text,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"page_count" integer,
	"width_px" integer,
	"height_px" integer,
	"status" "upload_status" DEFAULT 'quarantined' NOT NULL,
	"scan_status" "scan_status" DEFAULT 'not_configured' NOT NULL,
	"rejection_code" text,
	"blob_pathname" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"journey_type" "journey_type",
	"journey_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_training_consent" boolean DEFAULT false NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accessibility_needs" ADD CONSTRAINT "accessibility_needs_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accessibility_needs" ADD CONSTRAINT "accessibility_needs_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accessibility_needs" ADD CONSTRAINT "accessibility_needs_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architectural_features" ADD CONSTRAINT "architectural_features_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_brief_id_functional_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."functional_briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_layout_id_layouts_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."layouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_source_upload_id_uploads_id_fk" FOREIGN KEY ("source_upload_id") REFERENCES "public"."uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "existing_possessions" ADD CONSTRAINT "existing_possessions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "existing_possessions" ADD CONSTRAINT "existing_possessions_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floors" ADD CONSTRAINT "floors_home_id_homes_id_fk" FOREIGN KEY ("home_id") REFERENCES "public"."homes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "functional_briefs" ADD CONSTRAINT "functional_briefs_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homes" ADD CONSTRAINT "homes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homes" ADD CONSTRAINT "homes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspiration_items" ADD CONSTRAINT "inspiration_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspiration_items" ADD CONSTRAINT "inspiration_items_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_brief_id_functional_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."functional_briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_brief_id_functional_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."functional_briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_home_id_homes_id_fk" FOREIGN KEY ("home_id") REFERENCES "public"."homes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_floor_id_floors_id_fk" FOREIGN KEY ("floor_id") REFERENCES "public"."floors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taste_profiles" ADD CONSTRAINT "taste_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_home_id_homes_id_fk" FOREIGN KEY ("home_id") REFERENCES "public"."homes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_type_idx" ON "audit_events" USING btree ("type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "households_user_idx" ON "households" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_source_idx" ON "products" USING btree ("connector","source_product_id","source_variant_id");--> statement-breakpoint
CREATE INDEX "rooms_home_idx" ON "rooms" USING btree ("home_id");--> statement-breakpoint
CREATE UNIQUE INDEX "taste_profiles_user_idx" ON "taste_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "uploads_user_idx" ON "uploads" USING btree ("user_id");