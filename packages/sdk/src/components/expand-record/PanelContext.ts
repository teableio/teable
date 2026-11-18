import { createContext } from 'react';

interface IExpandRecordPanelHostContext {
  // Inside a table node a record opens as a side panel docked into the node. A modal record
  // (and anything it opens) resets this, since a panel would land behind the dialog's overlay.
  inHost: boolean;
  container: HTMLElement | null;
  // Panels opened side by side in the node (a new record while a record is open, or the other
  // way round), oldest first: only the last is shown and takes Escape, the others wait under it.
  roots?: string[];
  registerRoot?: (id: string) => () => void;
  // moves an open panel back on top of the others, as opening it again does
  raiseRoot?: (id: string) => void;
}

export const ExpandRecordPanelHostContext = createContext<IExpandRecordPanelHostContext>({
  inHost: false,
  container: null,
});

// What a dialog or sheet provides to what it holds: records and new records opened inside it stay
// dialogs, since a side panel would land behind its overlay.
export const OUTSIDE_PANEL_HOST: IExpandRecordPanelHostContext = { inHost: false, container: null };

// One open record on the way to the one on top, as its breadcrumb shows it.
export interface IExpandRecordCrumb {
  title?: string;
  tableName?: string;
  // closes this record, and whatever is stacked over it
  close?: () => void;
  // opens the record's table, for a record of another table than the page's
  openTable?: () => void;
}

interface IExpandRecordPanelStackContext {
  // How many panels are open around this point: a linked record opened from a panel stacks a
  // panel on top of it, hides the one beneath, and goes back to it when closed.
  depth: number;
  // the records open around this point, outermost first
  trail: IExpandRecordCrumb[];
  closeRoot?: () => void;
  registerChild?: () => () => void;
  // the stack's root has another panel opened beside it on top: the whole stack waits under it
  covered?: boolean;
}

export const ExpandRecordPanelStackContext = createContext<IExpandRecordPanelStackContext>({
  depth: 0,
  trail: [],
});
