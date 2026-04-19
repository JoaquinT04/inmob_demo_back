import { z } from 'zod';

// ─── Registro de nueva inmobiliaria ───────────────────────────────────────────
//
// Este schema es el contrato del endpoint POST /api/register.
// Crea atómicamente: Tenant + User(owner) + Subscription(trial).
//
// El slug se auto-genera a partir del nombre si no se provee.

export const registerSchema = z.object({
  // Datos de la inmobiliaria
  agencyName: z.string().min(2).max(100),
  slug: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones')
    .optional(),

  // Datos del owner
  ownerEmail: z.string().email(),
  ownerFirstName: z.string().min(1).max(80),
  ownerLastName: z.string().min(1).max(80),
  ownerPhone: z.string().max(30).optional(),

  // Datos opcionales de la empresa (completables en onboarding)
  taxId: z.string().max(20).optional(),
  country: z.string().length(2).default('AR'),
  timezone: z.string().default('America/Argentina/Buenos_Aires'),

  // DEV only: password para DEV_BYPASS_AUTH
  password: z.string().min(4).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

// ─── Invitar usuario al tenant ────────────────────────────────────────────────

export const inviteUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  role: z.enum(['administrador', 'coordinador', 'agente', 'captador']),
  // El owner es el único rol que NO se puede asignar al invitar
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;
