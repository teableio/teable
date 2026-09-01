import { describe, expect, it } from 'vitest';

import { FieldId } from './fields/FieldId';
import { RecordId } from './records/RecordId';
import { TableId } from './TableId';
import { ViewId } from './views/ViewId';

const tableIdPattern = /^tbl[0-9a-zA-Z]{16}$/;
const fieldIdPattern = /^fld[0-9a-zA-Z]{16}$/;
const recordIdPattern = /^rec[0-9a-zA-Z]{16}$/;
const viewIdPattern = /^viw[0-9a-zA-Z]{16}$/;

describe('TableId', () => {
  it('generates ids that follow the v1 format', () => {
    const result = TableId.generate();
    const tableId = result._unsafeUnwrap();
    expect(tableId.toString()).toMatch(tableIdPattern);
  });

  it('validates ids against the v1 format', () => {
    const valid = `tbl${'a'.repeat(16)}`;
    const invalidLegacy = `tbl${'a'.repeat(15)}_`;
    TableId.create(valid)._unsafeUnwrap();
    TableId.create(invalidLegacy)._unsafeUnwrapErr();
  });
});

describe('FieldId', () => {
  it('generates ids that follow the v1 format', () => {
    const result = FieldId.generate();
    const fieldId = result._unsafeUnwrap();
    expect(fieldId.toString()).toMatch(fieldIdPattern);
  });

  it('validates ids against the v1 format', () => {
    const valid = `fld${'b'.repeat(16)}`;
    const invalidLegacy = `fld${'b'.repeat(15)}_`;
    FieldId.create(valid)._unsafeUnwrap();
    FieldId.create(invalidLegacy)._unsafeUnwrapErr();
  });

  it('accepts legacy duplicated field ids without accepting composite storage tokens', () => {
    const duplicatedFieldId = `fld${'b'.repeat(16)}_1`;
    const compositeStorageToken = `fld${'b'.repeat(16)}_fld${'c'.repeat(16)}`;
    FieldId.create(duplicatedFieldId)._unsafeUnwrap();
    FieldId.create(compositeStorageToken)._unsafeUnwrapErr();
  });
});

describe('RecordId', () => {
  it('generates ids that follow the v1 format', () => {
    const result = RecordId.generate();
    const recordId = result._unsafeUnwrap();
    expect(recordId.toString()).toMatch(recordIdPattern);
  });

  it('validates ids against the v1 format', () => {
    const valid = `rec${'d'.repeat(16)}`;
    const invalidLegacy = `rec${'d'.repeat(15)}_`;
    RecordId.create(valid)._unsafeUnwrap();
    RecordId.create(invalidLegacy)._unsafeUnwrapErr();
  });

  it('accepts legacy variable-length record ids without accepting other prefixes or charsets', () => {
    const legacyLonger = `rec${'d'.repeat(17)}`;
    const legacyShorter = `rec${'d'.repeat(8)}`;
    const maxLength = `rec${'d'.repeat(64)}`;
    const tooLong = `rec${'d'.repeat(65)}`;
    const emptyBody = 'rec';
    const wrongPrefix = `fld${'d'.repeat(16)}`;
    RecordId.create(legacyLonger)._unsafeUnwrap();
    RecordId.create(legacyShorter)._unsafeUnwrap();
    RecordId.create(maxLength)._unsafeUnwrap();
    RecordId.create(tooLong)._unsafeUnwrapErr();
    RecordId.create(emptyBody)._unsafeUnwrapErr();
    RecordId.create(wrongPrefix)._unsafeUnwrapErr();
  });

  it('only treats generated-format ids as canonical', () => {
    expect(RecordId.isCanonical(`rec${'d'.repeat(16)}`)).toBe(true);
    expect(RecordId.isCanonical(`rec${'d'.repeat(17)}`)).toBe(false);
    expect(RecordId.isCanonical('recipe')).toBe(false);
    expect(RecordId.isCanonical(null)).toBe(false);
  });
});

describe('ViewId', () => {
  it('generates ids that follow the v1 format', () => {
    const result = ViewId.generate();
    const viewId = result._unsafeUnwrap();
    expect(viewId.toString()).toMatch(viewIdPattern);
  });

  it('validates ids against the v1 format', () => {
    const valid = `viw${'c'.repeat(16)}`;
    const invalidLegacy = `viw${'c'.repeat(15)}_`;
    ViewId.create(valid)._unsafeUnwrap();
    ViewId.create(invalidLegacy)._unsafeUnwrapErr();
  });
});
