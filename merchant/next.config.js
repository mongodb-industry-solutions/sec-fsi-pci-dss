/** @type {import('next').NextConfig} */
// Autonomous merchant demo app. No PSP workspace coupling; all domain data via PSP API.
// Load the repo-root .env so one global file configures every app in local dev. Guarded: in Docker
// (merchant-only build context) the root .env / dotenv module are absent, and values then come from
// the container environment or the defaults below.
try { require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') }); } catch { /* no root .env in this context */ }
const nextConfig = {
  reactStrictMode: true,
  env: {
    // Product name (compound, two words). Inlined so the client bundle picks up the value from the
    // root .env / environment; defaults keep the current name when unset.
    NEXT_PUBLIC_PSP_NAME_PRIMARY: process.env.NEXT_PUBLIC_PSP_NAME_PRIMARY || 'Leafy',
    NEXT_PUBLIC_PSP_NAME_SECONDARY: process.env.NEXT_PUBLIC_PSP_NAME_SECONDARY || 'Pay',
  },
  // Pinned explicitly because the repo has several package-lock.json files and Turbopack would
  // otherwise infer a root by guessing. It must be the REPO root, not this directory: the app
  // installs @leafypay/platform-links via `file:../packages/platform-links`, a symlink whose real
  // path sits outside merchant/, and Turbopack cannot resolve a module below its root ("Can't
  // resolve '@leafypay/platform-links'"). Node resolution still walks up from each file, so the
  // merchant-only deps (lucide-react, @radix-ui/*) keep resolving from merchant/node_modules.
  turbopack: {
    root: require('path').resolve(__dirname, '..'),
  },
};

module.exports = nextConfig;
