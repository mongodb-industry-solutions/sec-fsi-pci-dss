/** @type {import('next').NextConfig} */
const { version: FRONTEND_VERSION } = require('./package.json');
const nextConfig = {
    env: {
        NEXT_PUBLIC_FRONTEND_VERSION: FRONTEND_VERSION,
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
        return [
            { source: '/api/:path*', destination: `${backendUrl}/api/:path*` },
            { source: '/health', destination: `${backendUrl}/health` },
            { source: '/merchant-health', destination: `${merchantUrl}/health` },
        ];
    },
};
module.exports = nextConfig;
