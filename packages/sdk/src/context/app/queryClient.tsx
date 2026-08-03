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

// 4xx statuses still surfaced on GET (query) requests — actionable for the user, not raw
// technical noise. 408: request/statement timeout ("narrow the scope and retry"); 429: rate limit.
const QUERY_VISIBLE_4XX_STATUSES = [408, 429];

// Network error toast deduplication - only show once per cooldown period
const NETWORK_ERROR_TOAST_ID = 'network-error-toast';
const NETWORK_ERROR_COOLDOWN_MS = 10 * 1000; // 10 seconds cooldown
let lastNetworkErrorTime = 0;

// Validation error deduplication - same message won't show within cooldown period
const VALIDATION_ERROR_COOLDOWN_MS = 5 * 1000; // 5 seconds cooldown
const lastValidationErrorTimes = new Map<string, number>();

// A content-derived id lets Sonner collapse identical error toasts into one
// instead of stacking a duplicate per concurrently-failing request.
const getErrorToastId = (title: unknown, description?: unknown): string =>
  `error-toast:${String(title ?? '')}:${String(description ?? '')}`;

export function toCamelCaseErrorCode(errorCode: string): string {
  return errorCode
    .split('_')
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getValidationLimitMessage = (
  data: ICustomHttpExceptionData | undefined,
  t: ILocaleFunction,
  prefix?: string
) => {
  const domainCode = data?.domainCode;
  if (typeof domainCode !== 'string' || !domainCode.startsWith('validation.limit.')) {
    return;
  }

  const limitKey = toCamelCaseErrorCode(domainCode.slice('validation.limit.'.length));
  const key = `httpErrors.limit.${limitKey}`;
  const prefixedKey = prefix ? `${prefix}:${key}` : key;
  const details = isRecord(data?.details) ? data.details : {};
  const message = t(prefixedKey as TKey, details);
  return typeof message === 'string' && message !== prefixedKey && message !== key
    ? message
    : undefined;
};

const getDomainCodeMessage = (
  data: ICustomHttpExceptionData | undefined,
  t: ILocaleFunction,
  prefix?: string
) => {
  const domainCode = data?.domainCode;
  if (typeof domainCode !== 'string') {
    return;
  }

  const key = `httpErrors.${domainCode}`;
  const prefixedKey = prefix ? `${prefix}:${key}` : key;
  const details = isRecord(data?.details) ? data.details : {};
  const message = t(prefixedKey as TKey, details);
  return typeof message === 'string' && message !== prefixedKey && message !== key
    ? message
    : undefined;
};

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
  const customData = (data as ICustomHttpExceptionData) || {};
  const limitMessage = getValidationLimitMessage(customData, t, prefix);
  if (limitMessage) return limitMessage;

  const { localization } = customData;
  if (localization) return getLocalizationMessage(localization, t, prefix);

  const domainCodeMessage = getDomainCodeMessage(customData, t, prefix);
  if (domainCodeMessage) return domainCodeMessage;

  return message;
};

const handleNetworkError = (t?: ILocaleFunction): boolean => {
  const now = Date.now();
  if (now - lastNetworkErrorTime < NETWORK_ERROR_COOLDOWN_MS) {
    return true;
  }
  lastNetworkErrorTime = now;
  toast.warning(t ? t('httpErrors.networkError') : 'Network connection issue', {
    id: NETWORK_ERROR_TOAST_ID,
    duration: 3000,
  });
  return true;
};

const dedupeValidationError = (message: string): boolean => {
  const now = Date.now();
  const lastTime = lastValidationErrorTimes.get(message);
  if (lastTime && now - lastTime < VALIDATION_ERROR_COOLDOWN_MS) {
    return true;
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
  return false;
};

const handleStatusRedirect = (status: number): boolean => {
  if (status === 401) {
    window.location.href = `/auth/login?redirect=${encodeURIComponent(window.location.href)}`;
    return true;
  }
  if (status === 402) {
    useUsageLimitModalStore.setState({ modalType: UsageLimitModalType.Upgrade, modalOpen: true });
    return true;
  }
  if (status === 460) {
    useUsageLimitModalStore.setState({ modalType: UsageLimitModalType.User, modalOpen: true });
    return true;
  }
  return false;
};

export const errorRequestHandler = (
  error: unknown,
  t?: ILocaleFunction,
  options?: { isQuery?: boolean }
) => {
  const { code, message, status } = error as IHttpError;

  if (code === HttpErrorCode.NETWORK_ERROR) {
    handleNetworkError(t);
    return;
  }

  if (code === HttpErrorCode.VALIDATION_ERROR && message && dedupeValidationError(message)) {
    return;
  }

  if (handleStatusRedirect(status)) {
    return;
  }

  // Silence 4xx errors on GET (query) requests — raw technical messages not useful to users.
  // Mutation 4xx errors are always shown so users get feedback on their actions.
  // QUERY_VISIBLE_4XX_STATUSES are the exceptions that are still surfaced (see definition above).
  if (
    options?.isQuery &&
    status >= 400 &&
    status < 500 &&
    !QUERY_VISIBLE_4XX_STATUSES.includes(status)
  ) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[Silenced 4xx] ${status} ${code}: ${message}`);
    }
    return;
  }

  if (t) {
    const description = getHttpErrorMessage(error, t);
    const title = code
      ? t(`httpErrors.${toCamelCaseErrorCode(code)}` as TKey)
      : t('httpErrors.unknownErrorCode');
    return toast.error(title, { description, id: getErrorToastId(title, description) });
  }

  const fallbackTitle = code || 'Unknown Error';
  toast.error(fallbackTitle, {
    description: message,
    id: getErrorToastId(fallbackTitle, message),
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
        errorRequestHandler(error, t, { isQuery: true });
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
