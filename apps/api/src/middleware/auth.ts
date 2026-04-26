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

const TOKEN_EXPIRY = process.env['JWT_EXPIRY'] ?? '7d';

export interface TokenPayload {
  userId: string;
  subdomain: string;
}

export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(APP_SECRET);
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

export async function requireAuthDev(request: FastifyRequest, reply: FastifyReply) {
  if (process.env['NODE_ENV'] !== 'development') {
    return requireAuth(request, reply);
  }

  const devUserId = request.headers['x-dev-user-id'] as string | undefined;
  const devSubdomain = request.headers['x-dev-subdomain'] as string | undefined;

  if (devUserId && devSubdomain) {
    request.auth = { userId: devUserId, subdomain: devSubdomain };
    return;
  }

  return requireAuth(request, reply);
}
