'use client';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

// Reusable, system-wide confirmation + notification primitives that replace the native
// window.confirm()/alert(). useConfirm() returns a promise<boolean>; useNotify() shows a
// transient toast. Mounted once at the root layout via <UIProvider>.

type ConfirmTone = 'default' | 'danger';
interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}
type NotifyTone = 'success' | 'error' | 'info';
interface Toast { id: number; message: string; tone: NotifyTone }

interface UIContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  notify: (message: string, tone?: NotifyTone) => void;
}

const UIContext = createContext<UIContextValue | null>(null);

export function useConfirm() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useConfirm must be used within <UIProvider>');
  return ctx.confirm;
}
export function useNotify() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useNotify must be used within <UIProvider>');
  return ctx.notify;
}

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setDialog(opts);
    return new Promise<boolean>((resolve) => { resolverRef.current = resolve; });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setDialog(null);
  }, []);

  const notify = useCallback((message: string, tone: NotifyTone = 'info') => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev, { id, message, tone }]);
    // Auto-dismiss; demo UX, no external timer library.
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const danger = dialog?.tone === 'danger';

  return (
    <UIContext.Provider value={{ confirm, notify }}>
      {children}

      {/* Confirm dialog */}
      {dialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => settle(false)} />
          <div role="dialog" aria-modal="true" className="relative bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-sm overflow-hidden">
            <div className="px-5 py-4 flex items-start gap-3">
              <span className={`inline-flex w-9 h-9 rounded-lg items-center justify-center shrink-0 ${danger ? 'bg-red-100' : 'bg-[#001E2B]'}`}>
                <AlertTriangle size={18} className={danger ? 'text-red-600' : 'text-[#00ED64]'} />
              </span>
              <div className="min-w-0">
                <h2 className="font-semibold text-gray-900 text-sm">{dialog.title}</h2>
                {dialog.message && <p className="text-sm text-gray-500 mt-1">{dialog.message}</p>}
              </div>
            </div>
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => settle(false)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                {dialog.cancelLabel ?? 'Cancel'}
              </button>
              <button
                onClick={() => settle(true)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                  danger
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-[#001E2B] text-[#00ED64] hover:bg-[#00ED64] hover:text-[#001E2B]'
                }`}
              >
                {dialog.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[110] flex flex-col gap-2 w-full max-w-sm">
          {toasts.map((t) => {
            const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? AlertTriangle : Info;
            const color =
              t.tone === 'success' ? 'border-green-200 bg-green-50 text-green-800'
              : t.tone === 'error' ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-blue-200 bg-blue-50 text-blue-800';
            return (
              <div key={t.id} className={`flex items-start gap-2 rounded-lg border px-3 py-2 shadow-sm ${color}`}>
                <Icon size={15} className="mt-0.5 shrink-0" />
                <p className="text-sm flex-1">{t.message}</p>
                <button onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} className="shrink-0 opacity-60 hover:opacity-100">
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </UIContext.Provider>
  );
}
