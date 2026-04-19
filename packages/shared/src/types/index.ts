import type {
  Currency,
  OperationType,
  Permission,
  PortalConnectionStatus,
  PortalType,
  PropertyStatus,
  PropertyType,
  SubscriptionStatus,
  PaymentProvider,
  SystemRole,
  TenantPlan,
  TenantStatus,
  ContactType,
  LeadStatus,
} from '../constants/index.js';

// ─── Paginación ───────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

// ─── Tenant ───────────────────────────────────────────────────────────────────

export interface TenantAddress {
  street?: string;
  number?: string;
  floor?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
}

export interface TenantSettings {
  brandColors?: { primary: string; secondary: string };
  contact?: {
    email?: string;
    phone?: string;
    whatsapp?: string;
  };
  social?: {
    website?: string;
    facebook?: string;
    instagram?: string;
    linkedin?: string;
  };
  locale?: {
    country: string;
    language: string;
    timezone: string;
    currency: Currency;
  };
  smtp?: {
    host?: string;
    port?: number;
    user?: string;
    encryptedPassword?: string;
    fromName?: string;
    fromEmail?: string;
  };
}

export interface UserPermissionOverrides {
  grant: Permission[];
  deny: Permission[];
}

export interface TenantPermissionConfig {
  roleOverrides: Partial<Record<SystemRole, {
    grant: Permission[];
    deny: Permission[];
  }>>;
}

// ─── User ─────────────────────────────────────────────────────────────────────

export interface UserPreferences {
  theme: 'dark' | 'light' | 'system';
  language: 'es' | 'en';
  timezone: string;
}

// ─── Subscription ─────────────────────────────────────────────────────────────
//
// Una suscripción por tenant, tracking completo del ciclo de vida.
// Al activar el pago se actualiza: status, plan, currentPeriodEnd, externalId.

export interface SubscriptionPublic {
  id: string;
  tenantId: string;
  plan: TenantPlan;
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  paymentProvider: PaymentProvider | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Portal Connection ────────────────────────────────────────────────────────

export interface PortalConnection {
  id: string;
  tenantId: string;
  portal: PortalType;
  status: PortalConnectionStatus;
  credentialsSet: boolean;
  lastSyncAt?: Date;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Re-exports de tipos de dominio ──────────────────────────────────────────

export type {
  Currency,
  OperationType,
  Permission,
  PortalConnectionStatus,
  PortalType,
  PropertyStatus,
  PropertyType,
  SubscriptionStatus,
  PaymentProvider,
  SystemRole,
  TenantPlan,
  TenantStatus,
  ContactType,
  LeadStatus,
};
