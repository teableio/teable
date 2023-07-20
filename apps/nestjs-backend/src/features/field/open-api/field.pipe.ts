import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { IFieldRo } from '@teable-group/core';
import { FieldSupplementService } from '../field-supplement.service';
import { createFieldInstanceByRo } from '../model/factory';

@Injectable()
export class FieldPipe implements PipeTransform {
  constructor(private readonly fieldSupplementService: FieldSupplementService) {}
  async transform(value: IFieldRo, _metadata: ArgumentMetadata) {
    value = await this.fieldSupplementService.prepareField(value);
    return createFieldInstanceByRo(value);
  }
}
