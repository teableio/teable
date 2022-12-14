import crypto from 'crypto';

export enum Prefix {
  Table = 'tbl',
  Field = 'fld',
  View = 'viw',
  Node = 'nod',
}

function randomHexString(len: number) {
  if (len > 0 && len % 2 === 0) {
    return crypto.randomBytes(len / 2).toString('hex');
  }

  throw new Error('len must > 0 and divisible by 2');
}

export function randomString16() {
  return randomHexString(16);
}

export function generateTableId() {
  return Prefix.Table + randomString16();
}

export function generateFieldId() {
  return Prefix.Field + randomString16();
}

export function generateViewId() {
  return Prefix.View + randomString16();
}
