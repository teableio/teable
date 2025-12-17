import { axios, IS_TEMPLATE_HEADER } from '@teable/openapi';

let isInitAxios = false;

export const initAxios = ({ templateHeader }: { templateHeader?: string }) => {
  if (isInitAxios || typeof window === 'undefined') return;
  if (templateHeader) {
    axios.interceptors.request.use((config) => {
      config.headers[IS_TEMPLATE_HEADER] = templateHeader;
      return config;
    });
  }
  isInitAxios = true;
};
