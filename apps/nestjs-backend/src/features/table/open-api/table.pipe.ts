import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { FieldSupplementService } from '../../field/field-supplement.service';
import type { CreateFieldRo } from '../../field/model/create-field.ro';
import { DEFAULT_FIELDS, DEFAULT_RECORD_DATA, DEFAULT_VIEW } from '../constant';
import type { CreateTableRo } from '../create-table.ro';

@Injectable()
export class TablePipe implements PipeTransform {
  constructor(private readonly fieldSupplementService: FieldSupplementService) {}
  async transform(value: CreateTableRo, _metadata: ArgumentMetadata) {
    return this.appendDefaultRo(value);
  }

  async appendDefaultRo(tableRo: CreateTableRo): Promise<CreateTableRo> {
    const fieldRos = tableRo.fields ? tableRo.fields : DEFAULT_FIELDS;
    // make sure first field to be the primary field;
    fieldRos[0].isPrimary = true;
    const fields: CreateFieldRo[] = [];
    for (const fieldRo of fieldRos) {
      fields.push(await this.fieldSupplementService.prepareField(fieldRo));
    }
    return {
      ...tableRo,
      fields,
      views: tableRo.views && tableRo.views.length ? tableRo.views : [DEFAULT_VIEW],
      data: tableRo.data ? tableRo.data : DEFAULT_RECORD_DATA,
    };
  }
}
