import { create } from 'zustand';

interface IViewColumnOrderState {
  // viewId -> fieldId -> optimistic order, held only while the server
  // round trip (HTTP + view-doc op) is in flight
  pendingOrderMap: Record<string, Record<string, number>>;
  setPendingOrder: (viewId: string, orders: Record<string, number>) => void;
  prunePendingOrder: (viewId: string, fieldIds: string[]) => void;
  clearPendingOrder: (viewId: string) => void;
}

export const useViewColumnOrderStore = create<IViewColumnOrderState>()((set) => ({
  pendingOrderMap: {},
  setPendingOrder: (viewId, orders) =>
    set((state) => ({
      pendingOrderMap: {
        ...state.pendingOrderMap,
        [viewId]: {
          ...state.pendingOrderMap[viewId],
          ...orders,
        },
      },
    })),
  prunePendingOrder: (viewId, fieldIds) =>
    set((state) => {
      const pending = state.pendingOrderMap[viewId];
      if (!pending) return state;
      const rest = { ...pending };
      fieldIds.forEach((fieldId) => delete rest[fieldId]);
      const { [viewId]: _, ...otherViews } = state.pendingOrderMap;
      return {
        pendingOrderMap: Object.keys(rest).length ? { ...otherViews, [viewId]: rest } : otherViews,
      };
    }),
  clearPendingOrder: (viewId) =>
    set((state) => {
      const { [viewId]: _, ...rest } = state.pendingOrderMap;
      return { pendingOrderMap: rest };
    }),
}));
