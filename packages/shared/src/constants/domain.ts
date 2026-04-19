// ─── Tipos de propiedad ───────────────────────────────────────────────────────

export const PropertyType = {
  HOUSE: 'house',
  APARTMENT: 'apartment',
  LAND: 'land',
  COMMERCIAL: 'commercial',
  OFFICE: 'office',
  WAREHOUSE: 'warehouse',
  GARAGE: 'garage',
  OTHER: 'other',
} as const;

export type PropertyType = (typeof PropertyType)[keyof typeof PropertyType];

// ─── Tipo de operación ────────────────────────────────────────────────────────

export const OperationType = {
  SALE: 'sale',
  RENT: 'rent',
  TEMPORARY_RENT: 'temporary_rent',
} as const;

export type OperationType = (typeof OperationType)[keyof typeof OperationType];

// ─── Estado de propiedad ──────────────────────────────────────────────────────

export const PropertyStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  RESERVED: 'reserved',
  SOLD: 'sold',
  RENTED: 'rented',
  PAUSED: 'paused',
  ARCHIVED: 'archived',
} as const;

export type PropertyStatus = (typeof PropertyStatus)[keyof typeof PropertyStatus];

// ─── Monedas ──────────────────────────────────────────────────────────────────

export const Currency = {
  ARS: 'ARS',
  USD: 'USD',
  EUR: 'EUR',
} as const;

export type Currency = (typeof Currency)[keyof typeof Currency];

// ─── Portales inmobiliarios ───────────────────────────────────────────────────

export const PortalType = {
  ZONAPROP: 'zonaprop',
  ARGENPROP: 'argenprop',
  MERCADO_LIBRE: 'mercadolibre',
} as const;

export type PortalType = (typeof PortalType)[keyof typeof PortalType];

export const PortalConnectionStatus = {
  CONNECTED: 'connected',
  PENDING: 'pending',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
} as const;

export type PortalConnectionStatus = (typeof PortalConnectionStatus)[keyof typeof PortalConnectionStatus];

// ─── CRM Pipeline ─────────────────────────────────────────────────────────────

export const LeadStatus = {
  NEW: 'new',
  CONTACTED: 'contacted',
  VISIT_SCHEDULED: 'visit_scheduled',
  OPPORTUNITY: 'opportunity',
  RESERVED: 'reserved',
  WON: 'won',
  LOST: 'lost',
} as const;

export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];

// ─── Contactos ────────────────────────────────────────────────────────────────

export const ContactType = {
  LEAD: 'lead',
  CLIENT: 'client',
  OWNER: 'owner',
  TENANT_CONTACT: 'tenant_contact',
  AGENCY: 'agency',
  SUPPLIER: 'supplier',
  OTHER: 'other',
} as const;

export type ContactType = (typeof ContactType)[keyof typeof ContactType];
