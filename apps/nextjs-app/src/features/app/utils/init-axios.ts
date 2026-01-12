import type { IGetBaseVo } from '@teable/openapi';
import { axios, IS_TEMPLATE_HEADER, X_CANARY_HEADER } from '@teable/openapi';

let isInitAxios = false;

export const initAxios = (base: IGetBaseVo | undefined) => {
  if (isInitAxios || typeof window === 'undefined') return;
  if (base?.template?.headers) {
    axios.interceptors.request.use((config) => {
      config.headers[IS_TEMPLATE_HEADER] = base?.template?.headers;
      return config;
    });
  }
  if (base?.isCanary) {
    axios.interceptors.request.use((config) => {
      config.headers[X_CANARY_HEADER] = 'true';
      return config;
    });
  }
  isInitAxios = true;
};
