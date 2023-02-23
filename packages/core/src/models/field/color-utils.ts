/** @module @teable-group/sdk: colorUtils */ /** */
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
  /**
   * Given a {@link Colors}, return the hex color value for that color, or null if the value isn't a {@link Colors}
   *
   * @param colorString
   * @example
   * ```js
   * import {colorUtils, colors} from '@teable-group/sdk';
   *
   * colorUtils.getHexForColor(colors.RED);
   * // => '#ef3061'
   *
   * colorUtils.getHexForColor('uncomfortable beige');
   * // => null
   * ```
   */
  getHexForColor(colorString: Colors): string;
  /** */
  getHexForColor(colorString: string): null | string;

  /**
   * Given a {@link Colors}, return an {@link IRGB} object representing it, or null if the value isn't a {@link Colors}
   *
   * @param colorString
   * @example
   * ```js
   * import {colorUtils, colors} from '@teable-group/sdk';
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
   * Given a {@link Colors}, returns true or false to indicate whether that color should have light text on top of it when used as a background color.
   *
   * @param colorString
   * @example
   * ```js
   * import {colorUtils, colors} from '@teable-group/sdk';
   *
   * colorUtils.shouldUseLightTextOnColor(colors.PINK_LIGHT_1);
   * // => false
   *
   * colorUtils.shouldUseLightTextOnColor(colors.PINK_DARK_1);
   * // => true
   * ```
   */
  shouldUseLightTextOnColor(colorString: string): boolean;
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

  shouldUseLightTextOnColor: (colorString: string): boolean => {
    if (!has(rgbTuplesByColor, colorString)) {
      return false;
    }

    const shouldUseDarkText = colorString.endsWith('Light1') || colorString.endsWith('Light2');
    return !shouldUseDarkText;
  },
};
