import { ColorUtils } from './color-utils';
import { Colors } from './colors';

describe('randomColor', () => {
  it('should return a single color when num is not provided', () => {
    const result = ColorUtils.randomColor();
    expect(result).toHaveLength(1);
    expect(Object.values(Colors)).toContain(result[0]);
  });

  it('should return unique colors when multiple are requested', () => {
    const result = ColorUtils.randomColor(undefined, 5);
    const uniqueColors = new Set(result);
    expect(result).toHaveLength(5);
    expect(uniqueColors.size).toBe(5);
  });

  it('should not return colors from the exists array', () => {
    const existingColors = [Colors.Red, Colors.Blue];
    const result = ColorUtils.randomColor(existingColors, 5);
    for (const color of existingColors) {
      expect(result).not.toContain(color);
    }
  });

  it('should return random colors from all available when "exists" excludes all', () => {
    const existingColors = Object.values(Colors);
    const result = ColorUtils.randomColor(existingColors, 5);
    for (const color of result) {
      expect(existingColors).toContain(color);
    }
  });
});
