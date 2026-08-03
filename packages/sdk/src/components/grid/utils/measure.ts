export interface IAutoSize {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: string;
  lineHeight?: number;
}

export const MeasuredCanvas = (defaults: IAutoSize = {}) => {
  const {
    fontFamily = 'Inter, Roboto, -apple-system, BlinkMacSystemFont, avenir next, avenir, segoe ui, helvetica neue, helvetica, Ubuntu, noto, arial, sans-serif',
  } = defaults;
  if (typeof window === 'undefined' || document?.fonts?.ready == null) return;
  const canvas = document.createElement('canvas');
  const ctx = canvas ? canvas.getContext('2d') : null;

  const setFontSize = (fontSize: number) => {
    if (ctx) {
      ctx.font = `${fontSize}px ${fontFamily}`;
    }
  };

  const reset = () => setFontSize(13);
  setFontSize(13);

  return {
    ctx,
    reset,
    setFontSize,
  };
};

export const measuredCanvas = MeasuredCanvas();
