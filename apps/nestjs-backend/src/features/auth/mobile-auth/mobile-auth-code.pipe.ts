import type { ArgumentMetadata } from '@nestjs/common';
import { BadRequestException, Injectable } from '@nestjs/common';
import { createMobileAuthCodeRoSchema } from '@teable/openapi';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { invalidExchange } from './mobile-auth.service';

/**
 * Body validation for `POST /auth/mobile/code`. The parameters come straight from the app's
 * `/auth/mobile?…` URL, so a malformed one gets the same "sign in from the app again" error as
 * any other rejected step instead of the raw schema message.
 */
@Injectable()
export class MobileAuthCodeValidationPipe extends ZodValidationPipe {
  constructor() {
    super(createMobileAuthCodeRoSchema);
  }

  public transform(value: unknown, metadata: ArgumentMetadata): unknown {
    try {
      return super.transform(value, metadata);
    } catch (e) {
      if (e instanceof BadRequestException) throw invalidExchange(e.message);
      throw e;
    }
  }
}
