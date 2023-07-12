import type Konva from 'konva';
import type React from 'react';
import { useState } from 'react';
import type { IPosition } from '../interface';

export const useSmartClick = (
  stageRef: React.RefObject<Konva.Stage | undefined>,
  clickCallback: () => void,
  dblClickCallback: () => void
) => {
  const [clickCount, setClickCount] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [startPos, setStartPos] = useState<IPosition | null>(null);
  const [dragging, setDragging] = useState(false);

  const onSmartMouseDown = () => {
    const pos = stageRef.current?.getPointerPosition();
    if (!pos) return;
    setStartPos(pos);
  };

  const onSmartMouseUp = () => {
    const pos = stageRef.current?.getPointerPosition();
    if (!pos) return;
    if (startPos && (Math.abs(startPos.x - pos.x) > 5 || Math.abs(startPos.y - pos.y) > 5)) {
      setDragging(true);
    }
  };

  const onSmartClick = () => {
    if (dragging) {
      setDragging(false);
      return;
    }

    const now = Date.now();
    const pos = stageRef.current?.getPointerPosition();
    if (!pos) return;
    if (
      clickCount === 1 &&
      now - startTime < 300 &&
      startPos &&
      pos.x === startPos.x &&
      pos.y === startPos.y
    ) {
      clickCallback();
      dblClickCallback();
      setClickCount(0);
      setStartTime(0);
    } else {
      clickCallback();
      setClickCount(1);
      setStartTime(now);
    }
  };

  return { onSmartMouseDown, onSmartMouseUp, onSmartClick };
};
