import { createContext } from 'react';

interface IExpandRecordPanelHostContext {
  // Inside a table node a record opens as a side panel docked into the node. A modal record
  // (and anything it opens) resets this, since a panel would land behind the dialog's overlay.
  inHost: boolean;
  container: HTMLElement | null;
}

export const ExpandRecordPanelHostContext = createContext<IExpandRecordPanelHostContext>({
  inHost: false,
  container: null,
});

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
}

export const ExpandRecordPanelStackContext = createContext<IExpandRecordPanelStackContext>({
  depth: 0,
  trail: [],
});
