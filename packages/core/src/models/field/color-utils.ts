/** @module @teable/sdk: colorUtils */ /** */
import Color from 'color';
import { getEnumValueIfExists, has } from '../../utils/enum';
import { Colors, rgbTuplesByColor } from './colors';

/** A red/green/blue color object. Each property is a number from 0 to 255. */
interface IRGB {
  /** The red component. */
  r: number;
  /** The green component. */
  g: number;
  /** The blue component. */
  b: number;
}

/**
 * Utilities for working with {@link Colors} names from the {@link colors} enum.
 *
 * @docsPath UI/utils/colorUtils
 */
export interface IColorUtils {
  getHexForColor(colorString: Colors): string;
  /** */
  getHexForColor(colorString: string): null | string;

  /**
   * Given a {@link Colors}, return an {@link IRGB} object representing it, or null if the value isn't a {@link Colors}
   *
   * @param colorString
   * @example
   * ```js
   * import {colorUtils, colors} from '@teable/sdk';
   *
   * colorUtils.getRgbForColor(colors.PURPLE_DARK_1);
   * // => {r: 107, g: 28, b: 176}
   *
   * colorUtils.getRgbForColor('disgruntled pink');
   * // => null
   * ```
   */
  getRgbForColor(colorString: Colors): IRGB;
  /** */
  getRgbForColor(colorString: string): IRGB | null;

  /**
   * Given a {@link Colors} and alpha, return an string representing it, or null if the value isn't a {@link Colors}
   *
   * @param colorString
   * @param alpha
   * @example
   * ```js
   * import {colorUtils, colors} from '@teable/sdk';
   *
   * colorUtils.getRgbForColor(colors.PURPLE_DARK_1, 0.5);
   * // => rgba(107, 28, 176, 0.5)
   *
   * colorUtils.getRgbForColor('disgruntled pink');
   * // => null
   * ```
   */
  getRgbaStringForColor(colorString: string, alpha?: number): string | null;

  /**
   * Given a {@link Colors}, returns true or false to indicate whether that color should have light text on top of it when used as a background color.
   *
   * @param colorString
   * @example
   * ```js
   * import {colorUtils, colors} from '@teable/sdk';
   *
   * colorUtils.shouldUseLightTextOnColor(colors.PINK_LIGHT_1);
   * // => false
   *
   * colorUtils.shouldUseLightTextOnColor(colors.PINK_DARK_1);
   * // => true
   * ```
   */
  shouldUseLightTextOnColor(colorString: string): boolean;

  /**
   * Random color string.
   * @param exists Filter existed color
   * @param num Number of random color
   * @returns color string array
   */
  randomColor(exists?: string[], num?: number): Colors[];

  /**
   * Randomly (but consistently) pick a hex from a map based on a string
   * @param str input string
   */
  getRandomHexFromStr(str: string, theme?: 'light' | 'dark'): string;

  /**
   * Randomly (but consistently) pick a color from a map based on a string
   * @param str input string
   */
  getRandomColorFromStr(str: string): Colors;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const ColorUtils: IColorUtils = {
  getHexForColor: ((colorString: string): null | string => {
    const color = getEnumValueIfExists(Colors, colorString);
    if (!color) {
      return null;
    }
    const rgbTuple = rgbTuplesByColor[color];

    const hexNumber = (rgbTuple[0] << 16) | (rgbTuple[1] << 8) | rgbTuple[2];
    return `#${hexNumber.toString(16).padStart(6, '0')}`;
  }) as IColorUtils['getHexForColor'],

  getRgbForColor: ((colorString: string): IRGB | null => {
    const color = getEnumValueIfExists(Colors, colorString);
    if (!color) {
      return null;
    }
    const rgbTuple = rgbTuplesByColor[color];
    return { r: rgbTuple[0], g: rgbTuple[1], b: rgbTuple[2] };
  }) as IColorUtils['getRgbForColor'],

  getRgbaStringForColor: ((colorString: string, alpha = 1): string | null => {
    const { r, g, b } = ColorUtils.getRgbForColor(colorString) || {};
    if (r == null || g == null || b == null) return null;
    return `rgba(${+r},${+g},${+b},${alpha})`;
  }) as IColorUtils['getRgbaStringForColor'],

  shouldUseLightTextOnColor: (colorString: string): boolean => {
    if (!has(rgbTuplesByColor, colorString)) {
      return false;
    }

    const shouldUseDarkText = colorString.endsWith('Light1') || colorString.endsWith('Light2');
    return !shouldUseDarkText;
  },

  randomColor(exists?: string[], num = 1) {
    const allColors = Object.values(Colors);
    let availableColors = [...allColors];

    if (exists) {
      availableColors = availableColors.filter((color) => !exists.includes(color));
    }

    const result: Colors[] = [];
    for (let i = 0; i < num; i++) {
      const colorsToChooseFrom = availableColors.length > 0 ? availableColors : allColors;
      const randomIndex = Math.floor(Math.random() * colorsToChooseFrom.length);
      result.push(colorsToChooseFrom[randomIndex]);

      if (availableColors.length > 0) {
        availableColors.splice(randomIndex, 1);
      }
    }

    return result;
  },

  getRandomColorFromStr(str: string): Colors {
    const seed = getSeed(str);
    const values = Object.values(Colors);
    return values[seed % values.length];
  },

  getRandomHexFromStr(str: string) {
    const seed = getSeed(str);
    const values = Object.values(Colors);
    const value = values[seed % values.length];
    return ColorUtils.getHexForColor(value);
  },
};

export const contractColorForTheme = (color: string, theme: string | undefined) => {
  const colorRegular = Color(color).alpha(1);
  return theme === 'light' ? colorRegular.darken(0.5).hex() : colorRegular.lighten(0.5).hex();
};

// Function to generate a seed from a string
function getSeed(str: string) {
  let seed = 0;
  for (let i = 0; i < str.length; i++) {
    seed = (seed << 5) - seed + str.charCodeAt(i);
    seed |= 0; // Convert seed to a 32-bit integer
  }
  return Math.abs(seed);
}

export const generateColorPalette = () => {
  const colors = Object.values(Colors);
  const colorCount = colors.length;
  const groupCount = 5;
  const result: Colors[][] = Array.from({ length: groupCount }, () => []);

  for (let i = 0; i < colorCount; i++) {
    const groupIndex = i % groupCount;
    const indexInGroup = Math.floor(i / groupCount);
    result[groupIndex][indexInGroup] = colors[i];
  }
  return result;
};

export const COLOR_PALETTE = generateColorPalette();
