import { HttpErrorCode } from '@teable/core';
import { describe, expect, it } from 'vitest';
import { MailDeliveryException, toMailDeliveryException } from './mail-delivery-error';

const transport = { host: 'smtp.example.com', sender: 'hello@example.com' };

const smtpError = (fields: Record<string, unknown>) => Object.assign(new Error('boom'), fields);

describe('toMailDeliveryException', () => {
  it('classifies an SMTP reply-code rejection as a 424 failed dependency', () => {
    const error = smtpError({
      message: 'Message failed: 554 5.7.1 Reached address outgoing limits',
      code: 'EMESSAGE',
      responseCode: 554,
      response: '554 5.7.1 Reached address outgoing limits',
      command: 'DATA',
    });

    const exception = toMailDeliveryException(error, transport);

    expect(exception).toBeInstanceOf(MailDeliveryException);
    expect(exception?.getStatus()).toBe(424);
    expect(exception?.code).toBe(HttpErrorCode.FAILED_DEPENDENCY);
    expect(exception?.detail).toMatchObject({
      responseCode: 554,
      command: 'DATA',
      host: 'smtp.example.com',
      sender: 'hello@example.com',
    });
  });

  it('classifies transport failures that carry no SMTP reply code', () => {
    expect(toMailDeliveryException(smtpError({ code: 'EAUTH' }), transport)).toBeInstanceOf(
      MailDeliveryException
    );
    expect(toMailDeliveryException(smtpError({ code: 'ECONNECTION' }), transport)).toBeInstanceOf(
      MailDeliveryException
    );
    // TLS negotiation against the user's server, reported without a reply code
    expect(toMailDeliveryException(smtpError({ code: 'ETLS' }), transport)).toBeInstanceOf(
      MailDeliveryException
    );
  });

  it('leaves errors that are not transport-shaped unclassified', () => {
    expect(
      toMailDeliveryException(new TypeError('x is not a function'), transport)
    ).toBeUndefined();
    expect(toMailDeliveryException(smtpError({ code: 'ENOENT' }), transport)).toBeUndefined();
    expect(toMailDeliveryException('nope', transport)).toBeUndefined();
  });

  it('normalizes rejected recipients and truncates the raw response', () => {
    const exception = toMailDeliveryException(
      smtpError({
        code: 'EENVELOPE',
        response: 'x'.repeat(900),
        rejected: ['a@example.com', { address: 'b@example.com' }],
      }),
      transport
    );

    expect(exception?.detail.rejected).toEqual(['a@example.com', 'b@example.com']);
    expect(exception?.detail.response).toHaveLength(500);
  });

  it('truncates the message too — it reaches the API body and the workflow output', () => {
    const exception = toMailDeliveryException(
      smtpError({ code: 'EMESSAGE', message: 'Message failed: '.concat('x'.repeat(2000)) }),
      transport
    );

    expect(exception?.message.length).toBeLessThan(600);
  });

  it('never carries the SMTP credentials', () => {
    const exception = toMailDeliveryException(smtpError({ code: 'EAUTH' }), {
      ...transport,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auth: { user: 'user', pass: 'secret' },
    } as any);

    expect(JSON.stringify(exception?.detail)).not.toContain('secret');
  });
});
