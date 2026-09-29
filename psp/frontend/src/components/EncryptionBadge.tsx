'use client';
import { Lock, CheckCircle2, type LucideIcon } from 'lucide-react';

interface Props {
  label: string;
  type: 'qe-equality' | 'qe-none' | 'plaintext';
}

const CONFIG: Record<Props['type'], { Icon: LucideIcon; badge: string; color: string }> = {
  'qe-equality': {
    Icon: Lock,
    badge: 'QE: equality-searchable',
    color: 'text-green-700 bg-green-50 border-green-200',
  },
  'qe-none': {
    Icon: Lock,
    badge: 'QE: encrypted, not searchable',
    color: 'text-orange-700 bg-orange-50 border-orange-200',
  },
  plaintext: {
    Icon: CheckCircle2,
    badge: 'Plaintext (not CHD)',
    color: 'text-gray-700 bg-gray-50 border-gray-200',
  },
};

export function EncryptionBadge({ label, type }: Props) {
  const { Icon, badge, color } = CONFIG[type];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-medium ${color}`}
      title={badge}
    >
      <Icon size={12} className="shrink-0" /> {label}
    </span>
  );
}
