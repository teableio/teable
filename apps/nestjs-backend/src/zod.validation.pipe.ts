import type { PipeTransform, ArgumentMetadata } from '@nestjs/common';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { fromZodError } from 'zod-validation-error';

const maxErrorLength = 1000;

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: unknown) {}

  public transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = (this.schema as z.Schema).safeParse(value);

    if (!result.success) {
      let message: string;

      // For invalid_union with custom message, use that instead of detailed errors
      if (
        result.error.issues.length === 1 &&
        result.error.issues[0].code === 'invalid_union' &&
        result.error.issues[0].message &&
        !result.error.issues[0].message.startsWith('Invalid')
      ) {
        message = result.error.issues[0].message;
      } else {
        message = fromZodError(result.error).message;
      }

      // Truncate very long error messages
      if (message.length > maxErrorLength) {
        message = message.substring(0, maxErrorLength) + '... (truncated)';
      }

      throw new BadRequestException(message);
    }

    return result.data;
  }
}
