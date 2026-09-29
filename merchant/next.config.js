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
  // Pinned to THIS directory. The repo has several package-lock.json files, so Turbopack would
  // otherwise infer the REPO root and resolve node_modules from there, and the merchant's own deps
  // (lucide-react, @radix-ui/*) live only in merchant/node_modules. Rooting it at the repo instead
  // made every render compile the whole monorepo and left the app's own client components out of
  // the React Client Manifest ("Could not find the module .../error.tsx#default"), so the shared
  // @leafypay/platform-links package is installed COPIED rather than symlinked (`--install-links`)
  // and resolves from inside this root like any other dependency.
  turbopack: {
    root: __dirname,
  },
};

module.exports = nextConfig;
