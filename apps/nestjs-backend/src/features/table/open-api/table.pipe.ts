import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { IFieldVo } from '@teable/core';
import type { ICreateTableRo } from '@teable/openapi';
import { DEFAULT_FIELDS, DEFAULT_RECORD_DATA, DEFAULT_VIEWS } from '../constant';

@Injectable()
export class TablePipe implements PipeTransform {
  async transform(value: ICreateTableRo, _metadata: ArgumentMetadata) {
    return this.prepareDefaultRo(value);
  }

  async prepareDefaultRo(tableRo: ICreateTableRo): Promise<ICreateTableRo> {
    const fieldRos = tableRo.fields && tableRo.fields.length ? tableRo.fields : DEFAULT_FIELDS;
    // make sure first field to be the primary field;
    (fieldRos[0] as IFieldVo).isPrimary = true;

    return {
      ...tableRo,
      fields: fieldRos,
      views: tableRo.views && tableRo.views.length ? tableRo.views : DEFAULT_VIEWS,
      records: tableRo.records ? tableRo.records : DEFAULT_RECORD_DATA,
    };
  }
}
