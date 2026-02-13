import type { IGetBaseVo } from '@teable/openapi';
import { axios, IS_TEMPLATE_HEADER, X_CANARY_HEADER, BASE_SHARE_ID_HEADER } from '@teable/openapi';

interface IInitAxiosOptions {
  base?: IGetBaseVo;
  shareId?: string;
}

/**
 * Mutable config object that the single interceptor reads from.
 * Replaced entirely on each `initAxios` call to avoid stale headers
 * leaking across page navigations.
 */
let currentOptions: IInitAxiosOptions = {};
let interceptorRegistered = false;

/**
 * Initialize axios request interceptors for page-specific headers.
 *
 * - Registers a single interceptor on first call.
 * - On subsequent calls, only updates the config (no extra interceptors).
 * - The interceptor reads `currentOptions` dynamically, so updating
 *   the config is immediately effective for all future requests.
 */
export const initAxios = (options: IInitAxiosOptions = {}) => {
  if (typeof window === 'undefined') return;

  // Replace config entirely — prevents stale headers from previous pages
  currentOptions = options;

  if (interceptorRegistered) return;

  axios.interceptors.request.use((config) => {
    const { base, shareId } = currentOptions;

    // Template preview
    if (base?.template?.headers) {
      config.headers[IS_TEMPLATE_HEADER] = base.template.headers;
    }

    // Canary version
    if (base?.isCanary) {
      config.headers[X_CANARY_HEADER] = 'true';
    }

    // Base share page
    if (shareId) {
      config.headers[BASE_SHARE_ID_HEADER] = shareId;
    }

    return config;
  });

  interceptorRegistered = true;
};
