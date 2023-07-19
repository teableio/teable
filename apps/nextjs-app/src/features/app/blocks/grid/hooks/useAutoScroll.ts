import { useState, useRef, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { IMouseState, IScrollDirection, ISelectionState } from '../interface';
import type { CoordinateManager } from '../managers';

const threshold = 30;
const maxPxPerMs = 2;
const msToFullSpeed = 1200;

interface IUseAutoScroll {
  coordInstance: CoordinateManager;
  selectionState: ISelectionState;
  setSelectionState: Dispatch<SetStateAction<ISelectionState>>;
  scrollBy: (deltaX: number, deltaY: number) => void;
}

export const useAutoScroll = (props: IUseAutoScroll) => {
  const { coordInstance, selectionState, setSelectionState, scrollBy } = props;
  const speedScalar = useRef(0);
  const { isSelecting } = selectionState;
  const { containerWidth, containerHeight, freezeRegionWidth, rowInitSize } = coordInstance;
  const [scrollDirection, setScrollDirection] = useState<
    [xDir: IScrollDirection, yDir: IScrollDirection]
  >([0, 0]);
  const [xDirection, yDirection] = scrollDirection || [0, 0];
  const { type: selectionType, ranges: selectionRanges } = selectionState;

  const onAutoScroll = (mouseState: IMouseState) => {
    if (!isSelecting) return;
    const { x, y } = mouseState;
    let xDir: IScrollDirection = 0;
    let yDir: IScrollDirection = 0;

    if (containerWidth - x < threshold) {
      xDir = 1;
    } else if (x - freezeRegionWidth < threshold) {
      xDir = -1;
    }

    if (containerHeight - y < threshold) {
      yDir = 1;
    } else if (y - rowInitSize < threshold) {
      yDir = -1;
    }
    setScrollDirection([xDir, yDir]);
  };

  const onAutoScrollStop = () => {
    setScrollDirection([0, 0]);
  };

  useEffect(() => {
    if (xDirection === 0 && yDirection === 0) {
      speedScalar.current = 0;
      return;
    }

    let lastTime = 0;

    // const updateSelectionRanges = () => {
    //   const pos = getPosition();
    //   if (selectionType === SelectionRegionType.Cells && pos != null) {
    //     const { columnIndex, rowIndex } = pos;
    //     const newRange = [columnIndex, rowIndex];
    //     if (!isEqual(selectionRanges[1], newRange)) {
    //       setSelectionState((prev) => ({
    //         ...prev,
    //         ranges: [selectionRanges[0], newRange] as IRange[],
    //       }));
    //     }
    //   }
    // };
    const processFrame = (curTime: number) => {
      if (lastTime !== 0) {
        const step = curTime - lastTime;
        speedScalar.current = Math.min(1, speedScalar.current + step / msToFullSpeed);
        const motion = Math.floor(speedScalar.current * step * maxPxPerMs);
        scrollBy(xDirection * motion, yDirection * motion);
        // updateSelectionRanges();
      }
      lastTime = curTime;
      requestFrameId = window.requestAnimationFrame(processFrame);
    };
    let requestFrameId = window.requestAnimationFrame(processFrame);
    return () => window.cancelAnimationFrame(requestFrameId);
  }, [
    scrollBy,
    setSelectionState,
    xDirection,
    yDirection,
    selectionType,
    selectionRanges,
    coordInstance,
  ]);

  return { onAutoScroll, onAutoScrollStop };
};
