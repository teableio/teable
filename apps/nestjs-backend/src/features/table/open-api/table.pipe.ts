import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { ICreateTableRo } from '@teable/openapi';
import { prepareCreateTableRo } from './table.pipe.helper';

@Injectable()
export class TablePipe implements PipeTransform {
  async transform(value: ICreateTableRo, _metadata: ArgumentMetadata) {
    return prepareCreateTableRo(value);
  }
}
