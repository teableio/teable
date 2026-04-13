import { createContext, useContext } from 'react';

interface IExpandRecordNavigationContext {
  onHighlightTable?: (tableId: string | null) => void;
  navigateToTable?: (tableId: string) => void;
}

export const ExpandRecordNavigationContext = createContext<IExpandRecordNavigationContext>({});

export const useExpandRecordNavigation = () => useContext(ExpandRecordNavigationContext);
