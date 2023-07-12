import type { IJsonApiResponse } from '@teable-group/core';
import axios from 'axios';
import { urlBuilder } from '../utils';
import { NOTIFY_URL, SIGNATURE_URL } from './path';
import type { NotifyVo, SignatureVo } from './schema';

export const getSignature = async () => {
  return axios.post<IJsonApiResponse<SignatureVo>>(SIGNATURE_URL);
};

export const notify = async (secret: string) => {
  return axios.post<IJsonApiResponse<NotifyVo>>(
    urlBuilder(NOTIFY_URL, {
      params: { secret },
    })
  );
};
