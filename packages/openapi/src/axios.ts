import { generateWindowId, HttpError, HttpErrorCode } from '@teable/core';
import axiosInstance from 'axios';

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

const axios = createAxios();

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

  axios.defaults.baseURL = `${endpoint}/api`;
  axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

  // Add windowId for undo/redo functionality if enabled
  if (enableUndoRedo) {
    const windowId = generateWindowId();
    axios.defaults.headers.common['X-Window-Id'] = windowId;
  }

  return axios;
};

export { axios };
