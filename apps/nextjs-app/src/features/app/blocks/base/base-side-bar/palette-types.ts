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
}
