import type { ReactNode } from 'react';

export interface PaletteEntry {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  keywords?: string[];
  matchRanges?: [start: number, end: number][];
  href?: string;
  execute?: () => void | Promise<void>;
  lastVisited?: number;
  page?: 'appearance' | 'shortcuts';
  /** Switches the palette to this scope instead of running anything. */
  scope?: string;
  /**
   * The kind a row is grouped under beside an edition's group: a resource type, views under
   * `table`. Rows without one are commands.
   */
  category?: string;
  /** Shown at the row's end, e.g. when a chat last moved. */
  meta?: string;
  /** A line of found text under the label, its match drawn apart. */
  snippet?: { text: string; matchOffset: number; matchLength: number };
  /** A row under the one before it, e.g. one matching message of a chat. */
  variant?: 'sub';
  /** The footer's word for what Enter does, when "open" says too little. */
  actionLabel?: string;
  /** Merged into the select event, `kind` included. */
  analytics?: Record<string, string | number | boolean>;
}

/**
 * Results an edition adds beside the resources, e.g. the space's chats. With a query, the
 * palette shows each group capped in an "all" scope and offers each group its own scope.
 */
export interface PaletteResultGroup {
  /** Also the group's scope id. */
  id: string;
  /** The group's heading and its scope tab. */
  heading: string;
  /** One row per hit, for the mixed view. */
  entries: PaletteEntry[];
  /** The group's own scope, where a hit may bring sub rows. */
  scopeEntries: PaletteEntry[];
  isLoading: boolean;
  error: boolean;
  retry: () => void;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  /** Further pages wait for a click instead of the scroll. */
  olderOnRequest?: boolean;
}

/** Called on every render of the open palette, so it must be the same hook every time. */
export type UsePaletteExtraResults = (
  query: string,
  spaceId?: string
) => PaletteResultGroup | undefined;
