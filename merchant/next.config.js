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
    NEXT_PUBLIC_PSP_NAME_PRIMARY: process.env.NEXT_PUBLIC_PSP_NAME_PRIMARY || 'Sec4',
    NEXT_PUBLIC_PSP_NAME_SECONDARY: process.env.NEXT_PUBLIC_PSP_NAME_SECONDARY || 'Pay',
  },
  // The repo has multiple package-lock.json files (root + backend + frontend + merchant),
  // so Turbopack otherwise infers the REPO root as the workspace root and resolves
  // node_modules from there. The merchant's deps (lucide-react, @radix-ui/*) live ONLY in
  // merchant/node_modules, so SSR failed with "Cannot find module 'lucide-react'". Pin the
  // Turbopack root to THIS directory so modules resolve from merchant/node_modules.
  turbopack: {
    root: __dirname,
  },
};

module.exports = nextConfig;
