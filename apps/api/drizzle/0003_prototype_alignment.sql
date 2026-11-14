ALTER TYPE "public"."document_type" ADD VALUE 'agent_agreement';--> statement-breakpoint
CREATE TABLE "agent_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"registered_in" text DEFAULT 'bg' NOT NULL,
	"company_name" text,
	"vat_number" text,
	"company_reg_number" text,
	"vat_registered" boolean,
	"address" text,
	"city" text,
	"country" text DEFAULT 'BG' NOT NULL,
	"manager_name" text,
	"manager_role" text,
	"payout_email" text,
	"company_at" timestamp with time zone,
	"bank_name" text,
	"iban" text,
	"bic" text,
	"account_holder" text,
	"bank_address" text,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"bank_confirmation_document_id" uuid,
	"details_at" timestamp with time zone,
	"agreement_document_id" uuid,
	"sign_method" text,
	"signed_scan_document_id" uuid,
	"signed_at" timestamp with time zone,
	"signed_name" text,
	"signed_ip" text,
	"countersigned_at" timestamp with time zone,
	"countersigned_by_id" uuid,
	"countersigned_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"units" integer NOT NULL,
	"net_cents" integer NOT NULL,
	"recorded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "payment_terms" text DEFAULT 'before_shipping' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "postcode" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "data" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_terms" text DEFAULT 'before_shipping' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_profiles" ADD CONSTRAINT "agent_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sales" ADD CONSTRAINT "event_sales_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sales" ADD CONSTRAINT "event_sales_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_sales_event_idx" ON "event_sales" USING btree ("event_id");