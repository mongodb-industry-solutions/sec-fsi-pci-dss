import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#001E2B] text-white flex flex-col items-center justify-center p-6">
      <div className="max-w-3xl w-full text-center">
        <div className="text-6xl mb-4">🏦</div>
        <h1 className="text-3xl font-bold mb-2">FSI PCI DSS Payment Security Demo</h1>
        <p className="text-[#00ED64] text-lg mb-8 font-medium">
          MongoDB Queryable Encryption · AWS KMS
        </p>
        <p className="text-gray-400 mb-12 max-w-xl mx-auto">
          Demonstrates how MongoDB supports a PCI DSS-aligned payment investigation workflow
          for digital banks, enabling rapid sensitive data queries while ensuring robust
          encryption and security controls.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link
            href="/simulator"
            className="group block rounded-xl border border-[#00ED64]/30 bg-[#001E2B] hover:bg-[#00ED64]/10 p-6 text-left transition-all"
          >
            <div className="text-3xl mb-3">🎬</div>
            <h2 className="text-xl font-bold mb-2 text-[#00ED64]">Simulator Mode</h2>
            <p className="text-gray-400 text-sm mb-4">
              Story-driven. No login required. Follow Luis&apos;s payment through to fraud
              investigation. Ideal for 10-minute live demos.
            </p>
            <span className="inline-block bg-[#00ED64] text-[#001E2B] px-4 py-1.5 rounded font-semibold text-sm group-hover:opacity-90">
              Start Demo →
            </span>
          </Link>

          <Link
            href="/demo"
            className="group block rounded-xl border border-blue-500/30 bg-[#001E2B] hover:bg-blue-500/10 p-6 text-left transition-all"
          >
            <div className="text-3xl mb-3">🔐</div>
            <h2 className="text-xl font-bold mb-2 text-blue-400">Application Mode</h2>
            <p className="text-gray-400 text-sm mb-4">
              Real login with JWT auth. Role-based routing. Full RBAC and escalation
              workflow. Ideal for hands-on technical evaluations.
            </p>
            <span className="inline-block bg-blue-500 text-white px-4 py-1.5 rounded font-semibold text-sm group-hover:opacity-90">
              → Sign In
            </span>
          </Link>
        </div>

        <p className="mt-12 text-gray-600 text-xs">
          v1 · Security Foundation · MongoDB Atlas · QE equality search · Local KMS fallback
        </p>
      </div>
    </div>
  );
}
