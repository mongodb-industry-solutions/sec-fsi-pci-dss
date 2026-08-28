import { BRAND } from '../config/brand';

// The console's entry point. The screens it will hold are the end-user flows (login, consent,
// registration, credentials) and the administration of realms, providers, identities, roles,
// policies, clients, keys, sessions and audit. They arrive with the phase that owns each.
export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-xl text-center">
        <h1 className="text-4xl font-semibold text-mongodb-dark">{BRAND.full}</h1>
        <p className="mt-3 text-gray-600">{BRAND.tagline}</p>
        <p className="mt-8 text-sm text-gray-500">
          The identity authority for employees, customers, services, applications, workloads and
          agents. It authenticates and authorises all of them through one pipeline, and it carries no
          vocabulary from the systems it protects.
        </p>
      </div>
    </main>
  );
}
