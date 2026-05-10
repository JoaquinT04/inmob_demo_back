import { createHmac, randomBytes } from 'crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@inmob/database';

export interface AuthContext {
  userId: string;
  subdomain: string;
  externalId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
    currentUser?: User;
  }
}

const APP_SECRET = new TextEncoder().encode(
  process.env['APP_SECRET'] ?? 'dev-secret-inmob-change-in-production-32chars',
);

export const TOKEN_HMAC_SECRET =
  process.env['TOKEN_HMAC_SECRET'] ??
  (process.env['NODE_ENV'] !== 'production'
    ? 'dev-token-hmac-secret-change-in-production'
    : (() => { throw new Error('TOKEN_HMAC_SECRET env var required in production'); })());

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

export interface TokenPayload {
  userId: string;
  subdomain: string;
}

export async function signAccessToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(APP_SECRET);
}

/** Genera refresh token raw (64 char hex) y su HMAC para almacenar en DB */
export function generateRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(32).toString('hex');
  const hash = createHmac('sha256', TOKEN_HMAC_SECRET).update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
  return { raw, hash, expiresAt };
}

export function hashRefreshToken(raw: string): string {
  return createHmac('sha256', TOKEN_HMAC_SECRET).update(raw).digest('hex');
}

/** @deprecated usar signAccessToken — mantenido para compatibilidad con provisioner */
export async function signToken(payload: TokenPayload): Promise<string> {
  return signAccessToken(payload);
}

async function verifyAppToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, APP_SECRET);
  const userId = payload['userId'] as string | undefined;
  const subdomain = payload['subdomain'] as string | undefined;

  if (!userId || !subdomain) {
    throw new Error('Token payload inválido: faltan userId o subdomain');
  }

  return { userId, subdomain };
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Token requerido', code: 'MISSING_TOKEN' });
  }

  const token = authHeader.slice(7);

  try {
    const { userId, subdomain } = await verifyAppToken(token);
    request.auth = { userId, subdomain };
  } catch {
    return reply.status(401).send({ error: 'Token inválido o expirado', code: 'INVALID_TOKEN' });
  }
}

