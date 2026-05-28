import Link from 'next/link';

export default function SimulatorLandingPage() {
  return (
    <div className="max-w-2xl mx-auto mt-12 text-center">
      <div className="text-5xl mb-4">🎬</div>
      <h1 className="text-2xl font-bold mb-3">Simulator Mode</h1>
      <p className="text-gray-600 mb-6">
        Follow Luis Fernandez&apos;s payment journey — from card checkout to automatic fraud
        detection and encrypted investigation. This is a presenter-controlled, story-driven
        walkthrough of MongoDB Queryable Encryption.
      </p>
      <div className="bg-white rounded-xl border p-5 mb-6 text-left text-sm text-gray-700 space-y-2">
        <p>
          <strong>1.</strong> Luis enters card details (masked immediately — raw PAN never sent)
        </p>
        <p>
          <strong>2.</strong> Fields are encrypted before leaving the browser (Review step)
        </p>
        <p>
          <strong>3.</strong> Payment is confirmed and a fraud case is auto-created
        </p>
        <p>
          <strong>4.</strong> Analyst finds Luis&apos;s encrypted record by searching email
        </p>
        <p>
          <strong>5.</strong> Raw Atlas document toggle shows actual ciphertext in Atlas
        </p>
      </div>
      <Link
        href="/simulator/payment"
        className="inline-block bg-[#001E2B] text-[#00ED64] border border-[#00ED64] px-6 py-3 rounded-lg font-semibold hover:bg-[#00ED64] hover:text-[#001E2B] transition-colors"
      >
        Start Demo →
      </Link>
    </div>
  );
}
