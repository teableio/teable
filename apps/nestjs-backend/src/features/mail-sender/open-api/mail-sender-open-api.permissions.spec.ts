import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import { MailSenderOpenApiController } from './mail-sender-open-api.controller';

describe('MailSenderOpenApiController authorization metadata', () => {
  it('limits the SMTP transport test to instance admins', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        MailSenderOpenApiController.prototype.testTransportConfig
      )
    ).toEqual(['instance|update']);
  });

  it('requires base update permission to send mail', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, MailSenderOpenApiController.prototype.sendEmail)
    ).toEqual(['base|update']);
  });
});
