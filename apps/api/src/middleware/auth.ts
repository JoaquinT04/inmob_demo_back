/**
 * Middleware de autenticación — JWT nativo (jose + bcryptjs).
 *
 * MVP: autenticación propia sin proveedores externos.
 * Futuro: para agregar Clerk, Auth0 u otro proveedor, implementar la interfaz
 * AuthProvider y cambiar el bloque de verificación en requireAuth.
 * Los handlers NO cambian porque usan request.auth que tiene la misma forma.
 *
 * Flujo:
 *   POST /api/auth/login → verifica email + password + tenantSlug
 *                        → devuelve JWT firmado con APP_SECRET
 *   Requests autenticados → Bearer <jwt> → requireAuth → request.auth
 */
import { jwtVerify, SignJWT } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@inmob/database';

// ─── AuthContext ──────────────────────────────────────────────────────────────
//
// Disponible en todos los handlers después de requireAuth.
// userId y tenantId siempre presentes — son IDs internos de nuestra DB.
// externalId: reservado para integración futura con Clerk/Auth0 (sub del JWT externo).

export interface AuthContext {
  userId: string;
  tenantId: string;
  externalId?: string; // Clerk sub u otro proveedor — undefined en JWT nativo
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
    currentUser?: User; // Cargado por requirePermission para evitar doble query
  }
}

// ─── AuthProvider interface ───────────────────────────────────────────────────
//
// Punto de extensión para proveedores externos futuros.
// Implementar esta interfaz y registrarla en app.ts para agregar Clerk/Auth0.
//
// export interface AuthProvider {
//   verifyToken(token: string): Promise<{ userId: string; tenantId: string; externalId?: string }>;
// }

// ─── Configuración ───────────────────────────────────────────────────────────

const APP_SECRET = new TextEncoder().encode(
  process.env['APP_SECRET'] ?? 'dev-secret-inmob-change-in-production-32chars',
);

const TOKEN_EXPIRY = process.env['JWT_EXPIRY'] ?? '7d';

// ─── JWT — firmar y verificar ─────────────────────────────────────────────────

export interface TokenPayload {
  userId: string;
  tenantId: string;
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
  const tenantId = payload['tenantId'] as string | undefined;

  if (!userId || !tenantId) {
    throw new Error('Token payload inválido: faltan userId o tenantId');
  }

  return { userId, tenantId };
}

// ─── requireAuth ─────────────────────────────────────────────────────────────

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Token requerido', code: 'MISSING_TOKEN' });
  }

  const token = authHeader.slice(7);

  try {
    const { userId, tenantId } = await verifyAppToken(token);
    request.auth = { userId, tenantId };
  } catch {
    return reply.status(401).send({ error: 'Token inválido o expirado', code: 'INVALID_TOKEN' });
  }
}

// ─── Header de desarrollo rápido (herramienta de prueba con curl/Postman) ────
//
// Permite hacer un request sin token enviando x-dev-tenant-id + x-dev-user-id.
// Solo activo si NODE_ENV=development. Nunca llega a producción.
//
// Uso: curl -H "x-dev-user-id: <id>" -H "x-dev-tenant-id: <id>" ...

export async function requireAuthDev(request: FastifyRequest, reply: FastifyReply) {
  if (process.env['NODE_ENV'] !== 'development') {
    return requireAuth(request, reply);
  }

  const devUserId = request.headers['x-dev-user-id'] as string | undefined;
  const devTenantId = request.headers['x-dev-tenant-id'] as string | undefined;

  if (devUserId && devTenantId) {
    request.auth = { userId: devUserId, tenantId: devTenantId };
    return;
  }

  return requireAuth(request, reply);
}
