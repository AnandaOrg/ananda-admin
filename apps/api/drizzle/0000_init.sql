CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."approval_type" AS ENUM('new_customer', 'special_price', 'correction');--> statement-breakpoint
CREATE TYPE "public"."commission_status" AS ENUM('coming', 'ready', 'sent', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('draft', 'needs_approval', 'active', 'declined', 'archived');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('proforma', 'invoice', 'credit_note', 'purchase_order', 'delivery_note', 'upload');--> statement-breakpoint
CREATE TYPE "public"."flavour" AS ENUM('aloha', 'gaia', 'santorini', 'kyoto');--> statement-breakpoint
CREATE TYPE "public"."movement_kind" AS ENUM('purchase_receipt', 'dispatch', 'return', 'credit_return', 'adjustment', 'event_out', 'event_in', 'event_sale');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'payment_to_confirm', 'waiting_for_stock', 'ready_to_send', 'at_warehouse', 'delivered', 'delivered_part', 'invoiced', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payable_kind" AS ENUM('supplier_invoice', 'freight', 'excise');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('ordered', 'on_the_way', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'deactivated');--> statement-breakpoint
CREATE TABLE "agent_nudges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"sent_by_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "approval_type" NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"customer_id" uuid,
	"order_id" uuid,
	"requested_by_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decline_reason" text,
	"decline_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_name" text,
	"category" text NOT NULL,
	"action" text NOT NULL,
	"record_type" text,
	"record_id" text,
	"record_label" text,
	"changes" jsonb,
	"money" boolean DEFAULT false NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "bank_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account" text NOT NULL,
	"balance_on" date NOT NULL,
	"balance_cents" integer NOT NULL,
	"recorded_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"sent_by_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"units" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "commission_status" DEFAULT 'coming' NOT NULL,
	"ready_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"phone" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"vat_number" text NOT NULL,
	"vat_valid" boolean,
	"vat_checked_at" timestamp with time zone,
	"country" text DEFAULT 'BG' NOT NULL,
	"registered_address" text NOT NULL,
	"delivery_address" text,
	"city" text,
	"contact_name" text NOT NULL,
	"phone" text NOT NULL,
	"invoice_email" text NOT NULL,
	"proforma_language" text DEFAULT 'bg' NOT NULL,
	"payment_terms_days" integer DEFAULT 7 NOT NULL,
	"note" text,
	"agent_id" uuid,
	"owned_until" date,
	"ownership_warned_at" timestamp with time zone,
	"status" "customer_status" DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "document_type" NOT NULL,
	"number" text,
	"order_id" uuid,
	"purchase_id" uuid,
	"customer_id" uuid,
	"references_document_id" uuid,
	"superseded_by_id" uuid,
	"language" text DEFAULT 'en' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total_cents" integer,
	"label" text,
	"file_path" text,
	"file_name" text,
	"mime_type" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to" jsonb NOT NULL,
	"cc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"kind" text NOT NULL,
	"record_type" text,
	"record_id" text,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"place" text NOT NULL,
	"kind" text NOT NULL,
	"agent_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spent_on" date NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"net_cents" integer NOT NULL,
	"vat_rate" numeric(5, 4) DEFAULT 0.2 NOT NULL,
	"total_cents" integer NOT NULL,
	"paid" boolean DEFAULT true NOT NULL,
	"event_id" uuid,
	"receipt_document_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"key" text PRIMARY KEY NOT NULL,
	"next" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"flavour" "flavour" NOT NULL,
	"cartons" integer NOT NULL,
	"units" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"line_net_cents" integer NOT NULL,
	"delivered_cartons" integer,
	"credited_cartons" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"customer_id" uuid,
	"agent_id" uuid NOT NULL,
	"event_id" uuid,
	"status" "order_status" DEFAULT 'draft' NOT NULL,
	"total_cartons" integer DEFAULT 0 NOT NULL,
	"total_units" integer DEFAULT 0 NOT NULL,
	"tier_unit_price_cents" integer DEFAULT 0 NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"special_unit_price_cents" integer,
	"net_cents" integer DEFAULT 0 NOT NULL,
	"vat_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"commission_cents" integer DEFAULT 0 NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"credited_cents" integer DEFAULT 0 NOT NULL,
	"purchase_cost_cents" integer,
	"allocated" boolean DEFAULT false NOT NULL,
	"reserved_until" timestamp with time zone,
	"hold_released_at" timestamp with time zone,
	"proforma_expires_at" timestamp with time zone,
	"proforma_reminder_at" timestamp with time zone,
	"payment_due_on" date,
	"note" text,
	"part_delivery_outcome" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"sent_to_warehouse_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"invoiced_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "orders_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "payable_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payable_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_from" text NOT NULL,
	"bank_reference" text,
	"proof_document_id" uuid,
	"recorded_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "payable_kind" NOT NULL,
	"party" text NOT NULL,
	"supplier_id" uuid,
	"purchase_id" uuid,
	"invoice_number" text,
	"due_on" date NOT NULL,
	"net_cents" integer NOT NULL,
	"vat_rate" numeric(5, 4) DEFAULT 0.2 NOT NULL,
	"amount_cents" integer NOT NULL,
	"paid_cents" integer DEFAULT 0 NOT NULL,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" text NOT NULL,
	"bank_reference" text,
	"confirmed_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"flavour" "flavour" NOT NULL,
	"cartons" integer NOT NULL,
	"units" integer NOT NULL,
	"unit_price_cents" numeric(12, 4) NOT NULL,
	"units_received" integer
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "purchase_status" DEFAULT 'ordered' NOT NULL,
	"ordered_on" date NOT NULL,
	"expected_on" date NOT NULL,
	"arrived_on" date,
	"total_cartons" integer DEFAULT 0 NOT NULL,
	"total_units" integer DEFAULT 0 NOT NULL,
	"units_received" integer,
	"goods_cents" integer DEFAULT 0 NOT NULL,
	"freight_cents" integer DEFAULT 0 NOT NULL,
	"excise_cents" integer DEFAULT 0 NOT NULL,
	"landed_unit_cost_cents" numeric(12, 4),
	"supplier_invoice_received" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_role" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"scope" text NOT NULL,
	"two_step_required" boolean DEFAULT false NOT NULL,
	"areas" jsonb NOT NULL,
	"sensitive" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"two_step_passed" boolean DEFAULT false NOT NULL,
	"preview_role_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"carrier" text NOT NULL,
	"mode" text NOT NULL,
	"route" text,
	"depart_on" date,
	"arrive_on" date,
	"status" text DEFAULT 'booked' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"counted_by_id" uuid NOT NULL,
	"cartons" jsonb NOT NULL,
	"expected_cartons" jsonb NOT NULL,
	"reconciled_at" timestamp with time zone,
	"reconciled_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flavour" "flavour" NOT NULL,
	"units" integer NOT NULL,
	"kind" "movement_kind" NOT NULL,
	"reason" text,
	"note" text,
	"event_id" uuid,
	"order_id" uuid,
	"purchase_id" uuid,
	"by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"sent_by_id" uuid NOT NULL,
	"follow_up_on" date,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company" text NOT NULL,
	"country" text NOT NULL,
	"vat_number" text,
	"contact_name" text,
	"orders_email" text NOT NULL,
	"phone" text,
	"approved_flavours" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_flavours" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lead_time_days" integer DEFAULT 30 NOT NULL,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"unit_price_cents" numeric(12, 4) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text,
	"role_id" uuid NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"theme" text DEFAULT 'dark' NOT NULL,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"invite_token_hash" text,
	"invite_expires_at" timestamp with time zone,
	"invited_by_id" uuid,
	"last_sign_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_nudges" ADD CONSTRAINT "agent_nudges_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_reminders" ADD CONSTRAINT "collection_reminders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payable_payments" ADD CONSTRAINT "payable_payments_payable_id_payables_id_fk" FOREIGN KEY ("payable_id") REFERENCES "public"."payables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_messages" ADD CONSTRAINT "supplier_messages_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approval_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_category_idx" ON "audit_log" USING btree ("category");--> statement-breakpoint
CREATE INDEX "commission_agent_idx" ON "commission_entries" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "commission_order_idx" ON "commission_entries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "customers_agent_idx" ON "customers" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "customers_vat_idx" ON "customers" USING btree ("vat_number");--> statement-breakpoint
CREATE INDEX "documents_order_idx" ON "documents" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "documents_purchase_idx" ON "documents" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_lines_flavour_uq" ON "order_lines" USING btree ("order_id","flavour");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_agent_idx" ON "orders" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "stock_flavour_idx" ON "stock_movements" USING btree ("flavour");--> statement-breakpoint
CREATE INDEX "stock_event_idx" ON "stock_movements" USING btree ("event_id");