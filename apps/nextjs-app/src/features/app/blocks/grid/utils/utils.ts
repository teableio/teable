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

export const isWindowsOS = () => {
  const agent = navigator.userAgent.toLowerCase();
  return /win32|wow32|win64|wow64/.test(agent);
};

export const hexToRGBA = (hex: string, alpha = 1) => {
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
  if (r == null || g == null || b == null) return hex;
  return `rgba(${+r},${+g},${+b},${alpha})`;
};
