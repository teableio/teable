// Plain lookup tables, kept out of DatetimeFormatting so a caller that only
// needs a pattern doesn't pull the field-setting UI and its dayjs plugins in.

// | Locale | Date Format | Notes |
// |--------|-------------|-------|
// | en-US  | M/D/YYYY    | U.S. English (United States), e.g., 12/31/2023 |
// | en-GB  | D/M/YYYY    | British English (United Kingdom, European), e.g., 31/12/2023 |
// | fr-FR  | DD/MM/YYYY  | French (France), e.g., 31/12/2023 |
// | de-DE  | DD.MM.YYYY  | German (Germany), e.g., 31.12.2023 |
// | ja-JP  | YYYY/MM/DD  | Japanese (Japan), e.g., 2023/12/31 |
// | zh-CN  | YYYY-MM-DD  | Simplified Chinese (China), e.g., 2023-12-31 |
// | ko-KR  | YYYY.MM.DD  | Korean (South Korea), e.g., 2023.12.31 |
export const localFormatStrings: { [key: string]: string } = {
  en: 'M/D/YYYY',
  'en-GB': 'D/M/YYYY',
  fr: 'DD/MM/YYYY',
  de: 'DD.MM.YYYY',
  ja: 'YYYY/MM/DD',
  zh: 'YYYY-MM-DD',
  ko: 'YYYY.MM.DD',
};

export const friendlyFormatStrings: { [key: string]: string } = {
  en: 'MMMM D, YYYY', // English
  'en-GB': 'D MMMM YYYY', // English GB
  zh: 'YYYY 年 M 月 D 日', // Chinese
  fr: 'D MMM YYYY', // French
  de: 'D. MMM YYYY', // German
  es: 'D de MMM de YYYY', // Spanish
  ru: 'D MMM YYYY г.', // Russian
  ja: 'YYYY 年 M 月 D 日', // Japanese
  ar: 'D MMMM, YYYY', // Arabic
  pt: 'D de MMMM de YYYY', // Portuguese
  hi: 'D MMMM, YYYY', // Hindi
  bn: 'D MMMM, YYYY', // Bengali
  jv: 'D MMMM YYYY', // Javanese
  pa: 'D MMMM YYYY', // Punjabi
  mr: 'D MMMM, YYYY', // Marathi
  ta: 'D MMMM, YYYY', // Tamil
};

export function getFormatStringForLanguage(language: string, preset: { [key: string]: string }) {
  // If the full language tag is not found, fallback to the base language
  const baseLanguage = language.split('-')[0];
  return preset[language] || preset[baseLanguage] || preset['en']; // Default to 'en'
}
