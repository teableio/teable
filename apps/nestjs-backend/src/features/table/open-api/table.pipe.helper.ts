import type { IFieldVo } from '@teable/core';
import { HttpErrorCode, PRIMARY_SUPPORTED_TYPES } from '@teable/core';
import type { ICreateTableRo, ICreateTableWithDefault } from '@teable/openapi';
import { CustomHttpException } from '../../../custom.exception';
import { DEFAULT_FIELDS, DEFAULT_VIEWS, DEFAULT_RECORD_DATA } from '../constant';

export const prepareCreateTableRo = (tableRo: ICreateTableRo): ICreateTableWithDefault => {
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
};
