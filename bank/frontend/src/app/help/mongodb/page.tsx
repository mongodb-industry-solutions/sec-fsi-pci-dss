import { Database, Lock, type LucideIcon } from 'lucide-react';
import { PageTitle, SectionHeading } from '../../../components/Tiles';
import { Panel } from '../../../components/Reveal';

export const metadata = { title: 'Why MongoDB' };

// The argument, made against this system rather than in general. Every point below names something this bank
// actually does, because a modelling claim that cannot be pointed at a screen is a slide, not a reason.

interface Point {
  title: string;
  icon: LucideIcon;
  body: string;
  /** Where in this bank you can see it. */
  here: string;
}

const MODELLING: Point[] = [
  {
    title: 'A banking record is not a rectangle',
    icon: Database,
    body:
      'An account, a card and a party are each one record with nested structure: a lifecycle with its own dates, a set of limits, a party with several identifiers and contact methods. A document holds that as one thing, so reading an account is one read rather than a join across six tables assembled back into the shape the domain already had.',
    here: 'The account and card detail screens are each a single document, visible in debug mode.',
  },
  {
    title: 'One shape, many kinds of the same thing',
    icon: Database,
    body:
      'A movement can be a card authorisation, a transfer out through a scheme, a fee or a correction. They share identity, amount, timing and status, and differ in the rest. One collection holds all of them without a nullable column per variant, and a new payment product does not require a schema migration across the estate.',
    here: 'The ledger movements behind any balance.',
  },
  {
    title: 'Rules are data, not deployments',
    icon: Database,
    body:
      'What this issuer validates, how long a consent lives, which scoring bands apply: each is a configuration document read at request time. Changing a policy is a write, not a release, which is what lets an operator see the effect of a rule change on the next authorisation.',
    here: 'Every screen under Rules and policies.',
  },
  {
    title: 'The trail is append-only and time-shaped',
    icon: Database,
    body:
      'Audit is written once per request, never updated, always queried by time and by actor. A time series collection stores that far more compactly than a general-purpose table and answers "what happened in this window" without scanning the rest of the history, while retention is expressed as a property of the data rather than as a cleanup job.',
    here: 'The audit trail, searchable and exportable.',
  },
  {
    title: 'One query language for the record and the investigation',
    icon: Database,
    body:
      'Finding the account is a read; explaining a pattern across a customer, their cards and their movements is an aggregation. Both run in the same engine against the same documents, so an investigation does not require exporting to a second system where the data ages and the access controls do not follow it.',
    here: 'The card estate and audit filters.',
  },
  {
    title: 'Validation without giving up flexibility',
    icon: Database,
    body:
      'Collections carry a schema the server enforces, so a required field stays required and a status stays within its allowed set. The flexibility is in evolving that contract deliberately, not in having none.',
    here: 'Applied at setup, so a reset rebuilds the same guarantees.',
  },
];

const SECURITY: Point[] = [
  {
    title: 'Queryable Encryption: encrypted, and still searchable',
    icon: Lock,
    body:
      'Card numbers, account numbers, names and contact details are encrypted by the driver before they ever leave this bank’s process, and the server stores only ciphertext. The database can still answer a query on them, including equality and prefix, suffix or substring matching on the fields that need it, without ever holding the key or seeing a plaintext value. That is the property that makes the demo possible: the usual trade of "encrypt it and lose the ability to look it up" does not apply.',
    here: 'Searching a party by name, or a card by its token.',
  },
  {
    title: 'The database administrator is not in the trust boundary',
    icon: Lock,
    body:
      'Because encryption and decryption happen in the application with keys the server never receives, someone with full access to the storage, the backups or the running server sees masked values and nothing more. The threat this addresses is the realistic one: not a stolen disk, but a legitimate operator with too much reach.',
    here: 'The record panels in debug mode: masked in the stored document.',
  },
  {
    title: 'Keys that are managed, separated and rotatable',
    icon: Lock,
    body:
      'Each protected field is encrypted with its own data key, and those keys live in a separate key vault, themselves encrypted under a master key held by an external key manager. So the data, the data keys and the master key are three separate things to compromise, and a key can be rotated without rewriting the application.',
    here: 'Provisioned at setup, alongside the encrypted collections.',
  },
  {
    title: 'A reveal is a request, so it is a record',
    icon: Lock,
    body:
      'Nothing sensitive is decrypted to build a page. A full number is fetched only when a person asks for that one value, which is why it is a write-shaped request rather than a page load: one audit row corresponds to one disclosure of one record, instead of to "somebody opened a list".',
    here: 'Any eye icon on a detail screen.',
  },
  {
    title: 'Least privilege in the database too',
    icon: Lock,
    body:
      'Role-based access control at the database level means the application connects with a principal scoped to the collections it owns, so a compromise of one service is not a compromise of every collection. Access to the key vault is narrower still than access to the data.',
    here: 'Each institution in this demo has its own database and its own credentials.',
  },
  {
    title: 'Encrypted in transit, encrypted at rest, and logged',
    icon: Lock,
    body:
      'Client connections are TLS-only, storage is encrypted at rest independently of the field-level encryption above it, and the database keeps its own auditing of privileged operations. Network reach is closed by default and opened to named private endpoints rather than to addresses, so a leaked connection string is not by itself a way in.',
    here: 'Configuration, not application code.',
  },
];

export default function BankHelpMongoDB() {
  return (
    <div className="space-y-8">
      <PageTitle
        title="Why MongoDB"
        description="Two separate arguments. The first is that the document model matches how a bank’s records are actually shaped. The second, and the one that decides it for a regulated system, is that the data can stay encrypted and remain usable."
      />

      <section className="space-y-3">
        <SectionHeading>Modelling this kind of system</SectionHeading>
        <div className="grid gap-4 lg:grid-cols-2">
          {MODELLING.map((point) => (
            <PointCard key={point.title} point={point} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeading>Security, and what the database contributes to it</SectionHeading>
        <Panel
          title="The problem this solves"
          description="Protecting a card number is easy until somebody has to find it again."
        >
          <p className="text-pretty text-sm leading-relaxed text-ink-soft">
            The card security rules require that a stored card number be unreadable, and the privacy rules require the
            same of a customer’s name, contact details and account number. The conventional way to satisfy that is to
            encrypt the field and accept that it can no longer be queried, then rebuild searchability with tokens,
            hashes or a plaintext index that quietly becomes the thing worth stealing. This bank does none of that: the
            fields stay encrypted, the keys stay with the application, and the queries still work.
          </p>
        </Panel>
        <div className="grid gap-4 lg:grid-cols-2">
          {SECURITY.map((point) => (
            <PointCard key={point.title} point={point} />
          ))}
        </div>
      </section>
    </div>
  );
}

function PointCard({ point }: { point: Point }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start gap-2.5">
        <point.icon size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 space-y-1.5">
          <h3 className="text-pretty text-sm font-semibold">{point.title}</h3>
          <p className="text-pretty text-xs leading-relaxed text-ink-soft">{point.body}</p>
          <p className="text-pretty text-[11px] leading-relaxed text-ink-soft">
            <span className="font-medium text-ink">See it here:</span> {point.here}
          </p>
        </div>
      </div>
    </section>
  );
}
