import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';

export const UPLOAD_LOGO = '/admin/setting/logo';

export const uploadLogoRoSchema = z.object({
  file: z.string().openapi({ format: 'binary' }),
});

export const uploadLogoVoSchema = z.object({
  url: z.string(),
});

export type IUploadLogoVo = z.infer<typeof uploadLogoVoSchema>;

export type IUploadLogoRo = z.infer<typeof uploadLogoRoSchema>;

export const UploadLogoRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: UPLOAD_LOGO,
  description: 'Upload logo',
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: uploadLogoRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully upload logo.',
      content: {
        'application/json': {
          schema: uploadLogoVoSchema,
        },
      },
    },
  },
  tags: ['admin'],
});

export const uploadLogo = async (uploadLogoRo: IUploadLogoRo) => {
  return axios.patch<IUploadLogoVo>(urlBuilder(UPLOAD_LOGO), uploadLogoRo);
};
