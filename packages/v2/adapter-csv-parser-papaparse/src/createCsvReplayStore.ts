import { createBrowserCsvReplayStore } from './BrowserCsvReplayStore';
import type { CsvReplayStore } from './CsvReplayStore';
import { createNodeCsvReplayStore } from './NodeCsvReplayStore';

/** Runtime choice is local to the adapter; browser bundles never import Node builtins. */
export const createCsvReplayStore = (): Promise<CsvReplayStore> =>
  typeof process !== 'undefined' && typeof process.getBuiltinModule === 'function'
    ? createNodeCsvReplayStore()
    : createBrowserCsvReplayStore();
