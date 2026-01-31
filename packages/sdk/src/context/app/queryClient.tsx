import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import type { ICustomHttpExceptionData, IHttpError, ILocalization } from '@teable/core';
import { HttpErrorCode } from '@teable/core';
import { sonner } from '@teable/ui-lib';
import {
  UsageLimitModalType,
  useUsageLimitModalStore,
} from '../../components/billing/store/usage-limit-modal';
import type { ILocaleFunction, TKey } from './i18n';

const { toast } = sonner;

// Network error toast deduplication - only show once per cooldown period
const NETWORK_ERROR_TOAST_ID = 'network-error-toast';
const NETWORK_ERROR_COOLDOWN_MS = 10 * 1000; // 10 seconds cooldown
let lastNetworkErrorTime = 0;

// Validation error deduplication - same message won't show within cooldown period
const VALIDATION_ERROR_COOLDOWN_MS = 5 * 1000; // 5 seconds cooldown
const lastValidationErrorTimes = new Map<string, number>();

export function toCamelCaseErrorCode(errorCode: string): string {
  return errorCode
    .split('_')
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

export const getLocalizationMessage = (
  localization: ILocalization,
  t: ILocaleFunction,
  prefix?: string
) => {
  const { i18nKey, context } = localization;
  const key = prefix ? `${prefix}:${i18nKey}` : i18nKey;
  return i18nKey ? t(key as TKey, context ?? {}) : '';
};

export const getHttpErrorMessage = (error: unknown, t: ILocaleFunction, prefix?: string) => {
  const { message, data } = error as IHttpError;
  const { localization } = (data as ICustomHttpExceptionData) || {};
  return localization ? getLocalizationMessage(localization, t, prefix) : message;
};

// eslint-disable-next-line sonarjs/cognitive-complexity
export const errorRequestHandler = (error: unknown, t?: ILocaleFunction) => {
  const { code, message, status } = error as IHttpError;

  // Network errors - show a gentler warning, deduplicated with cooldown
  // These are typically transient client-side issues, not server errors
  if (code === HttpErrorCode.NETWORK_ERROR) {
    const now = Date.now();
    // Skip if within cooldown period (prevents toast spam when multiple APIs fail)
    if (now - lastNetworkErrorTime < NETWORK_ERROR_COOLDOWN_MS) {
      return;
    }
    lastNetworkErrorTime = now;

    // Show a gentle warning with fixed id to prevent duplicates
    toast.warning(t ? t('httpErrors.networkError') : 'Network connection issue', {
      id: NETWORK_ERROR_TOAST_ID,
      duration: 3000,
    });
    return;
  }

  // Validation errors - deduplicate by message to avoid spam when multiple APIs fail with same filter issue
  if (code === HttpErrorCode.VALIDATION_ERROR && message) {
    const now = Date.now();
    const lastTime = lastValidationErrorTimes.get(message);
    if (lastTime && now - lastTime < VALIDATION_ERROR_COOLDOWN_MS) {
      return;
    }
    lastValidationErrorTimes.set(message, now);

    // Clean up old entries to prevent memory leak
    if (lastValidationErrorTimes.size > 20) {
      const threshold = now - VALIDATION_ERROR_COOLDOWN_MS;
      for (const [key, time] of lastValidationErrorTimes) {
        if (time < threshold) {
          lastValidationErrorTimes.delete(key);
        }
      }
    }
  }

  // no authentication
  if (status === 401) {
    window.location.href = `/auth/login?redirect=${encodeURIComponent(window.location.href)}`;
    return;
  }
  if (status === 402) {
    useUsageLimitModalStore.setState({ modalType: UsageLimitModalType.Upgrade, modalOpen: true });
    return;
  }
  if (status === 460) {
    useUsageLimitModalStore.setState({ modalType: UsageLimitModalType.User, modalOpen: true });
    return;
  }

  if (t) {
    const description = getHttpErrorMessage(error, t);

    return toast.error(
      code
        ? t(`httpErrors.${toCamelCaseErrorCode(code)}` as TKey)
        : t('httpErrors.unknownErrorCode'),
      {
        description,
      }
    );
  }

  toast.error(code || 'Unknown Error', {
    description: message,
  });
};

export const createQueryClient = (t?: ILocaleFunction) => {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: 10 * 1000,
        retry: false,
        networkMode: 'always',
      },
      mutations: {
        networkMode: 'always',
      },
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.meta?.['preventGlobalError']) {
          return;
        }
        errorRequestHandler(error, t);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (mutation.options.meta?.['preventGlobalError']) {
          return;
        }
        errorRequestHandler(error, t);
      },
    }),
  });
};
