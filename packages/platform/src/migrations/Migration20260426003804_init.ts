import { Migration } from '@mikro-orm/migrations';

export class Migration20260426003804_init extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "hub_properties" ("id" uuid not null, "tenant_subdomain" varchar(255) not null, "tenant_name" varchar(255) not null, "tenant_logo_url" varchar(255) null, "external_id" varchar(255) not null, "title" varchar(255) not null, "type" varchar(255) not null, "operation_type" varchar(255) not null, "price" numeric(15,2) not null, "currency" varchar(255) not null, "city" varchar(255) null, "neighborhood" varchar(255) null, "state" varchar(255) null, "main_image_url" varchar(255) null, "rooms" int null, "published_at" timestamptz null, "last_sync_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "hub_properties_pkey" primary key ("id"));`);
    this.addSql(`create index "idx_hub_tenant_external" on "hub_properties" ("tenant_subdomain", "external_id");`);

    this.addSql(`create table "tenant_registry" ("id" uuid not null, "subdomain" varchar(255) not null, "name" varchar(255) not null, "owner_email" varchar(255) not null, "database_url" varchar(255) not null, "plan" varchar(255) not null default 'free', "status" varchar(255) not null default 'trial', "subscription_status" varchar(255) not null default 'trialing', "trial_ends_at" timestamptz null, "current_period_end" timestamptz null, "cancel_at_period_end" boolean not null default false, "payment_provider" varchar(255) null, "external_customer_id" varchar(255) null, "external_subscription_id" varchar(255) null, "logo_url" varchar(255) null, "tax_id" varchar(255) null, "settings" jsonb null, "last_webhook_event" varchar(255) null, "last_webhook_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "tenant_registry_pkey" primary key ("id"));`);
    this.addSql(`alter table "tenant_registry" add constraint "tenant_registry_subdomain_unique" unique ("subdomain");`);
    this.addSql(`alter table "tenant_registry" add constraint "tenant_registry_database_url_unique" unique ("database_url");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "hub_properties" cascade;`);

    this.addSql(`drop table if exists "tenant_registry" cascade;`);
  }

}
