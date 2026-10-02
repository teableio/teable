import { z } from 'zod';

export enum SingleLineTextDisplayType {
  // Deprecated: URLs are detected in text automatically. Kept so that stored
  // field options written before this still validate; the UI no longer offers it.
  Url = 'url',
  Email = 'email',
  Phone = 'phone',
}

export const singleLineTextShowAsSchema = z
  .object({
    type: z.enum(SingleLineTextDisplayType).meta({
      description:
        'can display as email or phone in string field with a button to perform the corresponding action, send an email or start a phone call. "url" is deprecated: URLs inside text values are detected and rendered as links automatically',
    }),
  })
  .describe(
    'Only be used in single line text field or formula / rollup field with cellValueType equals String and isMultipleCellValue is not true'
  );

export type ISingleLineTextShowAs = z.infer<typeof singleLineTextShowAsSchema>;

// Display types that still turn the whole value into an action (mailto / tel)
export type ISingleLineTextActionType = Exclude<
  SingleLineTextDisplayType,
  SingleLineTextDisplayType.Url
>;

// Resolves a stored showAs to its action type; the deprecated "url" show-as
// yields undefined so callers render plain text with auto-detected links.
export const getTextActionType = (
  showAs?: ISingleLineTextShowAs
): ISingleLineTextActionType | undefined =>
  showAs && showAs.type !== SingleLineTextDisplayType.Url ? showAs.type : undefined;
