import { useState, useRef, useEffect } from 'react';
import type { IMouseState, IScrollDirection } from '../interface';
import type { CoordinateManager } from '../managers';

const threshold = 30;
const maxPxPerMs = 2;
const msToFullSpeed = 1200;

interface IUseAutoScroll {
  isSelecting: boolean;
  coordInstance: CoordinateManager;
  scrollBy: (deltaX: number, deltaY: number) => void;
}

export const useAutoScroll = (props: IUseAutoScroll) => {
  const { coordInstance, isSelecting, scrollBy } = props;
  const speedScalar = useRef(0);
  const { containerWidth, containerHeight, freezeRegionWidth, rowInitSize } = coordInstance;
  const [scrollDirection, setScrollDirection] = useState<
    [xDir: IScrollDirection, yDir: IScrollDirection]
  >([0, 0]);
  const [xDirection, yDirection] = scrollDirection || [0, 0];

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

    const processFrame = (curTime: number) => {
      if (lastTime !== 0) {
        const step = curTime - lastTime;
        speedScalar.current = Math.min(1, speedScalar.current + step / msToFullSpeed);
        const motion = Math.floor(speedScalar.current * step * maxPxPerMs);
        scrollBy(xDirection * motion, yDirection * motion);
      }
      lastTime = curTime;
      requestFrameId = window.requestAnimationFrame(processFrame);
    };
    let requestFrameId = window.requestAnimationFrame(processFrame);
    return () => window.cancelAnimationFrame(requestFrameId);
  }, [scrollBy, xDirection, yDirection]);

  return { onAutoScroll, onAutoScrollStop };
};
