/**
 * Google OAuth 2.0 — Authorization Code Flow
 *
 * Endpoints públicos (fuera del tenant-routing hook):
 *   GET /api/auth/google           → redirect a Google consent screen
 *   GET /api/auth/google/callback  → exchange code → tokens → redirect al frontend
 *
 * State: HMAC-signed JSON { subdomain, ts } para prevenir CSRF.
 * El callback resuelve el tenant ORM manualmente usando connectionManager.
 */
import { createHmac, randomBytes } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { TenantRegistry } from '@inmob/platform';
import { User, RefreshToken } from '@inmob/database';
import { connectionManager } from '../lib/connection-manager.js';
import { signAccessToken, generateRefreshToken, TOKEN_HMAC_SECRET } from '../middleware/auth.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 min

interface GoogleProfile {
  id: string;
  email: string;
  given_name: string;
  family_name: string;
  picture?: string;
  verified_email: boolean;
}

// ─── State HMAC sign / verify ──────────────────────────────────────────────

function signState(subdomain: string): string {
  const payload = JSON.stringify({ subdomain, ts: Date.now(), nonce: randomBytes(8).toString('hex') });
  const sig = createHmac('sha256', TOKEN_HMAC_SECRET).update(payload).digest('hex');
  return Buffer.from(JSON.stringify({ payload, sig })).toString('base64url');
}

function verifyState(state: string): { subdomain: string } | null {
  try {
    const { payload, sig } = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    const expected = createHmac('sha256', TOKEN_HMAC_SECRET).update(payload).digest('hex');
    if (sig !== expected) return null;

    const { subdomain, ts } = JSON.parse(payload);
    if (Date.now() - ts > STATE_TTL_MS) return null;
    return { subdomain };
  } catch {
    return null;
  }
}

// ─── Google token exchange ──────────────────────────────────────────────────

async function exchangeCode(code: string, redirectUri: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env['GOOGLE_CLIENT_ID']!,
      client_secret: process.env['GOOGLE_CLIENT_SECRET']!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${body}`);
  }

  const { access_token } = await res.json() as { access_token: string };
  return access_token;
}

async function getGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) throw new Error('Failed to fetch Google profile');
  return res.json() as Promise<GoogleProfile>;
}

// ─── Routes ────────────────────────────────────────────────────────────────

export async function googleOAuthRoutes(app: FastifyInstance) {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];

  if (!clientId || !clientSecret) {
    app.log.warn('Google OAuth desactivado: faltan GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET');
    return;
  }

  const appDomain = process.env['APP_DOMAIN'] ?? 'localhost';
  const isLocal = appDomain.startsWith('localhost');
  const redirectUri = isLocal
    ? `http://localhost:3001/api/auth/google/callback`
    : `https://api.${appDomain}/api/auth/google/callback`;
  const frontendBase = isLocal
    ? `http://localhost:5173`
    : `https://app.${appDomain}`;

  // ── GET /api/auth/google ─────────────────────────────────────────────────
  // Query param: ?subdomain=demo
  app.get('/google', async (request, reply) => {
    const { subdomain } = request.query as { subdomain?: string };
    const tenantSubdomain = subdomain ?? request.headers['x-tenant'] as string | undefined;

    if (!tenantSubdomain) {
      return reply.status(400).send({ error: 'Falta el parámetro subdomain', code: 'MISSING_SUBDOMAIN' });
    }

    const platformEm = app.platformOrm.em.fork();
    const registry = await platformEm.findOne(TenantRegistry, { subdomain: tenantSubdomain });
    if (!registry) {
      return reply.status(404).send({ error: 'Tenant no encontrado', code: 'TENANT_NOT_FOUND' });
    }

    const state = signState(tenantSubdomain);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
      prompt: 'select_account',
    });

    return reply.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`, 302);
  });

  // ── GET /api/auth/google/callback ────────────────────────────────────────
  app.get('/google/callback', async (request, reply) => {
    const { code, state, error } = request.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    const failRedirect = (reason: string) =>
      reply.redirect(`${frontendBase}/login?error=${encodeURIComponent(reason)}`, 302);

    if (error || !code || !state) {
      return failRedirect('oauth_denied');
    }

    const decoded = verifyState(state);
    if (!decoded) return failRedirect('invalid_state');

    const { subdomain } = decoded;

    let profile: GoogleProfile;
    try {
      const accessToken = await exchangeCode(code, redirectUri);
      profile = await getGoogleProfile(accessToken);
    } catch (err) {
      app.log.error({ err }, 'Google OAuth exchange failed');
      return failRedirect('oauth_failed');
    }

    if (!profile.verified_email) {
      return failRedirect('email_not_verified');
    }

    // Resolver tenant desde platform DB
    const platformEm = app.platformOrm.em.fork();
    const registry = await platformEm.findOne(TenantRegistry, { subdomain });

    if (!registry) return failRedirect('tenant_not_found');

    const tenantOrm = await connectionManager.get(registry.databaseUrl);
    const em = tenantOrm.em.fork();

    // Buscar usuario por email o googleId
    let user = await em.findOne(User, {
      $or: [{ email: profile.email }, { clerkId: `google_${profile.id}` }],
    });

    if (!user) {
      // Usuario no existe en este tenant → no permitir acceso automático
      return failRedirect('user_not_found');
    }

    if (!user.isActive) return failRedirect('user_inactive');

    // Merge: actualizar googleId y avatar si cambió
    if (!user.clerkId.startsWith('google_')) {
      user.clerkId = `google_${profile.id}`;
    }
    if (profile.picture && !user.avatarUrl) {
      user.avatarUrl = profile.picture;
    }
    user.lastLoginAt = new Date();

    // Generar tokens
    const { raw, hash, expiresAt } = generateRefreshToken();
    em.create(RefreshToken, { userId: user.id, tokenHash: hash, expiresAt });
    await em.flush();

    const accessJwt = await signAccessToken({ userId: user.id, subdomain });

    // Redirect al frontend con tokens en fragment (no expuestos en logs de servidor)
    const fragment = new URLSearchParams({
      access_token: accessJwt,
      refresh_token: raw,
      expires_in: '900',
    });

    return reply.redirect(`${frontendBase}/oauth/callback#${fragment.toString()}`, 302);
  });
}
