import { createAxios } from '@teable/openapi';

export const createAnonymousUserAxios = (appUrl: string) => {
  const anonymousAxios = createAxios();

  anonymousAxios.interceptors.request.use((config) => {
    config.baseURL = appUrl + '/api';
    return config;
  });

  anonymousAxios.interceptors.request.use((config) => {
    config.headers['X-Anonymous-User'] = true;
    return config;
  });
  return anonymousAxios;
};
