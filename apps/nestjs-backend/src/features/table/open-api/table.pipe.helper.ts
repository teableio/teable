import type { IFieldVo } from '@teable/core';
import { HttpErrorCode, PRIMARY_SUPPORTED_TYPES } from '@teable/core';
import type { ICreateTableRo, ICreateTableWithDefault } from '@teable/openapi';
import { CustomHttpException } from '../../../custom.exception';
import { DEFAULT_FIELDS, DEFAULT_VIEWS } from '../constant';

/** Y2814 / T7771 public code. Distinct from HttpErrorCode.VALIDATION_ERROR (`validation_error`). */
const UNSUPPORTED_PRIMARY_FIELD_CODE = 'VALIDATION_ERROR';

export const prepareCreateTableRo = (tableRo: ICreateTableRo): ICreateTableWithDefault => {
  const fieldRos = tableRo.fields?.length ? tableRo.fields : DEFAULT_FIELDS;
  // make sure first field to be the primary field;
  (fieldRos[0] as IFieldVo).isPrimary = true;
  if (!PRIMARY_SUPPORTED_TYPES.has(fieldRos[0].type)) {
    const exception = new CustomHttpException(
      `Field type ${fieldRos[0].type} is not supported as primary field`,
      HttpErrorCode.VALIDATION_ERROR,
      {
        localization: {
          i18nKey: 'httpErrors.field.primaryFieldNotSupported',
        },
      }
    );
    exception.code = UNSUPPORTED_PRIMARY_FIELD_CODE;
    throw exception;
  }

  return {
    ...tableRo,
    fields: fieldRos,
    views: tableRo.views?.length ? tableRo.views : DEFAULT_VIEWS,
  };
};
