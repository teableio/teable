import { stringify } from 'qs';
import { openApiGenerator } from './generate.schema';

export const urlBuilder = (url: string, pathParams?: Record<string, unknown>) => {
  if (!pathParams) {
    return url;
  }

  Object.entries(pathParams).forEach(([key, value]) => {
    url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
  });
  return url;
};

export const registerRoute = openApiGenerator.registerRoute;

export const paramsSerializer = (params: Record<string, unknown>) => {
  const paramsInner = Object.keys(params).reduce(
    (acc, key) => {
      const value = params[key];
      if (value) {
        acc[key] = value;
      }
      return acc;
    },
    {} as Record<string, unknown>
  );
  return stringify(paramsInner);
};
