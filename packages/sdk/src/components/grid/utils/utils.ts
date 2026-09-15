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

export const getWheelDelta = ({
  event,
  pageHeight,
  lineHeight,
}: {
  event: WheelEvent;
  pageHeight?: number;
  lineHeight?: number;
}) => {
  let [x, y] = [event.deltaX, event.deltaY];
  if (x === 0 && event.shiftKey) {
    [y, x] = [0, y];
  }

  // This value is approximate, it does not have to be precise.
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    y *= lineHeight ?? 32;
  } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    y *= pageHeight ?? document.body.clientHeight - 180;
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

const parseCssColor = (color: string): [number, number, number, number] | undefined => {
  const hexMatch = color.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i);
  if (hexMatch) {
    const value =
      hexMatch[1].length === 3
        ? hexMatch[1]
            .split('')
            .map((part) => part + part)
            .join('')
        : hexMatch[1];
    const alpha = value.length === 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1;
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
      alpha,
    ];
  }

  const rgbMatch = color.match(/^rgba?\((.*)\)$/i);
  if (!rgbMatch) return;
  const channels = rgbMatch[1].split(',').map((channel) => Number(channel.trim()));
  if (
    (channels.length !== 3 && channels.length !== 4) ||
    channels.some((channel) => !Number.isFinite(channel))
  ) {
    return;
  }

  return [
    Math.max(0, Math.min(255, channels[0])),
    Math.max(0, Math.min(255, channels[1])),
    Math.max(0, Math.min(255, channels[2])),
    channels[3] === undefined ? 1 : Math.max(0, Math.min(1, channels[3])),
  ];
};

export const blendCssColors = (baseColor: string, overlayColor: string): string => {
  const base = parseCssColor(baseColor);
  const overlay = parseCssColor(overlayColor);
  if (!base || !overlay) return baseColor;

  const overlayAlpha = overlay[3];
  const channels = base
    .slice(0, 3)
    .map((channel, index) =>
      Math.round(channel * (1 - overlayAlpha) + overlay[index] * overlayAlpha)
    );

  if (base[3] < 1) {
    return `rgba(${channels.join(',')},${base[3]})`;
  }
  return `rgb(${channels.join(',')})`;
};
