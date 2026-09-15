import type { IGridStyleOptions } from '@teable/core';
import { create } from 'zustand';

interface IOptimisticGridStyle {
  style: IGridStyleOptions;
  baseStyle?: IGridStyleOptions;
}

interface IGridStyleState {
  styleByViewId: Record<string, IOptimisticGridStyle | undefined>;
  setStyle: (viewId: string, style: IGridStyleOptions, baseStyle?: IGridStyleOptions) => void;
  clearStyle: (viewId: string, expectedStyle?: IGridStyleOptions) => void;
}

export const useGridStyleStore = create<IGridStyleState>((set) => ({
  styleByViewId: {},
  setStyle: (viewId, style, baseStyle) =>
    set((state) => ({
      styleByViewId: {
        ...state.styleByViewId,
        [viewId]: { style, baseStyle },
      },
    })),
  clearStyle: (viewId, expectedStyle) =>
    set((state) => {
      const current = state.styleByViewId[viewId];
      if (!current || (expectedStyle && current.style !== expectedStyle)) return state;
      return {
        styleByViewId: {
          ...state.styleByViewId,
          [viewId]: undefined,
        },
      };
    }),
}));
