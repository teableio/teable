import type { IZodToJsonSchemaConfig } from './type';

export const defaultBaseOpenApi = {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'Teable App',
    description: 'Manage Data as easy as drink a cup of tea',
  },
  servers: [
    {
      url: '/api/',
    },
  ],
};

export const baseConfig: IZodToJsonSchemaConfig = {
  target: 'openApi3',
  $refStrategy: 'none',
};
