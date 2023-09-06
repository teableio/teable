import { AttachmentSchema, AttachmentPath } from '@teable-group/openapi';
import { axios } from '../config/axios';
import { urlBuilder } from './utils';

// eslint-disable-next-line @typescript-eslint/naming-convention
const { SIGNATURE_URL, NOTIFY_URL } = AttachmentPath;

export const getSignature = async () => {
  AttachmentSchema;
  return axios.post<AttachmentSchema.SignatureVo>(SIGNATURE_URL);
};

export const notify = async (secret: string) => {
  return axios.post<AttachmentSchema.NotifyVo>(
    urlBuilder(NOTIFY_URL, {
      params: { secret },
    })
  );
};
