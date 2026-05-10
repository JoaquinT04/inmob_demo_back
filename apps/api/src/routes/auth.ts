import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Tenant, User, RefreshToken, PasswordResetToken } from '@inmob/database';
import {
  requireAuth,
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  signToken,
  TOKEN_HMAC_SECRET,
} from '../middleware/auth.js';
import {
  rateLimitLogin,
  recordFailedAttempt,
  rateLimitForgotPassword,
  rateLimitResetPassword,
} from '../middleware/rate-limit.js';
import { listPermissions } from '../utils/permissions.js';
import { sendPasswordResetEmail } from '../lib/email.js';

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutos

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(64).max(64),
  password: z.string().min(8).max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(64).max(64),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(64).max(64).optional(),
});

export async function authRoutes(app: FastifyInstance) {
  // ── POST /api/auth/login ─────────────────────────────────────────────────
  app.post('/login', { preHandler: rateLimitLogin }, async (request, reply) => {
    const result = loginSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Datos inválidos', details: result.error.flatten() });
    }

    const { email, password } = result.data;
    const subdomain = request.tenantSubdomain;
    const ip = request.ip;
    const em = request.orm.em.fork();

    const user = await em.findOne(User, { email });
    if (!user) {
      recordFailedAttempt(ip);
      return reply.status(401).send({ error: 'Email o contraseña incorrectos', code: 'INVALID_CREDENTIALS' });
    }

    if (!user.isActive) {
      return reply.status(403).send({ error: 'Usuario inactivo', code: 'USER_INACTIVE' });
    }

    if (!user.passwordHash) {
      return reply.status(401).send({ error: 'Este usuario no tiene contraseña configurada', code: 'NO_PASSWORD' });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      recordFailedAttempt(ip);
      return reply.status(401).send({ error: 'Email o contraseña incorrectos', code: 'INVALID_CREDENTIALS' });
    }

    user.lastLoginAt = new Date();

    const { raw, hash, expiresAt } = generateRefreshToken();
    em.create(RefreshToken, { userId: user.id, tokenHash: hash, expiresAt });
    await em.flush();

    const tenant = await em.findOne(Tenant, {});
    const accessToken = await signAccessToken({ userId: user.id, subdomain });
    const permissions = listPermissions(user, tenant?.permissionConfig);

    return reply.send({
      accessToken,
      refreshToken: raw,
      expiresIn: 900, // 15 min en segundos
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl ?? null,
        roles: user.roles,
        groups: user.groups ?? [],
        permissions,
      },
      tenant: {
        subdomain,
        name: tenant?.name ?? subdomain,
        logoUrl: tenant?.logoUrl ?? null,
        plan: tenant?.plan,
        status: tenant?.status,
      },
    });
  });

  // ── POST /api/auth/refresh ───────────────────────────────────────────────
  app.post('/refresh', async (request, reply) => {
    const result = refreshSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'refreshToken inválido', code: 'INVALID_REFRESH_TOKEN' });
    }

    const { refreshToken } = result.data;
    const computedHash = hashRefreshToken(refreshToken);
    const subdomain = request.tenantSubdomain;
    const em = request.orm.em.fork();

    const stored = await em.findOne(RefreshToken, { tokenHash: computedHash });
    const storedHash = stored?.tokenHash ?? '0'.repeat(64);
    const hashesMatch = timingSafeEqual(Buffer.from(computedHash), Buffer.from(storedHash));

    if (!hashesMatch || !stored || stored.revokedAt || stored.expiresAt < new Date()) {
      return reply.status(401).send({ error: 'Refresh token inválido o expirado', code: 'INVALID_REFRESH_TOKEN' });
    }

    // Rotación atómica: revocar el token usado y emitir uno nuevo
    const { raw, hash, expiresAt } = generateRefreshToken();
    await em.transactional(async (txEm) => {
      stored.revokedAt = new Date();
      txEm.create(RefreshToken, { userId: stored.userId, tokenHash: hash, expiresAt });
    });

    const accessToken = await signAccessToken({ userId: stored.userId, subdomain });

    return reply.send({
      accessToken,
      refreshToken: raw,
      expiresIn: 900,
    });
  });

  // ── POST /api/auth/logout ────────────────────────────────────────────────
  app.post('/logout', async (request, reply) => {
    const result = logoutSchema.safeParse(request.body);

    if (result.success && result.data.refreshToken) {
      const tokenHash = hashRefreshToken(result.data.refreshToken);
      const em = request.orm.em.fork();
      const stored = await em.findOne(RefreshToken, { tokenHash });
      if (stored && !stored.revokedAt) {
        stored.revokedAt = new Date();
        await em.flush();
      }
    }

    return reply.status(204).send();
  });

  // ── GET /api/auth/me ─────────────────────────────────────────────────────
  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    const auth = request.auth!;
    const em = request.orm.em.fork();

    const user = await em.findOne(User, { id: auth.userId });
    if (!user) {
      return reply.status(404).send({ error: 'Usuario no encontrado', code: 'USER_NOT_FOUND' });
    }

    const tenant = await em.findOne(Tenant, {});
    const permissions = listPermissions(user, tenant?.permissionConfig);

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl ?? null,
        roles: user.roles,
        groups: user.groups ?? [],
        preferences: user.preferences,
        permissionOverrides: user.permissionOverrides ?? null,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt ?? null,
      },
      tenant: {
        subdomain: auth.subdomain,
        name: tenant?.name ?? auth.subdomain,
        logoUrl: tenant?.logoUrl ?? null,
        plan: tenant?.plan,
        status: tenant?.status,
      },
      permissions,
    });
  });

  // ── POST /api/auth/forgot-password ──────────────────────────────────────
  app.post('/forgot-password', { preHandler: rateLimitForgotPassword }, async (request, reply) => {
    const result = forgotPasswordSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Email inválido' });
    }

    // Siempre 200 — no revelar si el email existe o no
    const em = request.orm.em.fork();
    const user = await em.findOne(User, { email: result.data.email });

    if (user && user.isActive) {
      // Invalidar tokens previos del usuario
      const existing = await em.find(PasswordResetToken, { userId: user.id, usedAt: null });
      for (const t of existing) t.usedAt = new Date();

      const raw = randomBytes(32).toString('hex');
      const tokenHash = createHmac('sha256', TOKEN_HMAC_SECRET).update(raw).digest('hex');
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

      em.create(PasswordResetToken, { userId: user.id, tokenHash, expiresAt });
      await em.flush();

      // Fire-and-forget: no bloquear la respuesta si falla el email
      sendPasswordResetEmail({
        to: user.email,
        firstName: user.firstName,
        resetToken: raw,
        subdomain: request.tenantSubdomain,
      }).catch((err) => app.log.error({ err }, 'Failed to send password reset email'));
    }

    return reply.send({ message: 'Si el email existe, recibirás un enlace de recuperación.' });
  });

  // ── POST /api/auth/reset-password ────────────────────────────────────────
  app.post('/reset-password', { preHandler: rateLimitResetPassword }, async (request, reply) => {
    const result = resetPasswordSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Datos inválidos', details: result.error.flatten() });
    }

    const { token, password } = result.data;
    const computedHash = createHmac('sha256', TOKEN_HMAC_SECRET).update(token).digest('hex');
    const em = request.orm.em.fork();

    const resetToken = await em.findOne(PasswordResetToken, { tokenHash: computedHash });
    const storedHash = resetToken?.tokenHash ?? '0'.repeat(64);
    const hashesMatch = timingSafeEqual(Buffer.from(computedHash), Buffer.from(storedHash));

    if (!hashesMatch || !resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      return reply.status(400).send({ error: 'Token inválido o expirado', code: 'INVALID_RESET_TOKEN' });
    }

    const user = await em.findOne(User, { id: resetToken.userId });
    if (!user || !user.isActive) {
      return reply.status(400).send({ error: 'Token inválido o expirado', code: 'INVALID_RESET_TOKEN' });
    }

    user.passwordHash = await bcrypt.hash(password, 12);
    resetToken.usedAt = new Date();

    // Revocar todos los refresh tokens del usuario por seguridad
    const refreshTokens = await em.find(RefreshToken, { userId: user.id, revokedAt: null });
    for (const rt of refreshTokens) rt.revokedAt = new Date();

    await em.flush();

    return reply.send({ message: 'Contraseña actualizada correctamente.' });
  });

  // ── GET /api/auth/users ──────────────────────────────────────────────────
  app.get('/users', { preHandler: requireAuth }, async (request, reply) => {
    const em = request.orm.em.fork();
    const users = await em.find(User, { isActive: true }, { orderBy: { firstName: 'ASC' } });
    const tenant = await em.findOne(Tenant, {});

    return reply.send({
      tenant: { subdomain: request.tenantSubdomain, name: tenant?.name ?? request.tenantSubdomain },
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        roles: u.roles,
        hasPassword: !!u.passwordHash,
      })),
    });
  });
}
