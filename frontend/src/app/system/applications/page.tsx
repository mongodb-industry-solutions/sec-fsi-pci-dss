// v18: canonical top-level "Authorized Applications" section for ALL roles (self-scoped).
// The user (merchant or not, incl. L1/L2/auditors) always sees their own authorized apps.
// Re-exports the connected-apps view (DRY) — logic lives in profile/applications.
export { default } from '../profile/applications/page';
