import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { CreateFieldDto } from './create-field.dto';
import { createFieldInstance } from './model/factory';

@Injectable()
export class FieldPipe implements PipeTransform {
  transform(value: CreateFieldDto, _metadata: ArgumentMetadata) {
    return createFieldInstance(value);
  }
}
