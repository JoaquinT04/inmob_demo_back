import type { FastifyReply, FastifyRequest } from 'fastify';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000; // 5 min

const store = new Map<string, RateLimitEntry>();

// Limpiar entradas expiradas cada 10 min para evitar memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 10 * 60 * 1000);

export function recordFailedAttempt(ip: string): { blocked: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { blocked: false, retryAfterSeconds: 0 };
  }

  entry.count++;

  if (entry.count > MAX_ATTEMPTS) {
    return { blocked: true, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }

  return { blocked: false, retryAfterSeconds: 0 };
}

export function isBlocked(ip: string): { blocked: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) return { blocked: false, retryAfterSeconds: 0 };

  if (entry.count >= MAX_ATTEMPTS) {
    return { blocked: true, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }

  return { blocked: false, retryAfterSeconds: 0 };
}

export function clearAttempts(ip: string): void {
  store.delete(ip);
}

// ── Password recovery rate limiting ────────────────────────────────────────

interface PasswordRecoveryEntry {
  count: number;
  resetAt: number;
}

const MAX_FORGOT_ATTEMPTS = 3;
const MAX_RESET_ATTEMPTS = 5;
const FORGOT_WINDOW_MS = 60 * 60 * 1000;
const RESET_WINDOW_MS = 60 * 60 * 1000;

const forgotStore = new Map<string, PasswordRecoveryEntry>();
const resetStore = new Map<string, PasswordRecoveryEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [k, e] of forgotStore.entries()) if (now > e.resetAt) forgotStore.delete(k);
  for (const [k, e] of resetStore.entries()) if (now > e.resetAt) resetStore.delete(k);
}, 30 * 60 * 1000);

export async function rateLimitForgotPassword(request: FastifyRequest, reply: FastifyReply) {
  const email = (request.body as { email?: string } | undefined)?.email;
  if (!email) return;

  const now = Date.now();
  const entry = forgotStore.get(email);

  if (!entry || now > entry.resetAt) {
    forgotStore.set(email, { count: 1, resetAt: now + FORGOT_WINDOW_MS });
    return;
  }

  entry.count++;
  if (entry.count > MAX_FORGOT_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
    reply.header('Retry-After', String(retryAfterSeconds));
    return reply.status(429).send({
      error: 'Demasiados intentos de recuperación. Intentá de nuevo en una hora.',
      code: 'RATE_LIMITED',
      retryAfterSeconds,
    });
  }
}

export async function rateLimitResetPassword(request: FastifyRequest, reply: FastifyReply) {
  const ip = request.ip;
  const now = Date.now();
  const entry = resetStore.get(ip);

  if (!entry || now > entry.resetAt) {
    resetStore.set(ip, { count: 1, resetAt: now + RESET_WINDOW_MS });
    return;
  }

  entry.count++;
  if (entry.count > MAX_RESET_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
    reply.header('Retry-After', String(retryAfterSeconds));
    return reply.status(429).send({
      error: 'Demasiados intentos de restablecimiento. Intentá de nuevo en una hora.',
      code: 'RATE_LIMITED',
      retryAfterSeconds,
    });
  }
}

export async function rateLimitLogin(request: FastifyRequest, reply: FastifyReply) {
  const ip = request.ip;
  const { blocked, retryAfterSeconds } = isBlocked(ip);

  if (blocked) {
    reply.header('Retry-After', String(retryAfterSeconds));
    return reply.status(429).send({
      error: 'Demasiados intentos fallidos. Intentá de nuevo más tarde.',
      code: 'RATE_LIMITED',
      retryAfterSeconds,
    });
  }
}
