/** @type {import('next').NextConfig} */
// The bank's own administration app. It talks to bank/backend and to nothing else: there is no PSP
// workspace coupling here, and no PSP endpoint in the browser bundle.
//
// The repo root .env configures every app in local dev. Guarded, because a bank-only Docker build context
// has neither the root .env nor the dotenv module, and the values then come from the container environment.
try { require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') }); } catch { /* no root .env in this context */ }

const nextConfig = {
  reactStrictMode: true,
  // Several package-lock files exist in this repo, so Turbopack would otherwise infer the REPO root as the
  // workspace root and resolve node_modules from there, where this app's dependencies do not live.
  turbopack: { root: __dirname },
};

module.exports = nextConfig;
