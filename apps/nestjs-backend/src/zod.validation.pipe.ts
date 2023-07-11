import type { PipeTransform, ArgumentMetadata } from '@nestjs/common';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { z } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: unknown) {}

  public transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const validationResult = (this.schema as z.Schema).safeParse(value);

    if (!validationResult.success) {
      throw new BadRequestException({ message: validationResult.error.errors[0].message });
    }

    return validationResult.data;
  }
}
