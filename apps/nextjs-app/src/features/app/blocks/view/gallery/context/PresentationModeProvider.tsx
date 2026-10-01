import { useMemo, useState, type ReactNode } from 'react';
import { PresentationModeContext } from './PresentationModeContext';

export const PresentationModeProvider = ({ children }: { children: ReactNode }) => {
  const [isPresenting, setPresenting] = useState(false);
  const value = useMemo(() => ({ isPresenting, setPresenting }), [isPresenting]);

  return (
    <PresentationModeContext.Provider value={value}>{children}</PresentationModeContext.Provider>
  );
};
