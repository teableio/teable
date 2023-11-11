import { create } from 'zustand';
import type { IRectangle } from '../../../grid/interface';

export interface ITooltipInfo {
  id?: string;
  text: string;
  position: IRectangle;
  triggerClassName?: string;
  contentClassName?: string;
  triggerStyle?: React.CSSProperties;
  contentStyle?: React.CSSProperties;
}

interface IGridTooltipState {
  tooltipInfo?: ITooltipInfo;
  openTooltip: (props: ITooltipInfo) => void;
  closeTooltip: () => void;
}

export const useGridTooltipStore = create<IGridTooltipState>((set) => ({
  openTooltip: (props) => {
    set((state) => {
      return {
        ...state,
        tooltipInfo: props,
      };
    });
  },
  closeTooltip: () => {
    set((state) => {
      if (state.tooltipInfo == null) {
        return state;
      }
      return {
        ...state,
        tooltipInfo: undefined,
      };
    });
  },
}));
