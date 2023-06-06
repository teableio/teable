import type { IJsonApiResponse } from '@teable-group/core';
import axios from 'axios';
import { urlParams } from '../utils';
import type { IGetNotifyResponse, IGetSignatureResponse } from './attachment.types';
import { GET_SIGNATURE, NOTIFY } from './attachment.url';

export const getSignature = async () => {
  return await axios.post<IJsonApiResponse<IGetSignatureResponse>>(GET_SIGNATURE);
};

export const notify = async (secret: string) => {
  return await axios.post<IJsonApiResponse<IGetNotifyResponse>>(
    urlParams(NOTIFY, {
      secret,
    })
  );
};
