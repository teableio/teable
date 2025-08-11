import { z } from '../../../zod';
import { Colors } from '../colors';

export enum RatingIcon {
  Star = 'star',
  Moon = 'moon',
  Sun = 'sun',
  Zap = 'zap',
  Flame = 'flame',
  Heart = 'heart',
  Apple = 'apple',
  ThumbUp = 'thumb-up',
}

export const RATING_ICON_COLORS = [
  Colors.YellowBright,
  Colors.RedBright,
  Colors.TealBright,
] as const;

export const ratingColorsSchema = z.enum(RATING_ICON_COLORS);

export type IRatingColors = z.infer<typeof ratingColorsSchema>;

export const ratingFieldOptionsSchema = z.object({
  icon: z.nativeEnum(RatingIcon),
  color: ratingColorsSchema,
  max: z.number().int().max(10).min(1),
});

export type IRatingFieldOptions = z.infer<typeof ratingFieldOptionsSchema>;
