import { ActionPrefix, IdPrefix } from '@teable/core';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';

export const getPrefixAction = (docType: IdPrefix) => {
  switch (docType) {
    case IdPrefix.View:
      return ActionPrefix.View;
    case IdPrefix.Table:
      return ActionPrefix.Table;
    case IdPrefix.Record:
      return ActionPrefix.Record;
    case IdPrefix.Field:
      return ActionPrefix.Field;
    default:
      return null;
  }
};

export const getAction = (op: CreateOp | DeleteOp | EditOp) => {
  if (op.create) {
    return 'create';
  }
  if (op.del) {
    return 'delete';
  }
  if (op.op) {
    return 'update';
  }
  return null;
};

export const getAxiosBaseUrl = () => `http://localhost:${process.env.PORT}/api`;
