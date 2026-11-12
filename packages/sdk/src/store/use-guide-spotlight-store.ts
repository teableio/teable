import { create } from 'zustand';

export interface IGuideSpotlightTarget {
  tableId: string;
  fieldId: string;
}

export interface IGuideSpotlightRequest extends IGuideSpotlightTarget {
  requestedAt: number;
}

interface IGuideSpotlightState {
  request: IGuideSpotlightRequest | null;
  spotlight: (target: IGuideSpotlightTarget) => void;
  clear: () => void;
}

/**
 * Asks the grid of `tableId` to point the user at the first row's cell of `fieldId`.
 * The request is kept until a grid showing that table consumes it, so it can be made
 * before navigating there; every call is a new request, even for the same target.
 */
export const useGuideSpotlightStore = create<IGuideSpotlightState>((set) => ({
  request: null,
  spotlight: ({ tableId, fieldId }) =>
    set({ request: { tableId, fieldId, requestedAt: Date.now() } }),
  clear: () => set({ request: null }),
}));
