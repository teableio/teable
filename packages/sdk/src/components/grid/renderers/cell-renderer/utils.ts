import { GRID_DEFAULT } from '../../configs';
import type { IActiveCellBound } from '../../interface';

const { cellScrollBarPaddingY, cellScrollBarMinHeight } = GRID_DEFAULT;

export const getCellScrollState = (activeCellBound: IActiveCellBound) => {
  const { height, totalHeight, scrollTop } = activeCellBound;
  const sliderHeight = height - cellScrollBarPaddingY * 2;
  const ratio = sliderHeight / totalHeight;
  const originScrollBarHeight = sliderHeight * ratio;
  const scrollBarHeight = Math.max(originScrollBarHeight, cellScrollBarMinHeight);
  const scrollTopPercent = scrollTop / (totalHeight - height);
  const scrollBarSupplementHeight = scrollBarHeight - originScrollBarHeight;
  const scrollBarSupplementScrollTop =
    scrollBarSupplementHeight > 0 ? scrollBarSupplementHeight * scrollTopPercent : 0;
  const scrollBarScrollTop = scrollTop * ratio - scrollBarSupplementScrollTop;
  const contentScrollTop = Math.min(scrollTop, totalHeight - height);

  return {
    scrollBarHeight,
    scrollBarScrollTop,
    contentScrollTop,
  };
};
