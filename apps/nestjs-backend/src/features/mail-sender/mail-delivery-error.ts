import { HttpErrorCode } from '@teable/core';
import type { IMailTransportConfig } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';

// Anything outside this set escaping a send is our own bug, and must stay a 500 so it reaches Sentry
const SMTP_ERROR_CODES = new Set([
  'EENVELOPE',
  'EMESSAGE',
  'EAUTH',
  'ECONNECTION',
  'ESOCKET',
  'ETIMEDOUT',
  'EDNS',
  'ESTREAM',
  'EPROTOCOL',
  'ETLS',
]);

/** Caps both the raw response and the message, which nodemailer builds out of it */
const MAX_SMTP_TEXT_LENGTH = 500;

export interface IMailDeliveryDetail {
  /** nodemailer error code, e.g. EENVELOPE */
  code?: string;
  /** SMTP reply code, e.g. 554 */
  responseCode?: number;
  response?: string;
  /** SMTP command that failed, e.g. DATA */
  command?: string;
  rejected?: string[];
  host?: string;
  sender?: string;
}

/**
 * A user-owned SMTP server refused or could not accept the message. 424 rather than
 * 500: the platform is healthy, the dependency it was told to use is not.
 */
export class MailDeliveryException extends CustomHttpException {
  constructor(
    message: string,
    readonly detail: IMailDeliveryDetail
  ) {
    super(message, HttpErrorCode.FAILED_DEPENDENCY, { smtp: detail });
  }
}

const toAddressList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const addresses = value
    .map((item) =>
      typeof item === 'string' ? item : String((item as { address?: string })?.address ?? '')
    )
    .filter(Boolean);
  return addresses.length > 0 ? addresses : undefined;
};

/**
 * Classify a failure from a caller-supplied transport. Returns undefined when the
 * error is not transport-shaped, leaving it to propagate unchanged.
 */
export const toMailDeliveryException = (
  error: unknown,
  transport: Pick<IMailTransportConfig, 'host' | 'sender'>
): MailDeliveryException | undefined => {
  if (!error || typeof error !== 'object') return undefined;

  const candidate = error as {
    code?: unknown;
    responseCode?: unknown;
    response?: unknown;
    command?: unknown;
    rejected?: unknown;
    message?: unknown;
  };
  const code = typeof candidate.code === 'string' ? candidate.code : undefined;
  const responseCode =
    typeof candidate.responseCode === 'number' ? candidate.responseCode : undefined;
  if (responseCode === undefined && (!code || !SMTP_ERROR_CODES.has(code))) return undefined;

  const message =
    typeof candidate.message === 'string' && candidate.message
      ? candidate.message.slice(0, MAX_SMTP_TEXT_LENGTH)
      : 'SMTP delivery failed';

  return new MailDeliveryException(`Email delivery through your SMTP server failed: ${message}`, {
    code,
    responseCode,
    response:
      typeof candidate.response === 'string'
        ? candidate.response.slice(0, MAX_SMTP_TEXT_LENGTH)
        : undefined,
    command: typeof candidate.command === 'string' ? candidate.command : undefined,
    rejected: toAddressList(candidate.rejected),
    host: transport.host,
    sender: transport.sender,
  });
};
