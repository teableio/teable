import { slugify } from 'transliteration';

export function convertNameToValidCharacter(name: string, maxLength = 10): string {
  let cleanedName = slugify(name, { allowedChars: 'a-zA-Z0-9_', separator: '_', lowercase: false });

  if (cleanedName === '' || /^_+$/.test(cleanedName)) {
    return 'unnamed';
  }

  if (!/^[a-z]/i.test(cleanedName)) {
    cleanedName = 't' + cleanedName;
  }

  cleanedName = cleanedName.substring(0, maxLength);

  return cleanedName;
}
