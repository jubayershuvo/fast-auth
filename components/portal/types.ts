/** Shapes the portal server components pass down to the client components. */

/** A device row as `/api/portal/devices` returns it. */
export type PortalDevice = {
  id: string;
  deviceId: string;
  deviceName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Whether the SERVER will currently permit removing it. */
  canDelete: boolean;
  /** How long it has been idle, in ms, measured server-side. */
  idleMs: number;
};

/** The signed-in end user's own account. */
export type PortalProfile = {
  id: string;
  username: string;
  name: string;
  applicationId: string;
  applicationName: string | null;
  /** null = lifetime account. */
  expiresAt: string | null;
  isExpired: boolean;
  devicesUsed: number;
  maxDevices: number;
  lastLoginAt: string | null;
  createdAt: string | null;
  notes: string | null;
};