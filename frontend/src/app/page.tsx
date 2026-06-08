import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, Code2 } from 'lucide-react';
import { API_BASE_URL } from '../lib/constants';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#001E2B] text-white flex flex-col items-center justify-center p-6">
      <div className="max-w-3xl w-full text-center">
        <div className="text-6xl mb-4">🏦</div>
        <h1 className="text-3xl font-bold mb-2">Payment Gateway (FSI - PCI DSS Demo)</h1>
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
              Start Demo
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
              Sign In
            </span>
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
          <a
            href="https://github.com/mongodb-industry-solutions/sec-fsi-pci-dss/wiki"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-700 bg-white/5 hover:border-gray-500 hover:bg-white/10 text-gray-300 hover:text-white text-sm font-medium transition-all"
          >
            <BookOpen size={15} /> Wiki
          </a>
          <a
            href={`${API_BASE_URL}/doc`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-700 bg-white/5 hover:border-gray-500 hover:bg-white/10 text-gray-300 hover:text-white text-sm font-medium transition-all"
          >
            <Code2 size={15} /> API Reference
          </a>
        </div>

        <p className="mt-3 text-gray-600 text-xs">
          v1 · Security Foundation · MongoDB Atlas · QE equality search · Local KMS fallback
        </p>
        <Link
          href="/admin"
          className="mt-8 flex items-center justify-center gap-3 opacity-40 hover:opacity-90 transition-opacity group"
        >
          <div className="overflow-hidden rounded-full w-8 h-8 shrink-0">
            <Image
              src="/mongodb-badge.png"
              alt="MongoDB"
              width={32}
              height={32}
              className="scale-110"
            />
          </div>
          <span className="text-gray-500 text-xs tracking-wide group-hover:text-gray-300 transition-colors">Built on MongoDB Atlas</span>
        </Link>
      </div>
    </div>
  );
}
