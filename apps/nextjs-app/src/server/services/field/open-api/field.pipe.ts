import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { CreateFieldRo } from '../model/create-field.ro';
import { createFieldInstanceByRo } from '../model/factory';

export class FieldPipe implements PipeTransform {
  transform(value: CreateFieldRo, _metadata: ArgumentMetadata) {
    return createFieldInstanceByRo(value);
  }
}
