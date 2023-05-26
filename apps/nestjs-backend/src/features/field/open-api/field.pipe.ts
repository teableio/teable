import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { FieldSupplementService } from '../field-supplement.service';
import type { CreateFieldRo } from '../model/create-field.ro';
import { createFieldInstanceByRo } from '../model/factory';

@Injectable()
export class FieldPipe implements PipeTransform {
  constructor(private readonly fieldSupplementService: FieldSupplementService) {}
  async transform(value: CreateFieldRo, _metadata: ArgumentMetadata) {
    value = await this.fieldSupplementService.prepareFieldOptions(value);
    return createFieldInstanceByRo(value);
  }
}
