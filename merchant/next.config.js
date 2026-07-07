/** @type {import('next').NextConfig} */
// Autonomous merchant demo app. No PSP workspace coupling; all domain data via PSP API.
const nextConfig = {
  reactStrictMode: true,
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
