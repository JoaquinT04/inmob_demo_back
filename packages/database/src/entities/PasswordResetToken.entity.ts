import { Entity, Index, Opt, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'password_reset_tokens' })
export class PasswordResetToken {
  @PrimaryKey({ type: 'uuid' })
  id: string & Opt = crypto.randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  userId!: string;

  /** SHA-256 hex del token raw enviado por email */
  @Property({ length: 64 })
  @Index()
  tokenHash!: string;

  @Property()
  expiresAt!: Date;

  /** Marcado cuando se usa exitosamente o se invalida */
  @Property({ nullable: true })
  usedAt?: Date;

  @Property()
  createdAt: Date & Opt = new Date();
}
