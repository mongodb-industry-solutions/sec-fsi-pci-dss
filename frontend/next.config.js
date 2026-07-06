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
        return [
            { source: '/api/:path*', destination: `${backendUrl}/api/:path*` },
            { source: '/health', destination: `${backendUrl}/health` },
        ];
    },
};
module.exports = nextConfig;
