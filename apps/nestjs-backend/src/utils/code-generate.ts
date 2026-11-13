import { createHmac, timingSafeEqual } from 'node:crypto';
import { baseConfig } from '../configs/base.config';

const invitationHmac = (key: string, invitationId: string) =>
  createHmac('sha256', key).update(invitationId).digest('hex');

export const generateInvitationCode = (invitationId: string) =>
  invitationHmac(baseConfig().invitationSecret, invitationId);

const sameCode = (expected: string, presented: string) => {
  const expectedBytes = Buffer.from(expected);
  const presentedBytes = Buffer.from(presented);
  return (
    expectedBytes.length === presentedBytes.length && timingSafeEqual(expectedBytes, presentedBytes)
  );
};

/**
 * Whether a presented code belongs to the invitation: the HMAC of its id under the invitation
 * secret (BACKEND_INVITATION_SECRET, else SECRET_KEY) or, while a change settles, under
 * BACKEND_INVITATION_SECRET_OLD, so links sent before the change keep working until that is
 * removed. Computed, not looked up, so a wrong code is turned away before the database is asked.
 */
export const isValidInvitationCode = (invitationId: string, presented: string): boolean => {
  const { invitationSecret, invitationSecretOld } = baseConfig();
  return [invitationSecret, invitationSecretOld].some(
    (key) => Boolean(key) && sameCode(invitationHmac(key as string, invitationId), presented)
  );
};
