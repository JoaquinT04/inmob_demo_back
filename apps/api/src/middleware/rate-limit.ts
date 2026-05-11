import type { FastifyReply, FastifyRequest } from 'fastify';
import { getRedis } from '../lib/redis.js';

// ── Login: 5 attempts per IP per 5 min ────────────────────────────────────────

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_S = 5 * 60;

export async function recordFailedAttempt(ip: string): Promise<{ blocked: boolean; retryAfterSeconds: number }> {
  try {
    const redis = getRedis();
    const key = `rl:login:${ip}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, LOGIN_WINDOW_S);

    if (count > MAX_LOGIN_ATTEMPTS) {
      const ttl = await redis.ttl(key);
      return { blocked: true, retryAfterSeconds: Math.max(ttl, 0) };
    }
    return { blocked: false, retryAfterSeconds: 0 };
  } catch {
    return { blocked: false, retryAfterSeconds: 0 }; // fail open if Redis is down
  }
}

export async function isBlocked(ip: string): Promise<{ blocked: boolean; retryAfterSeconds: number }> {
  try {
    const redis = getRedis();
    const key = `rl:login:${ip}`;
    const count = await redis.get(key);
    if (!count || parseInt(count, 10) <= MAX_LOGIN_ATTEMPTS) return { blocked: false, retryAfterSeconds: 0 };
    const ttl = await redis.ttl(key);
    return { blocked: true, retryAfterSeconds: Math.max(ttl, 0) };
  } catch {
    return { blocked: false, retryAfterSeconds: 0 };
  }
}

export async function rateLimitLogin(request: FastifyRequest, reply: FastifyReply) {
  const { blocked, retryAfterSeconds } = await isBlocked(request.ip);
  if (blocked) {
    reply.header('Retry-After', String(retryAfterSeconds));
    return reply.status(429).send({
      error: 'Demasiados intentos fallidos. Intentá de nuevo más tarde.',
      code: 'RATE_LIMITED',
      retryAfterSeconds,
    });
  }
}

// ── Forgot-password: 3 attempts per email per hour ────────────────────────────

const MAX_FORGOT_ATTEMPTS = 3;
const FORGOT_WINDOW_S = 60 * 60;

export async function rateLimitForgotPassword(request: FastifyRequest, reply: FastifyReply) {
  const email = (request.body as { email?: string } | undefined)?.email;
  if (!email) return;

  try {
    const redis = getRedis();
    const key = `rl:forgot:${email.toLowerCase().slice(0, 254)}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, FORGOT_WINDOW_S);

    if (count > MAX_FORGOT_ATTEMPTS) {
      const retryAfterSeconds = Math.max(await redis.ttl(key), 0);
      reply.header('Retry-After', String(retryAfterSeconds));
      return reply.status(429).send({
        error: 'Demasiados intentos de recuperación. Intentá de nuevo en una hora.',
        code: 'RATE_LIMITED',
        retryAfterSeconds,
      });
    }
  } catch {
    // fail open — better to allow the request than block all users if Redis is down
  }
}

// ── Reset-password: 5 attempts per IP per hour ────────────────────────────────

const MAX_RESET_ATTEMPTS = 5;
const RESET_WINDOW_S = 60 * 60;

export async function rateLimitResetPassword(request: FastifyRequest, reply: FastifyReply) {
  try {
    const redis = getRedis();
    const key = `rl:reset:${request.ip}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, RESET_WINDOW_S);

    if (count > MAX_RESET_ATTEMPTS) {
      const retryAfterSeconds = Math.max(await redis.ttl(key), 0);
      reply.header('Retry-After', String(retryAfterSeconds));
      return reply.status(429).send({
        error: 'Demasiados intentos de restablecimiento. Intentá de nuevo en una hora.',
        code: 'RATE_LIMITED',
        retryAfterSeconds,
      });
    }
  } catch {
    // fail open
  }
}
