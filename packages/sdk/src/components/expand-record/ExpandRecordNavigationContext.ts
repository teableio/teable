import { createContext, useContext } from 'react';

interface IExpandRecordNavigationContext {
  onHighlightTable?: (tableId: string | null) => void;
  navigateToTable?: (tableId: string) => void;
}

export const ExpandRecordNavigationContext = createContext<IExpandRecordNavigationContext>({});

export const useExpandRecordNavigation = () => useContext(ExpandRecordNavigationContext);

export interface IExpandRecordAddToChatArgs {
  tableId: string;
  recordId: string;
  viewId?: string;
}

interface IExpandRecordAddToChatContext {
  addToChat?: (args: IExpandRecordAddToChatArgs) => void;
}

export const ExpandRecordAddToChatContext = createContext<IExpandRecordAddToChatContext>({});

export const useExpandRecordAddToChat = () => useContext(ExpandRecordAddToChatContext);
