'use client';
import { createContext, useContext, useState, ReactNode } from 'react';

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
    <DebugModeContext.Provider value={{ debugMode, toggleDebug: () => setDebugMode(v => !v) }}>
      {children}
    </DebugModeContext.Provider>
  );
}

export function useDebugMode() {
  return useContext(DebugModeContext);
}
