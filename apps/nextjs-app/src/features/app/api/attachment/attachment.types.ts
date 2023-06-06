import type { paths } from '@/api/types';
import type { GET_SIGNATURE, NOTIFY } from './attachment.url';

export type IGetSignatureResponse =
  paths[typeof GET_SIGNATURE]['post']['responses'][200]['content']['application/json'];

export type IGetNotifyResponse =
  paths[typeof NOTIFY]['post']['responses'][200]['content']['application/json'];
