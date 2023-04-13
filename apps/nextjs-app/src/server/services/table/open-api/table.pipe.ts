import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { DEFAULT_FIELDS, DEFAULT_RECORDS, DEFAULT_VIEW } from '../constant';
import type { CreateTableRo } from '../create-table.ro';

@Injectable()
export class TablePipe implements PipeTransform {
  transform(value: CreateTableRo, _metadata: ArgumentMetadata) {
    return this.appendDefaultRo(value);
  }

  appendDefaultRo(tableRo: CreateTableRo): CreateTableRo {
    return {
      ...tableRo,
      fields: tableRo.fields && tableRo.fields.length ? tableRo.fields : DEFAULT_FIELDS,
      views: tableRo.views && tableRo.views.length ? tableRo.views : [DEFAULT_VIEW],
      rows: tableRo.rows ? tableRo.rows : DEFAULT_RECORDS,
    };
  }
}
