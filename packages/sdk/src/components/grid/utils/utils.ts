import type { CoordinateManager } from '../managers';

export type ITimeoutID = {
  id: number;
};

export const cancelTimeout = (timeoutID: ITimeoutID) => {
  cancelAnimationFrame(timeoutID.id);
};

export const requestTimeout = (callback: () => void, delay: number): ITimeoutID => {
  const start = Date.now();

  function tick() {
    if (Date.now() - start >= delay) {
      callback.call(null);
    } else {
      timeoutID.id = requestAnimationFrame(tick);
    }
  }

  const timeoutID: ITimeoutID = {
    id: requestAnimationFrame(tick),
  };
  return timeoutID;
};

export const getWheelDelta = (event: WheelEvent, coordInstance?: CoordinateManager) => {
  // This value is approximate, it does not have to be precise.
  const page_height = coordInstance
    ? coordInstance.containerHeight - coordInstance.rowInitSize - 1
    : document.body.clientHeight - 180;

  let [x, y] = [event.deltaX, event.deltaY];
  if (x === 0 && event.shiftKey) {
    [y, x] = [0, y];
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    y *= coordInstance ? coordInstance.rowHeight : 32;
  } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    y *= page_height;
  }
  return [x, y];
};

export const hexToRGBA = (hex: string, alpha = 1) => {
  const [r, g, b] = parseToRGB(hex);
  if (r == null || g == null || b == null) return hex;
  return `rgba(${+r},${+g},${+b},${alpha})`;
};

export const parseToRGB = (hex: string) => {
  let r, g, b;

  if (hex.length === 4) {
    r = '0x' + hex[1] + hex[1];
    g = '0x' + hex[2] + hex[2];
    b = '0x' + hex[3] + hex[3];
  } else if (hex.length === 7) {
    r = '0x' + hex[1] + hex[2];
    g = '0x' + hex[3] + hex[4];
    b = '0x' + hex[5] + hex[6];
  }
  if (r == null || g == null || b == null) return [];
  return [+r, +g, +b];
};
