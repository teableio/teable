// Check if value represents a percentage (0-1) or pixels (>1)
export const isPercentage = (value: number): boolean => {
  return value >= 0 && value <= 1;
};

// Convert pixel value to percentage (0-1 range)
export const pixelToPercent = (pixel: number, viewportSize: number): number => {
  if (viewportSize === 0) return 0;
  return Math.max(0, Math.min(1, pixel / viewportSize));
};

// Convert percentage (0-1) to pixel value
export const percentToPixel = (percent: number, viewportSize: number): number => {
  return Math.round(percent * viewportSize);
};

// Convert any value (percentage or pixel) to pixel based on viewport
export const toPixel = (value: number, viewportSize: number): number => {
  return isPercentage(value) ? percentToPixel(value, viewportSize) : value;
};
