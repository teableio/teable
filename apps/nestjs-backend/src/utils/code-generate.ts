import { createHmac } from 'crypto';
import { baseConfig } from '../configs/base.config';

export const generateInvitationCode = (invitationId: string) => {
  const hmac = createHmac('sha256', baseConfig().secretKey);
  return hmac.update(invitationId).digest('hex');
};
