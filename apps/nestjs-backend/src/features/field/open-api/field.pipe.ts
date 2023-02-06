import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { CreateFieldRo } from '../model/create-field.ro';
import { createFieldInstance } from '../model/factory';

@Injectable()
export class FieldPipe implements PipeTransform {
  transform(value: CreateFieldRo, _metadata: ArgumentMetadata) {
    return createFieldInstance(value);
  }
}
