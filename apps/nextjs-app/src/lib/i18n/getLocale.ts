import type { NextRequest } from 'next/server';
import { acceptLanguage } from './acceptHeader';

export interface I18NConfig {
  defaultLocale: string;
  localeDetection?: false;
  locales: string[];
}

interface IOptions {
  req: NextRequest;
  i18n: I18NConfig;
}

function getAcceptPreferredLocale(
  i18n: I18NConfig,
  headers?: { [key: string]: string | string[] | undefined }
) {
  const acceptLangStr = headers?.['accept-language'];
  if (acceptLangStr && !Array.isArray(acceptLangStr)) {
    try {
      return acceptLanguage(acceptLangStr, i18n.locales);
    } catch (err) {
      return;
    }
  }
}

function getLocaleFromCookie(req: NextRequest, locales: string[]) {
  const nextLocale = req.cookies.get('NEXT_LOCALE')?.value;
  return nextLocale
    ? locales.find((locale: string) => nextLocale.toLowerCase() === locale.toLowerCase())
    : undefined;
}

function detectLocale({
  i18n,
  req,
  preferredLocale,
}: {
  i18n: I18NConfig;
  req: NextRequest;
  preferredLocale?: string;
}) {
  return getLocaleFromCookie(req, i18n.locales) || preferredLocale || i18n.defaultLocale;
}

export function getLocaleDetection({ req, i18n }: IOptions) {
  if (i18n && i18n.localeDetection !== false) {
    const headers = Object.fromEntries(req.headers);
    const preferredLocale = getAcceptPreferredLocale(i18n, headers);
    const detectedLocale = detectLocale({
      i18n: i18n,
      req,
      preferredLocale,
    });

    return detectedLocale.toLowerCase();
  }
  return i18n.defaultLocale;
}
