export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="bg-orange-900/30 border-b border-orange-500/20 px-6 py-3 flex items-center justify-between">
        <span className="font-bold text-orange-400 flex items-center gap-2">
          <span>⚙️</span> PCI DSS Demo · Administration
        </span>
        <span className="text-xs text-gray-500 border border-gray-700 rounded px-2 py-0.5">
          Restricted Access
        </span>
      </header>
      <main className="max-w-4xl mx-auto p-6">{children}</main>
    </div>
  );
}
