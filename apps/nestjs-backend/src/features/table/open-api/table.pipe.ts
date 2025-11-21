import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { HttpErrorCode, PRIMARY_SUPPORTED_TYPES, type IFieldVo } from '@teable/core';
import type { ICreateTableRo } from '@teable/openapi';
import { CustomHttpException } from '../../../custom.exception';
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
    if (!PRIMARY_SUPPORTED_TYPES.has(fieldRos[0].type)) {
      throw new CustomHttpException(
        `Field type ${fieldRos[0].type} is not supported as primary field`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.primaryFieldNotSupported',
          },
        }
      );
    }

    return {
      ...tableRo,
      fields: fieldRos,
      views: tableRo.views && tableRo.views.length ? tableRo.views : DEFAULT_VIEWS,
      records: tableRo.records ? tableRo.records : DEFAULT_RECORD_DATA,
    };
  }
}
