import { Migration } from '@mikro-orm/migrations';

export class Migration20260510130000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE "password_reset_tokens" (
        "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
        "user_id"     UUID        NOT NULL,
        "token_hash"  VARCHAR(64) NOT NULL,
        "expires_at"  TIMESTAMPTZ NOT NULL,
        "used_at"     TIMESTAMPTZ,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
      );
    `);
    this.addSql(`CREATE INDEX "prt_token_hash_idx" ON "password_reset_tokens" ("token_hash");`);
    this.addSql(`CREATE INDEX "prt_user_id_idx" ON "password_reset_tokens" ("user_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "password_reset_tokens";`);
  }
}
