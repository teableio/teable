import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import type { ICustomHttpExceptionData, IHttpError } from '@teable/core';
import { sonner } from '@teable/ui-lib';
import {
  UsageLimitModalType,
  useUsageLimitModalStore,
} from '../../components/billing/store/usage-limit-modal';
import type { ILocaleFunction, TKey } from './i18n';

const { toast } = sonner;

export function toCamelCaseErrorCode(errorCode: string): string {
  return errorCode
    .split('_')
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

export const getHttpErrorMessage = (error: unknown, t: ILocaleFunction, prefix?: string) => {
  const { message, data } = error as IHttpError;
  const { localization } = (data as ICustomHttpExceptionData<TKey>) || {};
  const { i18nKey, context } = localization || {};
  return i18nKey ? t(prefix ? (`${prefix}:${i18nKey}` as TKey) : i18nKey, context ?? {}) : message;
};

export const errorRequestHandler = (error: unknown, t?: ILocaleFunction) => {
  const { code, message, status } = error as IHttpError;
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
