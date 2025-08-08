import { generateWindowId, HttpError } from '@teable/core';
import axiosInstance from 'axios';

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
