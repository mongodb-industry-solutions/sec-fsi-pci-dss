'use client';

interface Props {
  label: string;
  type: 'qe-equality' | 'qe-none' | 'plaintext';
}

const CONFIG = {
  'qe-equality': {
    icon: '🔒',
    badge: 'QE: equality-searchable',
    color: 'text-green-700 bg-green-50 border-green-200',
  },
  'qe-none': {
    icon: '🔒',
    badge: 'QE: encrypted, not searchable',
    color: 'text-orange-700 bg-orange-50 border-orange-200',
  },
  plaintext: {
    icon: '✅',
    badge: 'Plaintext (not CHD)',
    color: 'text-gray-700 bg-gray-50 border-gray-200',
  },
};

export function EncryptionBadge({ label, type }: Props) {
  const { icon, badge, color } = CONFIG[type];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-medium ${color}`}
      title={badge}
    >
      {icon} {label}
    </span>
  );
}
