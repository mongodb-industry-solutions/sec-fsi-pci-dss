/** @type {import('next').NextConfig} */
// Load the repo-root .env so a single global file configures every app in local dev (the backend
// already does this). Guarded: in Docker (frontend-only build context) the root .env / dotenv module
// are absent, and the values then come from the container environment or the defaults below.
try { require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') }); } catch { /* no root .env in this context */ }
const { version: FRONTEND_VERSION } = require('./package.json');
// The canonical project version lives in the repo-root package.json. In Docker (Kaniko) the build
// context is the frontend/ dir only, so the repo root is not present: fall back to a build-arg env
// or the frontend version instead of crashing on a missing module.
let APP_VERSION;
try {
    APP_VERSION = require('../package.json').version;
} catch {
    APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || FRONTEND_VERSION;
}
const nextConfig = {
    env: {
        NEXT_PUBLIC_FRONTEND_VERSION: FRONTEND_VERSION,
        NEXT_PUBLIC_APP_VERSION: APP_VERSION,
        // Product name (compound, two words). Inlined so the client bundle picks up the value from the
        // root .env / environment; defaults keep the current name when unset.
        NEXT_PUBLIC_PSP_NAME_PRIMARY: process.env.NEXT_PUBLIC_PSP_NAME_PRIMARY || 'Leafy',
        NEXT_PUBLIC_PSP_NAME_SECONDARY: process.env.NEXT_PUBLIC_PSP_NAME_SECONDARY || 'Pay',
        // Public frontend URL (same value the backend uses for deep links), inlined for the share QR.
        NEXT_PUBLIC_PSP_URL_FRONTEND: process.env.PSP_URL_FRONTEND || '',
    },
    allowedDevOrigins: ['127.0.0.1', 'localhost'],
    async rewrites() {
        const backendUrl =
            process.env.NEXT_PUBLIC_PSP_URL_BACKEND_PRIVATE ||
            process.env.NEXT_PUBLIC_PSP_URL_BACKEND_PUBLIC ||
            'http://localhost:8081';
        // Merchant health is probed server-side (same-origin proxy) so the admin monitoring page never
        // does a cross-origin browser fetch (avoids CORS + public-ingress dependency). Prefer the
        // in-cluster private URL, fall back to the public one, then localhost for dev.
        const merchantUrl = (
            process.env.NEXT_PUBLIC_PSP_URL_MERCHANT_PRIVATE ||
            process.env.NEXT_PUBLIC_PSP_URL_MERCHANT ||
            'http://localhost:8082'
        ).replace(/\/+$/, '');
        // bankcore is probed the same way, and for a stronger reason: it is a PRIVATE service with no
        // public ingress, so there is no public URL to fall back to. A browser fetch would fail as a
        // CORS error locally and as unreachable in staging, which is the same bug with two symptoms.
        const bankcoreUrl = (
            process.env.NEXT_PUBLIC_PSP_URL_BANKCORE_PRIVATE ||
            'http://localhost:8083'
        ).replace(/\/+$/, '');
        return [
            { source: '/api/:path*', destination: `${backendUrl}/api/:path*` },
            { source: '/health', destination: `${backendUrl}/health` },
            // Per-service health aliases. They exist only because bare /health on this origin is
            // already the backend's; each one forwards to that service's OWN /health, which is also
            // the path the deploy platform probes.
            { source: '/health/merchant', destination: `${merchantUrl}/health` },
            { source: '/health/bankcore', destination: `${bankcoreUrl}/health` },
            // Swagger UI of the bank, same-origin so it works in every environment. The API behind it
            // needs a registered TPP's credentials, so publishing the docs opens nothing.
            { source: '/doc/bankcore', destination: `${bankcoreUrl}/doc` },
            { source: '/doc/bankcore/:path*', destination: `${bankcoreUrl}/doc/:path*` },
        ];
    },
};
module.exports = nextConfig;
