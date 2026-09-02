'use client';
import { createContext, useContext, useState, ReactNode } from 'react';

// Debug mode: the raw record panels, off by default and toggled from the user menu.
// Same contract as the provider's, so the two products behave the same way.

interface DebugModeContextValue {
  debugMode: boolean;
  toggleDebug: () => void;
}

const DebugModeContext = createContext<DebugModeContextValue>({
  debugMode: false,
  toggleDebug: () => {},
});

export function DebugModeProvider({ children }: { children: ReactNode }) {
  const [debugMode, setDebugMode] = useState(false);
  return (
    <DebugModeContext.Provider value={{ debugMode, toggleDebug: () => setDebugMode((on) => !on) }}>
      {children}
    </DebugModeContext.Provider>
  );
}

export function useDebugMode() {
  return useContext(DebugModeContext);
}