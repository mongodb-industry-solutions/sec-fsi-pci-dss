'use client';
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface QACategory {
  id: 1 | 2 | 3 | 4;
  label: string;
  emoji: string;
  emojiOffset?: string;
  color: { badge: string; border: string; text: string; bg: string };
}

interface QAItem {
  id: number;
  category: 1 | 2 | 3 | 4;
  question: string;
  answer: React.ReactNode;
  tags: string[];
}

// ─── Micro-components ────────────────────────────────────────────────────────

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-gray-400 text-sm leading-relaxed mb-3 last:mb-0">{children}</p>;
}

function Em({ children }: { children: React.ReactNode }) {
  return <span className="text-gray-200 font-medium">{children}</span>;
}

function G({ children }: { children: React.ReactNode }) {
  return <span className="text-[#00ED64] font-medium">{children}</span>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="text-[11px] bg-gray-800 px-1.5 py-0.5 rounded text-[#00ED64]/80 font-mono">{children}</code>;
}

function Ul({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-1.5 my-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="text-[#00ED64]/60 shrink-0 text-sm leading-5">›</span>
          <span className="text-gray-400 text-sm leading-snug">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Callout({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 p-3 bg-[#00ED64]/[0.05] border border-[#00ED64]/20 rounded-lg">
      {label && <span className="text-[10px] font-bold text-[#00ED64] uppercase tracking-widest mr-2">{label}</span>}
      <span className="text-gray-300 text-sm leading-snug">{children}</span>
    </div>
  );
}

function Note({ label, color, children }: { label: string; color: 'violet' | 'green' | 'amber'; children: React.ReactNode }) {
  const cls = {
    violet: 'bg-violet-950/30 border-violet-700/30 text-violet-400',
    green:  'bg-[#00ED64]/[0.04] border-[#00ED64]/20 text-[#00ED64]',
    amber:  'bg-amber-950/30 border-amber-700/30 text-amber-400',
  }[color];
  return (
    <div className={`p-3 rounded-lg border ${cls.split(' ').slice(0, 2).join(' ')}`}>
      <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${cls.split(' ')[2]}`}>{label}</p>
      <div className="text-xs text-gray-400 leading-relaxed">{children}</div>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto my-3 rounded-lg border border-gray-800">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-800/60">
            {headers.map(h => (
              <th key={h} className="text-left px-3 py-2 text-[#00ED64]/80 font-semibold whitespace-nowrap border-b border-gray-700">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 !== 0 ? 'bg-gray-800/20' : ''}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 text-gray-400 border-b border-gray-800/50 align-top leading-snug">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Categories ───────────────────────────────────────────────────────────────

const CATEGORIES: QACategory[] = [
  { id: 1, emoji: '📋', label: 'General PCI DSS',
    color: { badge: 'bg-sky-600 border-sky-600 text-white', border: 'border-l-sky-500', text: 'text-sky-400', bg: 'bg-sky-500/10' } },
  { id: 2, emoji: '🔐', label: 'QE Design & Technical Architecture',
    color: { badge: 'bg-violet-600 border-violet-600 text-white', border: 'border-l-violet-500', text: 'text-violet-400', bg: 'bg-violet-500/10' } },
  { id: 3, emoji: '🏛️', label: 'Atlas Certification Architecture',
    color: { badge: 'bg-emerald-600 border-emerald-600 text-white', border: 'border-l-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/10' } },
  { id: 4, emoji: '💳', label: 'PAN Storage, Tokenization & BIAN', emojiOffset: '-2px',
    color: { badge: 'bg-amber-600 border-amber-600 text-white', border: 'border-l-amber-500', text: 'text-amber-400', bg: 'bg-amber-500/10' } },
];

// ─── Q&A Data ─────────────────────────────────────────────────────────────────
// Source: tmp/wiki/Q&A.md, reviewed by security architects, QSAs, and FSI prospects.

const QA_DATA: QAItem[] = [

  // ── Category 1: General PCI DSS ─────────────────────────────────────────────

  {
    id: 1, category: 1,
    question: 'What is PCI DSS?',
    answer: <P>PCI DSS (Payment Card Industry Data Security Standard) is an information security standard developed by the PCI Security Standards Council. It applies to all entities that store, process, and/or transmit cardholder data.</P>,
    tags: ['PCI DSS', 'compliance', 'standard'],
  },
  {
    id: 2, category: 1,
    question: 'Is MongoDB Cloud PCI DSS certified?',
    answer: <P>Yes. MongoDB Cloud achieved <Em>PCI DSS 4.0</Em> certification as of September 2023, assessed annually by <Em>Schellman Compliance, LLC</Em> as an independent Qualified Security Assessor (QSA).</P>,
    tags: ['certification', 'MongoDB Atlas', 'AOC'],
  },
  {
    id: 3, category: 1,
    question: 'I am a PCI DSS merchant. Can I store cardholder data on MongoDB Cloud?',
    answer: (
      <div>
        <P>Yes. MongoDB Cloud is a <Em>PCI DSS certified service provider</Em>. Depending on your selection, MongoDB Atlas runs on AWS, GCP, and/or Microsoft Azure, which are each PCI DSS compliant.</P>
        <Ul items={[
          <><Em>AWS:</Em> aws.amazon.com/security/pci-dss/</>,
          <><Em>GCP:</Em> cloud.google.com/security/compliance/pci-dss</>,
          <><Em>Azure:</Em> azure.microsoft.com/overview/compliance/pci-dss/</>,
        ]} />
      </div>
    ),
    tags: ['CHD', 'cloud', 'storage', 'AWS', 'GCP', 'Azure'],
  },
  {
    id: 4, category: 1,
    question: 'If I use MongoDB Cloud for storing, processing, and/or transmitting cardholder data, will I be automatically compliant with PCI DSS?',
    answer: (
      <div>
        <P><Em>No.</Em> Customers must manage their own PCI DSS compliance certification, and additional testing will be required to verify that your environment satisfies all PCI DSS requirements.</P>
        <P>However, for the portion of the PCI cardholder data environment (CDE) in MongoDB Cloud, your QSA can rely on the MongoDB Cloud Attestation of Compliance (AOC) without further testing.</P>
      </div>
    ),
    tags: ['compliance', 'AOC', 'QSA', 'shared responsibility'],
  },
  {
    id: 5, category: 1,
    question: 'Where can I download the PCI DSS certificate for MongoDB Cloud?',
    answer: (
      <div>
        <P>The MongoDB Cloud PCI Attestation of Compliance (AOC) is available upon request via the MongoDB Trust Center.</P>
        <Ul items={[
          'Existing customers: request documentation via the MongoDB contact page.',
          'Prospective customers: contact MongoDB sales.',
        ]} />
      </div>
    ),
    tags: ['AOC', 'certificate', 'Trust Center'],
  },
  {
    id: 6, category: 1,
    question: 'Which security features can help towards my PCI DSS compliance?',
    answer: (
      <div>
        <P>Several features available in MongoDB Atlas may help towards PCI DSS compliance:</P>
        <Ul items={[
          'Configure federated identity with an identity provider.',
          'Create clusters with TLS 1.2 support by default.',
          'Set up network peering or a Private Endpoint so that cardholder data is always encrypted over private networks.',
          'Enable database auditing.',
          'Use Client-Side Field Level Encryption (CSFLE) or Queryable Encryption (QE) to encrypt document fields before they reach MongoDB Atlas.',
        ]} />
      </div>
    ),
    tags: ['security features', 'TLS', 'Private Endpoint', 'CSFLE', 'QE', 'auditing'],
  },
  {
    id: 7, category: 1,
    question: 'Who is the Qualified Security Assessor (QSA) for MongoDB?',
    answer: <P><Em>Schellman Compliance, LLC</Em> is the independent QSA for MongoDB.</P>,
    tags: ['QSA', 'Schellman'],
  },
  {
    id: 8, category: 1,
    question: 'Which MongoDB services are in the scope of the PCI DSS certification?',
    answer: (
      <div>
        <P>The scope of PCI DSS 4.0 certification includes: MongoDB Atlas, MongoDB App Services on Atlas, MongoDB Charts, MongoDB Serverless on Atlas, Cloud Manager, MongoDB Data Federation on Atlas, MongoDB Search on Atlas, and MongoDB Atlas for Government.</P>
        <P>Any products or features that are in <Em>beta, preview, or similar are not in scope</Em>.</P>
      </div>
    ),
    tags: ['scope', 'Atlas', 'certification', 'in-scope services'],
  },

  // ── Category 2: QE Design & Technical Architecture ────────────────────────

  {
    id: 9, category: 2,
    question: 'Why is the card token (payment token) stored in plaintext and not encrypted with Queryable Encryption?',
    answer: (
      <div>
        <P>A properly implemented payment token is a surrogate for the Primary Account Number (PAN). Under PCI DSS v4.0, a token that meets the requirements of the standard (irreversible, or reversible only through a controlled token vault with additional authentication factors) is <Em>not classified as cardholder data</Em> and therefore does not require the same protections as a PAN. Encrypting it with QE and presenting that as a PCI requirement would be technically incorrect and could mislead a security-aware audience.</P>
        <P>This system stores <Code>paymentCardReference</Code> as a plaintext indexed field. The QE encryption story focuses on fields that genuinely are PII or CHD: <Code>customerEmailAddress</Code>, <Code>customerMobilePhoneNumber</Code>, and <Code>cardTransactionAccountReference</Code>.</P>
        <Callout label="Key Principle">Encrypt what the standard requires, and nothing more. Over-encrypting non-sensitive fields obscures the real story and raises questions about whether the design team understands the standard.</Callout>
      </div>
    ),
    tags: ['tokenization', 'plaintext', 'QE', 'PAN', 'CHD'],
  },
  {
    id: 10, category: 2,
    question: 'Does this solution need to mention magnetic stripe (track) data in the SAD prohibition list?',
    answer: (
      <div>
        <P>PCI DSS v4.0 defines three categories of SAD that must <Em>never be stored after authorization</Em>: card verification codes (CVV/CVC2), PINs, and full track data. The prohibition is on <Em>storage</Em>, not on transmission: SAD is allowed in transit during the authorization window.</P>
        <P>This system acts as a PSP intermediary. Sensitive card data received during payment initiation is encrypted immediately and forwarded securely to the card issuer through the external provider integration layer. The card issuer performs authorization on its side and returns an approval or decline. The <Em>PSP core</Em> stays descoped: it persists only the tokenized reference plus <Code>paymentCardBin</Code> and <Code>paymentCardLast4</Code> (non-CHD). The <Em>CVV, PIN and track data are never persisted</Em> anywhere; the built-in issuer module even <Em>derives</Em> the per-card CVV on demand (HMAC-SHA256 under an issuer key, the CVK) instead of storing it.</P>
        <P>When the built-in <Code>card-issuer</Code> module is the active provider it stores the <Em>full PAN</Em> and the <Code>cardServiceCode</Code> encrypted with Queryable Encryption in its own module-owned vault (<Code>cardIssuerVault</Code>, the issuer CDE), never in the PSP core. With an external issuer provider no PAN is stored at all.</P>
        <Callout label="Key PCI DSS Point">The SAD prohibition is satisfied by design: CVV/PIN/track data are never stored (the CVV is derived on demand). The full PAN is CHD, not SAD: it is kept out of the PSP core entirely and, only inside the issuer module, encrypted under QE with reveal on demand. This is the correct posture for a CNP PSP with a scope-contained issuer subsystem.</Callout>
      </div>
    ),
    tags: ['SAD', 'magnetic stripe', 'track data', 'Card Not Present', 'CVV', 'PIN', 'card issuer', 'pass-through', 'never stored'],
  },
  {
    id: 11, category: 2,
    question: 'What is the difference between Sensitive Authentication Data (SAD) and Cardholder Data (CHD) under PCI DSS?',
    answer: (
      <div>
        <Table
          headers={['Category', 'Storage after authorization', 'Included fields']}
          rows={[
            ['🟡 Cardholder Data (CHD)', 'May be stored if protected per the standard', 'PAN (must be rendered unreadable), Cardholder name, Expiration date, Service code'],
            ['🔴 Sensitive Authentication Data (SAD)', 'Must NEVER be stored, even if encrypted', 'Full magnetic stripe / chip data, Card verification codes (CVV2/CVC2/CID), PINs and PIN blocks'],
          ]}
        />
        <P>The critical distinction: SAD cannot be retained post-authorization under any circumstances, while CHD can be stored if appropriate protections are in place. The correct approach is applied throughout: card tokens and masked PANs are stored; expiry dates use QE:none; CVV and PIN are never accepted or stored at any API endpoint.</P>
        <P>The <Em>service code</Em> is CHD (not SAD; only the full magnetic-stripe track is prohibited). When it applies, it is stored <Em>encrypted (QE:equality) in the built-in issuer vault</Em> (<Code>cardServiceCode</Code> in <Code>cardIssuerVault</Code>), never in the PSP core, and it feeds the per-card CVV derivation.</P>
      </div>
    ),
    tags: ['SAD', 'CHD', 'PAN', 'CVV', 'PIN', 'track data'],
  },
  {
    id: 12, category: 2,
    question: 'Why does the system encrypt the card expiration date (QE:none) if the payment token is stored plaintext?',
    answer: (
      <div>
        <P>The expiry date is different from the token. Under PCI DSS v4.0, the expiration date is classified as <Em>Cardholder Data (CHD)</Em> when stored in conjunction with a PAN. In this system it is stored alongside <Code>paymentCardReference</Code> (the token), <Code>paymentCardBin</Code> and <Code>paymentCardLast4</Code>. The masked PAN is no longer a persisted field: it is derived on the fly from BIN + last4 + network. The expiry date co-located with card account data is a conservative but correct classification, and the cost of protecting it with QE:none is negligible.</P>
        <P>QE:none also serves an illustrative purpose: it shows the &ldquo;non-searchable sensitive field&rdquo; pattern; data is encrypted but not queryable, visible only after decryption with the correct DEK. This is the same pattern used for <Code>customerAgreementResidentialAddress</Code> and <Code>customerAgreementRiskNotes</Code> in the escalation workflow.</P>
      </div>
    ),
    tags: ['expiration date', 'QE:none', 'CHD', 'DEK', 'non-searchable'],
  },
  {
    id: 13, category: 2,
    question: 'How does MongoDB Queryable Encryption differ from standard encryption or Client-Side Field Level Encryption (CSFLE)?',
    answer: (
      <div>
        <Table
          headers={['Approach', 'Where encrypted', 'Searchable', 'Key holder']}
          rows={[
            ['Encryption at rest (Atlas default)', 'Storage layer', 'No', 'MongoDB (platform)'],
            ['CSFLE (explicit mode)', 'Application client', 'Equality only (deterministic)', 'Customer'],
            ['Queryable Encryption (QE)', 'Application client', 'Yes, equality and range', 'Customer'],
          ]}
        />
        <P>QE is the evolution of CSFLE. Both encrypt fields before the data reaches the server and both require the customer to hold the keys via AWS KMS or similar. The key difference is that QE supports equality <em>and</em> range queries on encrypted fields using a cryptographic metadata structure, without decrypting the field on the server side. This solution uses QE only (not CSFLE) to keep the architecture focused and explainable.</P>
      </div>
    ),
    tags: ['QE', 'CSFLE', 'encryption at rest', 'CMK', 'KMS', 'searchable encryption'],
  },
  {
    id: 14, category: 2,
    question: 'If the token is not CHD, why does this solution use tokenization at all? What security problem does it solve?',
    answer: (
      <div>
        <P>Tokenization solves a different problem than encryption. The goal is to <Em>remove the PAN from the payment flow entirely</Em>: the merchant, the issuing bank&apos;s application layer, and all downstream systems receive only a token. This limits the number of systems that ever touch the real PAN to the token vault (operated by the PSP or payment network), which dramatically <Em>reduces PCI DSS scope</Em>.</P>
        <P>In this system, the client-side code generates a token before the API call. The raw PAN never travels over the network and is never stored anywhere in the system. The combination of <G>tokenization</G> (removes PAN risk) and <G>QE</G> (protects PII) represents a defense-in-depth posture appropriate for a digital bank.</P>
      </div>
    ),
    tags: ['tokenization', 'PAN', 'scope reduction', 'defense-in-depth', 'PSP'],
  },
  {
    id: 15, category: 2,
    question: 'Can a QSA rely on the MongoDB Atlas AOC for the QE encryption layer of my application?',
    answer: (
      <div>
        <P><Em>Partially.</Em> The MongoDB Atlas AOC covers the certified PCI DSS scope of the platform: storage, network, and infrastructure. It does not cover your application&apos;s implementation of QE, key management practices, or how you handle the Data Encryption Keys (DEKs) and Customer Master Key (CMK).</P>
        <P>Your QSA will still need to assess:</P>
        <Ul items={[
          <><Em>Req 3.6:</Em> How the CMK is managed in AWS KMS, DEK rotation schedules, and the KMS key policy.</>,
          'How DEKs are provisioned and rotated.',
          'How the application client (backend service) holds and uses the KMS credentials.',
          <><Em>Req 7:</Em> Whether access to the decryption capability is role-restricted.</>,
          <><Em>Req 10:</Em> Whether every field-access event is audited.</>,
        ]} />
        <P>The MongoDB AOC reduces the burden of assessing the platform layer; your assessor applies their judgment to the application layer.</P>
      </div>
    ),
    tags: ['QSA', 'AOC', 'CMK', 'DEK', 'KMS', 'key management', 'Req 3.6'],
  },
  {
    id: 16, category: 2,
    question: 'Does encrypting PII fields with QE put them outside PCI DSS scope?',
    answer: (
      <div>
        <P><Em>Not automatically.</Em> PCI DSS scope is primarily determined by the presence of <Em>cardholder data (CHD)</Em>, specifically the PAN. Fields like email address and phone number are PII but are not CHD under PCI DSS. They would be in scope for other frameworks such as GDPR and CCPA, but their presence does not extend your PCI CDE.</P>
        <P>Scope reduction in PCI DSS is better achieved through <G>tokenization</G> (removing the PAN from downstream systems) and <G>network segmentation</G> (Private Endpoint, VPC peering), both of which this architecture demonstrates. The design choice to encrypt PII with QE is primarily a privacy and defense-in-depth decision, not a PCI scoping reduction strategy.</P>
      </div>
    ),
    tags: ['PII', 'scope', 'GDPR', 'CCPA', 'CHD', 'PAN', 'CDE'],
  },

  // ── Category 3: Atlas Certification Architecture ─────────────────────────

  {
    id: 17, category: 3,
    question: 'What does the MongoDB Atlas PCI DSS certification actually cover, and what remains the customer\'s responsibility?',
    answer: (
      <div>
        <P>The Atlas PCI DSS 4.0 AOC means Schellman assessed MongoDB&apos;s cloud database service and found it meets PCI DSS requirements for how MongoDB operates the platform as a service provider. There are two completely separate layers of responsibility:</P>
        <div className="my-3 space-y-2">
          <div className="p-3 bg-[#00ED64]/[0.04] rounded-lg border border-[#00ED64]/20">
            <p className="text-[10px] font-bold text-[#00ED64] uppercase tracking-widest mb-1">Layer 1: Atlas Platform (MongoDB&apos;s Responsibility)</p>
            <p className="text-xs text-gray-500 leading-relaxed">Encryption at rest, TLS, network controls, audit log infrastructure; covered by the AOC, assessed by Schellman annually.</p>
          </div>
          <div className="p-3 bg-gray-800/40 rounded-lg border border-gray-700/50">
            <p className="text-[10px] font-bold text-violet-400 uppercase tracking-widest mb-1">Layer 2: Customer Application (Customer&apos;s Responsibility)</p>
            <p className="text-xs text-gray-500 leading-relaxed">QE implementation, AWS KMS key management, app RBAC, SAD prohibition, tokenization; NOT covered by the Atlas AOC.</p>
          </div>
        </div>
        <P><Em>What the AOC covers (Layer 1):</Em></P>
        <Table
          headers={['PCI DSS Requirement', 'Atlas Feature']}
          rows={[
            ['Req 1–2 (Network security)', 'IP Access Lists, VPC Peering, Private Endpoints, tenant isolation between clusters'],
            ['Req 3.4 (CHD unreadable at rest)', 'AES-256 encryption at rest on all storage volumes and backup media'],
            ['Req 4 (Encryption in transit)', 'TLS 1.2+ enforced on all client connections; cannot be disabled'],
            ['Req 7–8 (Access control & auth)', 'Atlas RBAC, MFA on Atlas console, LDAP integration, privileged access management'],
            ['Req 10 (Audit logging)', 'Atlas Audit Log infrastructure, maintained and secured by MongoDB'],
            ['Req 11–12 (Vuln. management)', 'MongoDB patching program, security scanning, and information security policies'],
          ]}
        />
        <P><Em>What the AOC does NOT cover (Layer 2):</Em></P>
        <Ul items={[
          'Application code and its security practices.',
          'How QE or CSFLE or any application-side encryption is implemented.',
          'Customer-managed key practices: the CMK in AWS KMS, DEK rotation schedules, and the KMS key policy.',
          'Application-level access control and field visibility logic (Level 1 vs Level 2 analyst roles in this system).',
          'Whether the application ever accepts or stores CVV, PIN, or full PAN.',
          'Any Atlas product currently in beta or preview status.',
        ]} />
      </div>
    ),
    tags: ['AOC', 'shared responsibility', 'Layer 1', 'Layer 2', 'Schellman', 'platform coverage'],
  },
  {
    id: 18, category: 3,
    question: 'Is Queryable Encryption (QE) required for Atlas to be PCI DSS certified? What specific PCI DSS requirements does it address?',
    answer: (
      <div>
        <P><Em>QE is not what certifies Atlas.</Em> The certification is based on platform-level controls: AES-256 at rest, TLS in transit, network security, and MongoDB&apos;s operational security program. Atlas was PCI DSS certified before QE existed as a product.</P>
        <P>QE is an application-side control deployed on top of the platform certification. The table below shows which threat scenarios each layer actually protects against:</P>
        <Table
          headers={['Threat scenario', 'AES-256 at rest (Atlas)', 'QE client-side (application)']}
          rows={[
            ['Attacker steals physical disk or backup media', '✅ Protected', '✅ Protected'],
            ['Attacker compromises Atlas account credentials', '❌ Disk decrypted for any authenticated query', '✅ Atlas stores only ciphertext regardless of who authenticates'],
            ['MongoDB internal access (employee, support tooling)', '❌ Atlas decrypts internally before processing queries', '✅ Atlas never receives a decryptable value'],
            ['Plaintext CHD in slow query logs or explain plans', '❌ Not protected', '✅ Only ciphertext appears in any server-side log'],
            ['App-layer attacker with backend code but no KMS access', '❌ Not protected', '✅ Without the CMK, the DEK cannot be unwrapped'],
          ]}
        />
        <P><Em>QE directly addresses specific PCI DSS v4.0 requirements:</Em></P>
        <Ul items={[
          <><Em>Req 3.4:</Em> CHD field is encrypted before the BSON document leaves the application server. MongoDB never receives plaintext, so it cannot appear in any server-side log, memory snapshot, or diagnostic tool.</>,
          <><Em>Req 3.6:</Em> The CMK is held exclusively by the customer in AWS KMS. Revoking the CMK immediately renders all QE-encrypted data unreadable from every system, including Atlas itself.</>,
          <><Em>Req 7:</Em> A user with full Atlas admin credentials querying without the QE client receives only opaque binary ciphertext. The restriction is <em>mathematical</em>, not policy-based, and cannot be bypassed by any administrative action inside Atlas.</>,
          <><Em>Req 10:</Em> Every decryption event occurs in the application layer, where it can be logged with full business context: user, role, fraud case, fields accessed, and timestamp.</>,
        ]} />
        <Callout label="Key Principle">Atlas certification covers the infrastructure contract. QE covers the data contract. A complete PCI DSS posture requires both.</Callout>
      </div>
    ),
    tags: ['QE', 'PCI DSS', 'Req 3.4', 'Req 3.6', 'Req 7', 'Req 10', 'threat model', 'certification'],
  },
  {
    id: 19, category: 3,
    question: 'How does the "Encrypted in Atlas" toggle prove that MongoDB cannot read cardholder data?',
    answer: (
      <div>
        <P>The toggle demonstrates the encryption boundary by calling the same document through two different backend paths and showing the results side by side.</P>
        <div className="space-y-2 my-3">
          <Note label="🔓 Decrypted view: normal application path" color="green">
            The Fastify backend queries Atlas using the QE-enabled MongoClient. The QE driver contacts AWS KMS to unwrap the DEK, then decrypts the encrypted fields in the application process before returning the document. The response contains readable values: <Code>customerEmailAddress</Code>, <Code>customerMobilePhoneNumber</Code>, <Code>cardTransactionAccountReference</Code>.
          </Note>
          <Note label="🔒 Raw Atlas view: what MongoDB stores on disk" color="violet">
            A second backend endpoint queries the same document using a plain MongoClient with no QE configuration and no DEK. It receives the BSON document exactly as Atlas stores it. The encrypted fields are opaque binary ciphertext. No MongoDB DBA, Atlas console user, or MongoDB employee can recover the original value from these bytes without the DEK and the CMK.
          </Note>
        </div>
        <Note label="🎤 Presenter Talking Point" color="amber">
          <em>&ldquo;This is what Atlas sees. Not the email address. Not the account reference. Just encrypted bytes. The only system that can read these fields is your backend service, using your keys, stored in your KMS. MongoDB has zero access to those keys. This is not a contractual promise. It is a mathematical guarantee.&rdquo;</em>
        </Note>
      </div>
    ),
    tags: ['toggle', 'ciphertext', 'proof', 'DEK', 'CMK', 'presenter'],
  },

  // ── Category 4: PAN Storage, Tokenization & BIAN ──────────────────────────

  {
    id: 20, category: 4,
    question: 'How does this solution satisfy PCI DSS Requirement 3.4 (PAN must be rendered unreadable wherever it is stored)?',
    answer: (
      <div>
        <P>This solution satisfies Requirement 3.4 with a clear scope boundary. The <Em>PSP core is descoped</Em>: it never stores the full PAN, only a token plus BIN and last4. When the built-in issuer module is active, the full PAN is stored <Em>only</Em> inside that module-owned vault, encrypted with Queryable Encryption (the server never sees plaintext), and rendered unreadable wherever it rests.</P>
        <P>What the <Em>PSP core</Em> stores per card:</P>
        <Table
          headers={['Field', 'Value example', 'Classification', 'Storage']}
          rows={[
            [<Code>paymentCardReference</Code>, 'pm_7xB2kp1q', 'Card surrogate, not CHD', 'Plaintext, standard index'],
            [<Code>paymentCardBin</Code>, '424242', 'BIN, non-CHD (PCI permits ≤ 8)', 'Plaintext, indexed (prefix search)'],
            [<Code>paymentCardLast4</Code>, '4242', 'Non-CHD', 'Plaintext, indexed (masked PAN derived, not stored)'],
            [<Code>cardExpirationDate</Code>, '[ciphertext]', 'CHD', 'QE:none, encrypted and non-searchable'],
            ['CVV / PIN', 'not present', 'SAD', 'Never stored; CVV derived on demand'],
          ]}
        />
        <P>What the <Em>built-in issuer vault</Em> (<Code>cardIssuerVault</Code>, the issuer CDE) stores, only while the module owns the capability:</P>
        <Table
          headers={['Field', 'Classification', 'Storage']}
          rows={[
            [<Code>paymentCardNumber</Code>, 'PAN (CHD)', 'QE:equality ciphertext; revealed on demand, audited'],
            [<Code>cardServiceCode</Code>, 'CHD', 'QE:equality ciphertext'],
            ['CVV / PIN', 'SAD', 'Never stored'],
          ]}
        />
        <P>With an external issuer provider, no PAN is stored by this system at all: the PAN is then held by that provider or the network token vault (e.g., Visa Token Service or Mastercard MDES), a separately PCI DSS certified environment.</P>
      </div>
    ),
    tags: ['Req 3.4', 'PAN', 'tokenization', 'non-storage', 'maskedPan', 'Visa Token Service'],
  },
  {
    id: 21, category: 4,
    question: '"Save card" is a planned feature. How should recurring payment / saved card be implemented to be PCI DSS compliant?',
    answer: (
      <div>
        <P>Save card for recurring payment is a v4 feature (not yet implemented). The current architecture already has the correct foundation; v4 needs four additions to existing collections and one new endpoint scope.</P>
        <P><Em>What to store per saved card:</Em></P>
        <Table
          headers={['Field', 'Requirement']}
          rows={[
            [<Code>paymentCardReference</Code>, 'Not CHD; plaintext storage is correct (see Q9)'],
            [<Code>maskedPanDisplay</Code>, 'Permitted for UI display'],
            [<><Code>cardExpirationDate</Code> [ciphertext]</>, 'CHD; QE:none already correct'],
            [<Code>cardholderConsentTimestamp</Code>, 'Required: Req 3.1 + network rules'],
            [<><Code>mandateStatus</Code> (active / cancelled / expired)</>, 'Required for Req 3.7 purge logic'],
          ]}
        />
        <P><Em>⛔ CVV on file is always prohibited (Requirement 3.3).</Em> Recurring transactions are merchant-initiated and do not require CVV re-entry; the stored consent replaces it.</P>
        <P><Em>Four requirements specific to recurring payment:</Em></P>
        <Ul items={[
          <><Em>Explicit cardholder consent (Req 3.1 + network rules):</Em> The save-card step must present an explicit consent checkbox and record the <Code>cardholderConsentTimestamp</Code>. Without documented consent, storing card data for future charges violates both PCI DSS and payment network rules.</>,
          <><Em>Scope-limited access to the charge trigger (Req 7):</Em> Only the payment processing service should be able to initiate a new charge. Fraud investigation and analytics roles must not have access to the recurring charge endpoint.</>,
          <><Em>Periodic purge of unused stored cards (Req 3.7):</Em> Stored card data must be deleted when the customer cancels the mandate, when the card expires with no replacement token, or when the agreed retention period ends.</>,
          <><Em>Token lifecycle and automatic card update:</Em> Network tokens issued by Visa Token Service or Mastercard MDES can auto-update when the physical card is reissued via Visa Account Updater (VAU) or Mastercard Automatic Billing Updater (ABU).</>,
        ]} />
      </div>
    ),
    tags: ['recurring payment', 'save card', 'v4', 'consent', 'mandate', 'CVV', 'Req 3.3', 'Req 3.7'],
  },
  {
    id: 22, category: 4,
    question: 'Why can\'t a Level 2 Investigator see sensitive customer data just by having the Level 2 role? What is the escalation token and why is it required?',
    answer: (
      <div>
        <P>This is one of the most important design decisions in the v2 architecture. The short answer is: <Em>a job title is not a justification</Em>. PCI DSS Req 7.1 requires that access to cardholder data must be granted on a <Em>need-to-know</Em> basis. A Level 2 Investigator has the <em>capability</em> to see sensitive data, but that capability must only be exercised when there is an active, documented reason: specifically, a case that has been flagged as requiring deeper investigation.</P>
        <P><Em>How the escalation token satisfies PCI DSS:</Em></P>
        <Table
          headers={['Requirement', 'How the escalation token satisfies it']}
          rows={[
            ['Req 7.1: Restrict access by business need', 'The token proves the business need: a specific case, at a specific time, approved by the L2 investigator. Without the token, access is blocked regardless of role.'],
            ['Req 7.2: Access control based on need to know', 'Access requires role + valid token + case match. This is two-factor access control on sensitive data; role alone is not sufficient.'],
            ['Req 10.2: Audit trail for access to CHD', 'Every sensitive field access writes a field_accessed audit event with: timestamp, role, caseId, and the exact field names accessed, linked to the case that justified the access.'],
            ['Req 10.3: Protect audit logs from destruction', 'Audit events are written to fraudDiagnosisCaseEvents with no delete API exposed.'],
          ]}
        />
        <P><Em>Role decision matrix:</Em></P>
        <Table
          headers={['Role', 'Sensitive field access', 'Requires escalation token?']}
          rows={[
            ['customer', 'Own record only, no sensitive fields', 'N/A'],
            ['level1_analyst', 'No, access blocked entirely', 'N/A'],
            ['level2_investigator', 'Yes, with valid token', 'YES, per-case, 4-hour TTL'],
            ['security_auditor', 'Yes, direct access', 'No, oversight mandate'],
          ]}
        />
        <P>The Security Auditor does <Em>not</Em> require a token because their purpose is <Em>oversight</Em>, not operational investigation. They need read access to all data to verify the RBAC system is working correctly; requiring them to go through the escalation workflow of the system they are auditing would make the audit impossible.</P>
        <P><Em>Implementation:</Em> Token store at <Code>backend/src/vendors/security/escalationTokens.ts</Code>; access gate at <Code>backend/src/modules/customer/services/customerAgreement.service.ts</Code>.</P>
      </div>
    ),
    tags: ['RBAC', 'escalation token', 'Req 7', 'Req 10', 'need-to-know', 'audit', 'level2_investigator'],
  },
  {
    id: 23, category: 4,
    question: 'How does the save card / recurring payment feature align with BIAN Service Domains?',
    answer: (
      <div>
        <P>The save card feature does not require a new BIAN Service Domain. A customer&apos;s authorization to charge a card for future payments is a behavioral capability of the <Em>Customer Agreement</Em>, not a standalone entity.</P>
        <Table
          headers={['Action', 'BIAN Service Domain', 'Collection', 'Field additions']}
          rows={[
            ['Customer saves a card as preferred payment method', 'Payment Card', <Code>paymentCardQE</Code>, 'isPreferredPaymentMethod, mandateStatus, cardholderConsentTimestamp, mandateExpiryDate'],
            ['Customer grants consent for future charges', 'Customer Agreement', <Code>customerAgreementQE</Code>, 'preferredPaymentCardReference (link to the saved card)'],
            ['Recurring charge is executed', 'Card Transaction', <Code>cardTransactionQE</Code>, 'cardTransactionInitiationType (customerInitiated / merchantInitiated)'],
          ]}
        />
        <P>This means v4 save card is <Em>three field extensions across existing collections</Em> with no new collection needed. The mandate is expressed through the link between <Code>customerAgreementQE.preferredPaymentCardReference</Code> and <Code>paymentCardQE.mandateStatus</Code>.</P>
        <P>Under Visa and Mastercard rules, merchant-initiated transactions have a different authorization flow: they do not require CVV re-entry, they carry a specific network flag affecting interchange rates and chargeback rules, and they reference the stored consent instead. Storing <Code>cardTransactionInitiationType</Code> makes the transaction type explicit to any downstream compliance or dispute resolution system.</P>
      </div>
    ),
    tags: ['BIAN', 'payment card', 'customer agreement', 'card transaction', 'recurring payment', 'mandate', 'merchant-initiated'],
  },
  {
    id: 24, category: 4,
    question: 'How is the CVV handled realistically without ever storing it?',
    answer: (
      <div>
        <P>The CVV is Sensitive Authentication Data: PCI DSS Req 3.2 forbids storing it after authorization, in cleartext or ciphertext. The built-in issuer therefore <Em>derives</Em> it per card on demand instead of storing a value, exactly as a real issuer recomputes it in an HSM:</P>
        <Callout label="Derivation">cvv = digits( HMAC-SHA256( CVK, cardToken | expiryMMYY | serviceCode ) ) truncated to the network length (3 for Visa/Mastercard, 4 for Amex).</Callout>
        <P>The <Code>CVK</Code> is the issuer key: module-owned key material, provisioned once and stored only wrapped (envelope encryption: KMS/master key → DEK → CVK), with cleartext only in process memory. The CVV appears only in an ephemeral, audited reveal response, never in a collection, log, listing, or validation response.</P>
        <P>Two demo modes coexist via <Code>cvvMode</Code>: a <Em>global</Em> escape-hatch CVV for fast walkthroughs, and the realistic <Em>per-card</Em> derived CVV. The default <Code>both</Code> accepts either; <Code>global</Code> or <Code>per_card</Code> restrict to one. The global value is not hardcoded: it seeds as <Code>123</Code> and is edited in the card-issuer module admin by <Em>operations_officer</Em> or <Em>manager</Em> (<Code>modules:manage</Code>).</P>
      </div>
    ),
    tags: ['CVV', 'SAD', 'Req 3.2', 'HMAC', 'CVK', 'envelope encryption', 'derivation', 'cvvMode'],
  },
  {
    id: 25, category: 4,
    question: 'Why does the full PAN live in a separate issuer vault collection, and how does that contain PCI scope?',
    answer: (
      <div>
        <P>Storing the full PAN is a feature of the <Em>issuer</Em>, not of the PSP. Keeping it in the core <Code>paymentCardManagement</Code> would pull the PSP core into PCI scope for the PAN and it would not descope when the module is swapped. So the full PAN is a bounded context (the issuer CDE) and lives in a <Em>module-owned</Em> collection, <Code>cardIssuerVault</Code> (BIAN Card Administration), encrypted with Queryable Encryption (QE:equality on the PAN and the service code). The PSP core keeps only the token + BIN + last4.</P>
        <P>The payoff is <G>scope containment</G>: disable the module or route the capability to an external provider and the core is left with no PAN CHD at all. The core never reads the vault; the cross-boundary read is only through a port (the Card Reference port), which is what makes the module extractable to a microservice later.</P>
        <P>The encryption chain is the MongoDB talking point: KMS/master key → DEK → CVK for the issuer key, and DEK → QE ciphertext for the PAN and service code, so the server can match an exact PAN without ever decrypting it. The full PAN and the IBAN are hidden by default and revealed on demand behind an eye icon (ephemeral, audited), the same pattern for both.</P>
      </div>
    ),
    tags: ['PAN', 'CHD', 'cardIssuerVault', 'QE', 'scope containment', 'module-owned', 'port', 'reveal on demand', 'BIAN'],
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function QASection() {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState<number | null>(null);

  const toggle = (id: number) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const filtered = QA_DATA.filter(qa => {
    const q = search.toLowerCase();
    const matchSearch = !q || qa.question.toLowerCase().includes(q) || qa.tags.some(t => t.toLowerCase().includes(q));
    const matchCat = activeCat === null || qa.category === activeCat;
    return matchSearch && matchCat;
  });

  return (
    <div className="space-y-4">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <p className="text-[11px] font-semibold text-[#00ED64] uppercase tracking-widest mb-2">Frequently Asked Questions</p>
        <h2 className="text-base font-semibold text-white mb-3">PCI DSS &amp; Queryable Encryption Q&amp;A</h2>
        <p className="text-gray-400 text-sm leading-relaxed">
          {QA_DATA.length} questions covering PCI DSS compliance basics, Queryable Encryption design decisions,
          MongoDB Atlas certification architecture, and the BIAN alignment of this solution. These questions
          emerged from expert reviews by security architects, QSAs, and technically sophisticated FSI prospects.
        </p>
      </div>

      {/* ── Search + category filter ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        {/* Light input on dark page: clear contrast, dark text, obvious as an input field */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search questions or topics…"
            className="w-full bg-white border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#00684A] focus:ring-1 focus:ring-[#00684A]/20 transition-colors"
          />
        </div>
        {/* Filter pills: white text on dark bg when inactive, solid color + white text when active.
            Hover adds a light overlay (brightens) instead of darkening. */}
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setActiveCat(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
              activeCat === null
                ? 'bg-[#00684A] border-[#00684A] text-white shadow-sm'
                : 'bg-gray-800 border-gray-600 text-white hover:bg-gray-800 hover:border-[#00ED64]/60 hover:text-[#00ED64]'
            }`}
          >
            All ({QA_DATA.length})
          </button>
          {CATEGORIES.map(cat => {
            const count = QA_DATA.filter(q => q.category === cat.id).length;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCat(activeCat === cat.id ? null : cat.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                  activeCat === cat.id
                    ? `${cat.color.badge} shadow-sm`
                    : 'bg-gray-800 border-gray-600 text-white hover:bg-gray-800 hover:border-[#00ED64]/60 hover:text-[#00ED64]'
                }`}
              >
                {cat.emoji} {cat.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Q&A groups by category ───────────────────────────────────────────── */}
      {CATEGORIES.filter(cat => activeCat === null || cat.id === activeCat).map(cat => {
        const items = filtered.filter(qa => qa.category === cat.id);
        if (items.length === 0) return null;
        return (
          <div key={cat.id}>
            <div className="flex items-center gap-2 mb-2 px-1">
              <span
                className="text-xl leading-[0] shrink-0"
                style={cat.emojiOffset ? { transform: `translateY(${cat.emojiOffset})` } : undefined}
              >{cat.emoji}</span>
              <span className="text-[13px] font-bold text-gray-800 uppercase tracking-widest leading-none">{cat.label}</span>
              <span className="text-[11px] text-gray-500 leading-none">{items.length} question{items.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              {items.map((qa, idx) => {
                const isOpen = expanded.has(qa.id);
                return (
                  <div key={qa.id} className={`border-l-4 ${cat.color.border} ${idx > 0 ? 'border-t border-gray-800' : ''}`}>
                    <button
                      type="button"
                      onClick={() => toggle(qa.id)}
                      className="w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-gray-800/40 transition-colors"
                    >
                      <div className={`shrink-0 w-7 h-7 rounded-md ${cat.color.bg} flex items-center justify-center mt-0.5`}>
                        <span className={`text-[10px] font-black ${cat.color.text}`}>Q{qa.id}</span>
                      </div>
                      <p className="flex-1 text-gray-200 text-sm font-medium leading-snug">{qa.question}</p>
                      {isOpen
                        ? <ChevronUp size={14} className="text-gray-600 shrink-0 mt-0.5" />
                        : <ChevronDown size={14} className="text-gray-600 shrink-0 mt-0.5" />
                      }
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 border-t border-gray-800/60">
                        <div className="pt-3">{qa.answer}</div>
                        {qa.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-gray-800/60">
                            {qa.tags.map(tag => (
                              <span key={tag} className="text-[10px] text-gray-300 border border-gray-600 bg-gray-800/60 px-2 py-0.5 rounded-full">{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          <p className="text-gray-500 text-sm">No questions match your search.</p>
          <button onClick={() => { setSearch(''); setActiveCat(null); }} className="text-xs text-[#00ED64]/60 hover:text-[#00ED64] mt-2 transition-colors">
            Clear filters
          </button>
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div className="text-center pt-2 border-t border-gray-800">
        <p className="text-gray-700 text-xs">
          Questions sourced from expert review of this solution by security architects, QSAs, and FSI prospects.
        </p>
        <a
          href="https://www.mongodb.com/products/platform/trust/pci-dss"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500/60 hover:text-blue-400 text-xs mt-1 inline-block transition-colors"
        >
          MongoDB Trust Center: PCI DSS
        </a>
      </div>

    </div>
  );
}
