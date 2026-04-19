import { Migration } from '@mikro-orm/migrations';

export class Migration20260419145701 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "tenants" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "name" varchar(255) not null, "slug" varchar(255) not null, "status" varchar(255) not null default 'trial', "plan" varchar(255) not null default 'free', "legal_name" varchar(255) null, "tax_id" varchar(255) null, "logo_url" varchar(255) null, "cover_image_url" varchar(255) null, "address" jsonb null, "settings" jsonb not null, "permission_config" jsonb null, constraint "tenants_pkey" primary key ("id"));`);
    this.addSql(`alter table "tenants" add constraint "tenants_slug_unique" unique ("slug");`);

    this.addSql(`create table "subscriptions" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "tenant_id" uuid not null, "plan" varchar(255) not null default 'free', "status" varchar(255) not null default 'trialing', "trial_ends_at" timestamptz null, "current_period_start" timestamptz null, "current_period_end" timestamptz null, "cancel_at_period_end" boolean not null default false, "payment_provider" varchar(255) null, "external_subscription_id" varchar(255) null, "external_customer_id" varchar(255) null, "last_webhook_event" varchar(255) null, "last_webhook_at" timestamptz null, constraint "subscriptions_pkey" primary key ("id"));`);
    this.addSql(`alter table "subscriptions" add constraint "subscriptions_tenant_id_unique" unique ("tenant_id");`);

    this.addSql(`create table "portal_connections" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "portal" varchar(255) not null, "status" varchar(255) not null, "encrypted_credentials" jsonb null, "last_sync_at" timestamptz null, "error_message" varchar(255) null, "tenant_id" uuid not null, constraint "portal_connections_pkey" primary key ("id"));`);

    this.addSql(`create table "users" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "clerk_id" varchar(255) not null, "email" varchar(255) not null, "smtp_email" varchar(255) null, "first_name" varchar(255) not null, "last_name" varchar(255) not null, "phone" varchar(255) null, "avatar_url" varchar(255) null, "email_signature" text null, "roles" jsonb not null, "is_active" boolean not null default true, "two_factor_enabled" boolean not null default false, "preferences" jsonb not null, "last_login_at" timestamptz null, "password_hash" varchar(255) null, "groups" jsonb null, "permission_overrides" jsonb null, "tenant_id" uuid not null, constraint "users_pkey" primary key ("id"));`);
    this.addSql(`alter table "users" add constraint "users_clerk_id_unique" unique ("clerk_id");`);

    this.addSql(`create table "properties" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "title" varchar(255) not null, "slug" varchar(255) not null, "description" text null, "type" varchar(255) not null, "operation_type" varchar(255) not null, "status" varchar(255) not null, "price" numeric(15,2) not null, "currency" varchar(255) not null, "expenses" numeric(15,2) null, "address" jsonb not null, "features" jsonb not null, "amenities" jsonb not null, "images" jsonb not null, "published_at" timestamptz null, "tenant_id" uuid not null, "assigned_user_id" uuid null, constraint "properties_pkey" primary key ("id"));`);
    this.addSql(`alter table "properties" add constraint "properties_slug_unique" unique ("slug");`);

    this.addSql(`create table "contacts" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "first_name" varchar(255) not null, "last_name" varchar(255) null, "email" varchar(255) null, "phone" varchar(255) null, "whatsapp" varchar(255) null, "type" varchar(255) not null, "source" varchar(255) null, "notes" text null, "tags" jsonb not null, "tenant_id" uuid not null, "assigned_user_id" uuid null, constraint "contacts_pkey" primary key ("id"));`);

    this.addSql(`create table "leads" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "status" varchar(255) not null, "source" varchar(255) null, "notes" text null, "lost_reason" varchar(255) null, "activities" jsonb not null, "tenant_id" uuid not null, "contact_id" uuid not null, "property_id" uuid null, "assigned_user_id" uuid null, constraint "leads_pkey" primary key ("id"));`);

    this.addSql(`create table "agenda_events" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "title" varchar(255) not null, "type" varchar(255) not null, "description" text null, "starts_at" timestamptz not null, "ends_at" timestamptz null, "all_day" boolean not null default false, "location" varchar(255) null, "tenant_id" uuid not null, "created_by_id" uuid not null, "property_id" uuid null, "lead_id" uuid null, constraint "agenda_events_pkey" primary key ("id"));`);

    this.addSql(`alter table "subscriptions" add constraint "subscriptions_tenant_id_foreign" foreign key ("tenant_id") references "tenants" ("id") on update cascade;`);

    this.addSql(`alter table "portal_connections" add constraint "portal_connections_tenant_id_foreign" foreign key ("tenant_id") references "tenants" ("id") on update cascade;`);

    this.addSql(`alter table "users" add constraint "users_tenant_id_foreign" foreign key ("tenant_id") references "tenants" ("id") on update cascade;`);

    this.addSql(`alter table "properties" add constraint "properties_tenant_id_foreign" foreign key ("tenant_id") references "tenants" ("id") on update cascade;`);
    this.addSql(`alter table "properties" add constraint "properties_assigned_user_id_foreign" foreign key ("assigned_user_id") references "users" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "contacts" add constraint "contacts_tenant_id_foreign" foreign key ("tenant_id") references "tenants" ("id") on update cascade;`);
    this.addSql(`alter table "contacts" add constraint "contacts_assigned_user_id_foreign" foreign key ("assigned_user_id") references "users" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "leads" add constraint "leads_tenant_id_foreign" foreign key ("tenant_id") references "tenants" ("id") on update cascade;`);
    this.addSql(`alter table "leads" add constraint "leads_contact_id_foreign" foreign key ("contact_id") references "contacts" ("id") on update cascade;`);
    this.addSql(`alter table "leads" add constraint "leads_property_id_foreign" foreign key ("property_id") references "properties" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "leads" add constraint "leads_assigned_user_id_foreign" foreign key ("assigned_user_id") references "users" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "agenda_events" add constraint "agenda_events_tenant_id_foreign" foreign key ("tenant_id") references "tenants" ("id") on update cascade;`);
    this.addSql(`alter table "agenda_events" add constraint "agenda_events_created_by_id_foreign" foreign key ("created_by_id") references "users" ("id") on update cascade;`);
    this.addSql(`alter table "agenda_events" add constraint "agenda_events_property_id_foreign" foreign key ("property_id") references "properties" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "agenda_events" add constraint "agenda_events_lead_id_foreign" foreign key ("lead_id") references "leads" ("id") on update cascade on delete set null;`);
  }

}
