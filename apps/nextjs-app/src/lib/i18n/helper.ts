import { acceptLanguage } from './acceptHeader';

export const getLocaleFromCookie = (cookie: string): string | null => {
  if (!cookie) return null;
  const match = cookie.match(/NEXT_LOCALE=([^;]+)/);
  return match?.[1] || null;
};

export const getLocaleFromBrowser = (): string => {
  if (typeof navigator === 'undefined') return 'en';
  const browserLang = navigator.language || (navigator as { userLanguage?: string }).userLanguage;
  if (!browserLang) return 'en';
  // Extract primary language code (e.g., 'zh-CN' -> 'zh', 'en-US' -> 'en')
  return browserLang.split('-')[0];
};

export const getLocaleFromAcceptLanguage = (
  acceptLanguageHeader: string | undefined,
  supportedLocales: string[]
): string | null => {
  if (!acceptLanguageHeader) return null;
  try {
    const locale = acceptLanguage(acceptLanguageHeader, supportedLocales);
    return locale || null;
  } catch {
    return null;
  }
};
