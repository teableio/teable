/* eslint-disable @typescript-eslint/naming-convention */
import { DbFieldType } from '@teable/core';
import type { FormulaParamType, IFormulaParamMetadata } from '@teable/core';

export interface IResolvedFormulaParamInfo {
  hasMetadata: boolean;
  type?: FormulaParamType;
  isFieldReference: boolean;
  isMultiValueField: boolean;
  isJsonField: boolean;
  fieldDbName?: string;
  fieldDbType?: DbFieldType;
  fieldCellValueType?: string;
}

const EMPTY_INFO: IResolvedFormulaParamInfo = {
  hasMetadata: false,
  type: undefined,
  isFieldReference: false,
  isMultiValueField: false,
  isJsonField: false,
  fieldDbName: undefined,
  fieldDbType: undefined,
  fieldCellValueType: undefined,
};

export function resolveFormulaParamInfo(
  metadataList: IFormulaParamMetadata[] | undefined,
  index?: number
): IResolvedFormulaParamInfo {
  if (index == null || !metadataList) {
    return EMPTY_INFO;
  }

  const metadata = metadataList[index];
  if (!metadata) {
    return EMPTY_INFO;
  }

  const field = metadata.field;
  const info: IResolvedFormulaParamInfo = {
    hasMetadata: true,
    type: metadata.type && metadata.type !== 'unknown' ? metadata.type : undefined,
    isFieldReference: Boolean(metadata.isFieldReference && field),
    isMultiValueField: Boolean(field?.isMultiple),
    isJsonField: field?.dbFieldType === DbFieldType.Json,
    fieldDbName: field?.dbFieldName,
    fieldDbType: field?.dbFieldType,
    fieldCellValueType: field?.cellValueType,
  };

  if (field?.isLookup && field.dbFieldType === DbFieldType.Json) {
    info.isJsonField = true;
    info.isMultiValueField = true;
  }

  if (!info.type) {
    info.type = inferTypeFromField(field);
  }

  if (info.isJsonField && !info.type) {
    info.type = 'string';
  }

  return info;
}

export function isTrustedNumeric(info: IResolvedFormulaParamInfo): boolean {
  return info.type === 'number' && !info.isJsonField && !info.isMultiValueField;
}

export function isTextLikeParam(info: IResolvedFormulaParamInfo): boolean {
  if (info.type !== 'string') {
    return false;
  }
  if (!info.isJsonField) {
    return true;
  }
  if (info.isMultiValueField) {
    return false;
  }
  if (info.fieldCellValueType && info.fieldCellValueType !== 'string') {
    return false;
  }
  return true;
}

export function isDatetimeLikeParam(info: IResolvedFormulaParamInfo): boolean {
  return info.type === 'datetime';
}

export function isBooleanLikeParam(info: IResolvedFormulaParamInfo): boolean {
  if (info.isJsonField) {
    return false;
  }

  return (
    info.type === 'boolean' ||
    info.fieldDbType === DbFieldType.Boolean ||
    info.fieldCellValueType === 'boolean'
  );
}

export function isJsonLikeParam(info: IResolvedFormulaParamInfo): boolean {
  return info.isJsonField || info.isMultiValueField;
}

function inferTypeFromField(field?: IFormulaParamMetadata['field']): FormulaParamType | undefined {
  if (!field || field.isMultiple) {
    return undefined;
  }

  const byDbType = mapDbFieldType(field.dbFieldType);
  if (byDbType) {
    return byDbType;
  }

  if (!field.cellValueType) {
    return undefined;
  }

  switch (field.cellValueType) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'datetime':
      return 'datetime';
    case 'string':
      return 'string';
    default:
      return undefined;
  }
}

function mapDbFieldType(dbFieldType?: DbFieldType): FormulaParamType | undefined {
  switch (dbFieldType) {
    case DbFieldType.Integer:
    case DbFieldType.Real:
      return 'number';
    case DbFieldType.Boolean:
      return 'boolean';
    case DbFieldType.DateTime:
      return 'datetime';
    case DbFieldType.Text:
      return 'string';
    default:
      return undefined;
  }
}
