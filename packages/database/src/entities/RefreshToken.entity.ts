import { Entity, Index, Opt, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'refresh_tokens' })
export class RefreshToken {
  @PrimaryKey({ type: 'uuid' })
  id: string & Opt = crypto.randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  userId!: string;

  /** SHA-256 hex del token raw enviado al cliente */
  @Property({ length: 64 })
  @Index()
  tokenHash!: string;

  @Property()
  expiresAt!: Date;

  @Property({ nullable: true })
  revokedAt?: Date;

  @Property()
  createdAt: Date & Opt = new Date();
}
