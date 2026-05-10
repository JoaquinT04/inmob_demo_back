import { Migration } from '@mikro-orm/migrations';

export class Migration20260510120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE "refresh_tokens" (
        "id"          UUID        NOT NULL DEFAULT gen_random_uuid(),
        "user_id"     UUID        NOT NULL,
        "token_hash"  VARCHAR(64) NOT NULL,
        "expires_at"  TIMESTAMPTZ NOT NULL,
        "revoked_at"  TIMESTAMPTZ,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
      );
    `);
    this.addSql(`CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens" ("token_hash");`);
    this.addSql(`CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" ("user_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "refresh_tokens";`);
  }
}
