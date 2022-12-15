import crypto from 'crypto';

export enum Prefix {
  Table = 'tbl',
  Field = 'fld',
  View = 'viw',
  Node = 'nod',
  Record = 'rec',
}

function randomHexString(len: number) {
  if (len > 0 && len % 2 === 0) {
    return crypto.randomBytes(len / 2).toString('hex');
  }

  throw new Error('len must > 0 and divisible by 2');
}

export function generateTableId() {
  return Prefix.Table + randomHexString(16);
}

export function generateFieldId() {
  return Prefix.Field + randomHexString(16);
}

export function generateViewId() {
  return Prefix.View + randomHexString(16);
}

export function generateRecordId() {
  return Prefix.Record + randomHexString(8);
}
