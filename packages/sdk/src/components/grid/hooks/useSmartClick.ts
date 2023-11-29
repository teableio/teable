import type React from 'react';
import { useRef, useState } from 'react';
import type { IMouseState, IPosition } from '../interface';

export const useSmartClick = (
  stageRef: React.RefObject<HTMLDivElement | undefined>,
  clickCallback: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void,
  dblClickCallback: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void
) => {
  const [clickCount, setClickCount] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [startPos, setStartPos] = useState<IPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const isClickOrigin = useRef(false);
  const lastMouseDownTime = useRef(0);

  const onSmartMouseDown = (mouseState: IMouseState) => {
    const curTimestamp = Date.now();
    if (curTimestamp - lastMouseDownTime.current > 300) {
      const { x, y } = mouseState;
      setStartPos({ x, y });
      isClickOrigin.current = true;
    }
    lastMouseDownTime.current = Date.now();
  };

  const onSmartMouseUp = (mouseState: IMouseState) => {
    const { x, y } = mouseState;
    if (
      isClickOrigin.current &&
      startPos &&
      (Math.abs(startPos.x - x) > 5 || Math.abs(startPos.y - y) > 5)
    ) {
      setDragging(true);
    }
    isClickOrigin.current = false;
  };

  const onSmartClick = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    if (dragging) {
      setDragging(false);
      return;
    }

    const rect = stageRef.current?.getBoundingClientRect();
    if (rect == null) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const now = Date.now();
    if (
      clickCount === 1 &&
      now - startTime < 300 &&
      startPos &&
      x === startPos.x &&
      y === startPos.y
    ) {
      clickCallback(event);
      dblClickCallback(event);
      setClickCount(0);
      setStartTime(0);
    } else {
      clickCallback(event);
      setClickCount(1);
      setStartTime(now);
    }
  };

  return { onSmartMouseDown, onSmartMouseUp, onSmartClick };
};
