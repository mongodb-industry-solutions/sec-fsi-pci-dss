'use client';
import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CheckCircle2, Eye, Ban, Lock, AlertTriangle, ArrowLeft, ChevronRight } from 'lucide-react';
import { Breadcrumb } from '../../../../../components/Breadcrumb';
import { ROLE_GUIDE, ROLE_ORDER } from '../../../../../config/roleGuide';
import { ROLE_LABELS } from '../../../../../lib/constants';

// Role detail page. Mirrors the "Your Role" tab styling (dark cards) for a homogeneous help
// experience, with Breadcrumb + Back navigation to the roles tab (/system/help/roles).
export default function RoleDetailPage() {
  const { role } = useParams<{ role: string }>();
  const guide = ROLE_GUIDE[role];
  const roleLabel = ROLE_LABELS[role] ?? (role || 'Unknown role');

  return (
    <div className="w-full px-5 sm:px-8 lg:px-12 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Breadcrumb items={[
          { label: 'Home', href: '/system' },
          { label: 'Your Role', href: '/system/help/roles' },
          { label: roleLabel },
        ]} />
        <Link href="/system/help/roles" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#001E2B] transition-colors">
          <ArrowLeft size={14} /> Back to roles
        </Link>
      </div>

      {guide ? (
        <div className="bg-gray-900 border border-[#00ED64]/30 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-start gap-4 p-5 border-b border-gray-800 bg-[#00ED64]/[0.04]">
            <div className="w-11 h-11 rounded-lg bg-[#00ED64]/10 border border-[#00ED64]/20 flex items-center justify-center shrink-0 mt-0.5">
              {React.createElement(guide.icon, { size: 20, className: 'text-[#00ED64]' })}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-[#00ED64] uppercase tracking-widest mb-0.5">Role</p>
              <h2 className="text-lg font-bold text-white leading-tight">{roleLabel}</h2>
              <p className="text-gray-300 text-sm leading-relaxed mt-1.5">{guide.tagline}</p>
            </div>
          </div>

          {/* Responsibilities */}
          <div className="px-5 py-4">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3">Responsible for</p>
            <ul className="space-y-2.5">
              {guide.responsibilities.map((r) => (
                <li key={r} className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-[#00ED64] shrink-0 mt-0.5" />
                  <span className="text-gray-300 text-sm leading-snug">{r}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Data access + restrictions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-gray-800 border-t border-gray-800">
            <div className="bg-gray-900 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Eye size={14} className="text-sky-400 shrink-0" />
                <p className="text-sm font-semibold text-white">Data it can access</p>
              </div>
              <ul className="space-y-2">
                {guide.dataAccess.map((d) => (
                  <li key={d} className="flex items-start gap-2.5">
                    <span className="text-sky-400/70 shrink-0 text-sm leading-5">›</span>
                    <span className="text-gray-400 text-sm leading-snug">{d}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-gray-900 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Ban size={14} className="text-amber-400 shrink-0" />
                <p className="text-sm font-semibold text-white">Out of scope</p>
              </div>
              <ul className="space-y-2">
                {guide.restrictions.map((r) => (
                  <li key={r} className="flex items-start gap-2.5">
                    <span className="text-amber-500/70 shrink-0 text-sm leading-5">›</span>
                    <span className="text-gray-400 text-sm leading-snug">{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* PCI mapping */}
          <div className="px-5 py-4 border-t border-gray-800">
            <div className="flex items-center gap-2 flex-wrap">
              <Lock size={13} className="text-[#00ED64] shrink-0" />
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest">Scoped by PCI DSS</span>
              {guide.pci.map((p) => (
                <span key={p} className="text-[11px] text-[#00ED64]/80 border border-[#00ED64]/20 bg-[#00ED64]/[0.05] px-2.5 py-0.5 rounded-full">{p}</span>
              ))}
            </div>
            <p className="text-gray-600 text-xs mt-2">See the <Link href="/system/help/checklist" className="text-gray-400 hover:text-[#00ED64]">PCI DSS v4.0.1 Checklist</Link> for the full text of each requirement.</p>
          </div>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="text-gray-400 text-sm leading-relaxed">
            No specific guidance is available for <span className="text-gray-200 font-medium">{roleLabel}</span>.
            <Link href="/system/help/roles" className="text-[#00ED64] hover:underline ml-1">Back to roles</Link>.
          </p>
        </div>
      )}

      {/* Other roles */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-4">Other roles in this demo</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {ROLE_ORDER.filter((r) => r !== role).map((r) => {
            const g = ROLE_GUIDE[r];
            if (!g) return null;
            return (
              <Link key={r} href={`/system/help/roles/${r}`}
                className="group bg-gray-800/40 border border-gray-700/50 rounded-lg p-3.5 hover:border-[#00ED64]/40 hover:bg-gray-800/70 transition-colors">
                <div className="flex items-center gap-2 mb-1.5">
                  {React.createElement(g.icon, { size: 14, className: 'text-gray-400 shrink-0 group-hover:text-[#00ED64]' })}
                  <p className="text-xs font-semibold text-gray-200">{ROLE_LABELS[r] ?? r}</p>
                  <ChevronRight size={12} className="ml-auto text-gray-600 group-hover:text-[#00ED64]" />
                </div>
                <p className="text-gray-500 text-xs leading-snug">{g.tagline}</p>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
