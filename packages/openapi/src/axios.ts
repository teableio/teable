import { generateWindowId, HttpError, HttpErrorCode } from '@teable/core';
import type { AxiosInstance } from 'axios';
import axiosInstance from 'axios';

/**
 * AsyncLocalStorage for request-scoped axios instance (server-side only).
 * This allows tools to use a request-specific axios instance with proper authentication
 * in server environments while maintaining the singleton pattern for client-side usage.
 *
 * Using globalThis to ensure single instance across all module copies in monorepo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AxiosStorageType = {
  getStore: () => AxiosInstance | undefined;
  run: <T>(store: AxiosInstance, callback: () => T) => T;
};

// Use globalThis to share storage across multiple module instances (pnpm monorepo issue)
const GLOBAL_STORAGE_KEY = '__teable_axios_storage__';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalObj = globalThis as any;

/**
 * Get axios storage dynamically from globalThis.
 * This ensures we always get the current storage even if this module
 * was loaded before axios-storage.init set the global value.
 */
const getAxiosStorage = (): AxiosStorageType | null => {
  return globalObj[GLOBAL_STORAGE_KEY] ?? null;
};

// Check if error is network-related (client-side issue, not server error)
const isNetworkError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const err = error as { response?: unknown; message?: string; code?: string; name?: string };

  // No response from server - this is typically a network error
  if (!err.response) {
    const message = err.message?.toLowerCase() || '';
    const code = err.code?.toLowerCase() || '';
    const name = err.name?.toLowerCase() || '';

    return (
      name === 'typeerror' || // fetch failures
      code === 'err_network' ||
      code === 'econnaborted' ||
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('failed to fetch') ||
      message.includes('load failed') ||
      message.includes('networkerror') ||
      message.includes('connection') ||
      message.includes('timeout') ||
      message.includes('abort') ||
      message.includes('econnreset') ||
      message.includes('enotfound') ||
      message.includes('socket') ||
      message.includes('disconnected') ||
      message === 'no response from server'
    );
  }
  return false;
};

export const createAxios = () => {
  const axios = axiosInstance.create({
    baseURL: '/api',
  });

  axios.interceptors.response.use(
    (response) => {
      // Any status code that lie within the range of 2xx cause this function to trigger
      return response;
    },
    (error) => {
      // Any status codes that falls outside the range of 2xx cause this function to trigger
      const { data, status } = error?.response || {};

      // Detect network errors and use NETWORK_ERROR code instead of INTERNAL_SERVER_ERROR
      if (isNetworkError(error)) {
        throw new HttpError(
          {
            message: error?.message || 'Network connection issue',
            code: HttpErrorCode.NETWORK_ERROR,
          },
          0
        );
      }

      throw new HttpError(data || error?.message || 'no response from server', status || 500);
    }
  );
  return axios;
};

// Default axios instance (used for client-side or when no AsyncLocalStorage context)
const defaultAxios = createAxios();

/**
 * Get the current axios instance.
 * Returns the request-scoped instance if available (server-side), otherwise falls back to the default.
 *
 * Priority order:
 * 1. AsyncLocalStorage context (from runWithAxios) - REQUIRED for server-side authenticated requests
 * 2. Default axios (for client-side or when no authentication needed)
 */
export const getAxios = (): AxiosInstance => {
  // 1. Try AsyncLocalStorage context first (required for authenticated server-side requests)
  // Use dynamic lookup to handle module load order issues
  const storage = getAxiosStorage();
  if (storage) {
    const storedAxios = storage.getStore();
    if (storedAxios) {
      return storedAxios;
    }
  }

  // 2. Return default axios (client-side or unauthenticated requests)
  return defaultAxios;
};

/**
 * Run a callback with a request-scoped axios instance.
 * Use this to wrap async operations that need a specific axios configuration.
 * On client-side, this simply executes the callback (no AsyncLocalStorage available).
 *
 * @example
 * ```ts
 * await runWithAxios(configuredAxios, async () => {
 *   // All @teable/openapi calls here will use configuredAxios
 *   const records = await getRecords(tableId);
 * });
 * ```
 */
export const runWithAxios = <T>(axiosInstance: AxiosInstance, callback: () => T): T => {
  // Use dynamic lookup to handle module load order issues
  const storage = getAxiosStorage();
  if (storage) {
    return storage.run(axiosInstance, callback);
  }
  // On client-side, just execute the callback directly
  return callback();
};

/**
 * Proxy axios instance that delegates to getAxios() for each call.
 * This ensures all openapi functions use the correct axios instance
 * (either from AsyncLocalStorage context or the default).
 *
 * On server-side with runWithAxios: uses the injected authenticated axios
 * On client-side or without runWithAxios: uses the default axios
 */
const axios = new Proxy(defaultAxios, {
  get(target, prop, receiver) {
    // Always delegate to getAxios() to get the correct instance
    const currentAxios = getAxios();
    const value = Reflect.get(currentAxios, prop, receiver);
    // Bind functions to the correct axios instance
    if (typeof value === 'function') {
      return value.bind(currentAxios);
    }
    return value;
  },
}) as AxiosInstance;

/**
 * Configuration options for the Axios instance.
 */
export interface IAPIRequestConfig {
  /**
   * API endpoint, defaults to 'https://app.teable.ai'.
   */
  endpoint?: string;
  /**
   * Bearer token for authentication.
   */
  token: string;
  /**
   * Enable undo/redo functionality for API calls related to record, field, and view mutations
   */
  enableUndoRedo?: boolean;
}

/**
 * Configures the Axios instance with the provided options.
 * @param config - Configuration options
 */
export const configApi = (config: IAPIRequestConfig) => {
  const { token, enableUndoRedo, endpoint = 'https://app.teable.ai' } = config;
  if (!token) {
    throw new Error(
      `token is required, visit ${endpoint}/setting/personal-access-token to get one`
    );
  }

  defaultAxios.defaults.baseURL = `${endpoint}/api`;
  defaultAxios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

  // Add windowId for undo/redo functionality if enabled
  if (enableUndoRedo) {
    const windowId = generateWindowId();
    defaultAxios.defaults.headers.common['X-Window-Id'] = windowId;
  }

  return axios;
};

export { axios };
