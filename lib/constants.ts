// Application constants
export const APP_CONFIG = {
  APP_ID: "3629fe62-7453-4610-9a5a-1143a87bcce1",
  APP_NAME: "Smart Todos",
  APP_DESCRIPTION: "Collaborative todo lists with sublists, permissions, and real-time sync. Works offline.",
} as const;

export const PERMISSIONS = {
  PUBLIC_READ: 'public-read',
  PUBLIC_WRITE: 'public-write', 
  PRIVATE_READ: 'private-read',
  PRIVATE_WRITE: 'private-write',
  OWNER: 'owner',
} as const;

export const PERMISSION_DESCRIPTIONS = {
  [PERMISSIONS.PUBLIC_READ]: 'Anyone can view',
  [PERMISSIONS.PUBLIC_WRITE]: 'Anyone can edit', 
  [PERMISSIONS.PRIVATE_READ]: 'Members can view',
  [PERMISSIONS.PRIVATE_WRITE]: 'Members can edit',
  [PERMISSIONS.OWNER]: 'Owner only',
} as const;

export const COLORS = {
  THEME: '#2563eb',
} as const;

export const TOAST_DURATION = {
  SHORT: 3000,
  MEDIUM: 5000,
  LONG: 8000,
} as const;
