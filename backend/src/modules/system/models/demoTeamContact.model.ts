// Demo-only collection (NOT part of the PSP business/BIAN model). It backs the public
// "About us" page used at events and expos: team contact points per area of interest.
// No PII beyond what the person publishes professionally (name, role, LinkedIn handle);
// avatar and QR images are static frontend assets, only their paths are stored here.
export const DEMO_TEAM_CONTACT_COLLECTION = 'demoTeamContact';

export interface DemoTeamContact {
  /** Deterministic id, e.g. "IST-CONTACT-001". */
  demoTeamContactInstanceReference: string;
  name: string;
  /** Job title, e.g. "Industry Consultant (Security & Integrations)". */
  role: string;
  /** What to ask this person about (areas of interest). */
  ask: string;
  /** Optional short area/track label for grouping in the UI. */
  area?: string;
  /** LinkedIn username (not the full URL). */
  linkedin: string;
  /** Public frontend asset path for the avatar, e.g. "/ant-avat.jpg". */
  avatarUrl: string;
  /** Public frontend asset path for the LinkedIn follow QR, e.g. "/ant-qr.png". */
  qrUrl: string;
  active: boolean;
  /** Ascending display order. */
  displayOrder: number;
}
