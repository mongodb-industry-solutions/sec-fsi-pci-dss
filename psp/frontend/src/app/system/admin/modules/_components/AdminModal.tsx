'use client';
import { X } from 'lucide-react';

// Shared modal primitives for the v29 built-in-module admin views (cards / accounts).
// Small, dependency-free wrappers so the two admin tables share one dialog style.

export function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

export function ModalActions({ onClose, onConfirm, confirmLabel, disabled }: { onClose: () => void; onConfirm: () => void; confirmLabel: string; disabled?: boolean }) {
  return (
    <div className="flex justify-end gap-2 mt-5">
      <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
      <button onClick={onConfirm} disabled={disabled} className="bg-[#001E2B] hover:bg-[#001E2B]/80 text-white font-medium px-4 py-2 rounded-lg text-sm disabled:opacity-60">{confirmLabel}</button>
    </div>
  );
}
