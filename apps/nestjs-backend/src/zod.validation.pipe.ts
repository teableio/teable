import type { PipeTransform, ArgumentMetadata } from '@nestjs/common';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { fromZodError } from 'zod-validation-error';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: unknown) {}

  public transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = (this.schema as z.Schema).safeParse(value);

    if (!result.success) {
      throw new BadRequestException(fromZodError(result.error).message);
    }

    return result.data;
  }
}
