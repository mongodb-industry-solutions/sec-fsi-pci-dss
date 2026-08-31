import Link from 'next/link';
import { BRAND } from '../config/brand';

// The console's entry point, with the same two ways in as the applications it protects: a guided
// walk through the flows, and the product itself used by somebody who signed in.
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center p-8">
      <div className="text-center">
        <h1 className="text-4xl font-semibold text-mongodb-dark">{BRAND.full}</h1>
        <p className="mt-3 text-gray-600">{BRAND.tagline}</p>
      </div>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        <Link
          href="/simulator"
          className="rounded-xl border bg-white p-6 shadow-sm transition hover:border-[#00ED64]"
        >
          <h2 className="text-xl font-bold text-[#00ED64]">Simulator Mode</h2>
          <p className="mt-2 text-sm text-gray-600">
            Walk an authentication flow step by step as a chosen persona, with the real request and the
            real response at every step.
          </p>
        </Link>

        <Link
          href="/system"
          className="rounded-xl border bg-white p-6 shadow-sm transition hover:border-blue-400"
        >
          <h2 className="text-xl font-bold text-blue-500">Application Mode</h2>
          <p className="mt-2 text-sm text-gray-600">
            Sign in and use the authority as a product: your own authenticators, and the operator
            console when your role permits it.
          </p>
        </Link>
      </div>

      <p className="mt-10 text-center text-sm text-gray-500">
        The identity authority for employees, customers, services, applications, workloads and agents.
        It authenticates and authorises all of them through one pipeline, and it carries no vocabulary
        from the systems it protects.
      </p>

      <div className="mt-8 flex justify-center gap-4 text-sm text-gray-500">
        <Link href="/auth/login" className="underline">Sign-in page</Link>
        <Link href="/admin" className="underline">Operator console</Link>
      </div>
    </main>
  );
}
