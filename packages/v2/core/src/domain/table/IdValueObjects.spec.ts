/* eslint-disable sonarjs/no-duplicate-string */
import { describe, expect, it } from 'vitest';

import { FieldId } from './fields/FieldId';
import { TableId } from './TableId';
import { ViewId } from './views/ViewId';

const tableIdPattern = /^tbl[0-9a-zA-Z]{16}$/;
const fieldIdPattern = /^fld[0-9a-zA-Z]{16}$/;
const viewIdPattern = /^viw[0-9a-zA-Z]{16}$/;

describe('TableId', () => {
  it('generates ids that follow the v1 format', () => {
    const result = TableId.generate();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.toString()).toMatch(tableIdPattern);
  });

  it('validates ids against the v1 format', () => {
    const valid = `tbl${'a'.repeat(16)}`;
    const invalidLegacy = `tbl${'a'.repeat(15)}_`;
    expect(TableId.create(valid).isOk()).toBe(true);
    expect(TableId.create(invalidLegacy).isErr()).toBe(true);
  });
});

describe('FieldId', () => {
  it('generates ids that follow the v1 format', () => {
    const result = FieldId.generate();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.toString()).toMatch(fieldIdPattern);
  });

  it('validates ids against the v1 format', () => {
    const valid = `fld${'b'.repeat(16)}`;
    const invalidLegacy = `fld${'b'.repeat(15)}_`;
    expect(FieldId.create(valid).isOk()).toBe(true);
    expect(FieldId.create(invalidLegacy).isErr()).toBe(true);
  });
});

describe('ViewId', () => {
  it('generates ids that follow the v1 format', () => {
    const result = ViewId.generate();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.toString()).toMatch(viewIdPattern);
  });

  it('validates ids against the v1 format', () => {
    const valid = `viw${'c'.repeat(16)}`;
    const invalidLegacy = `viw${'c'.repeat(15)}_`;
    expect(ViewId.create(valid).isOk()).toBe(true);
    expect(ViewId.create(invalidLegacy).isErr()).toBe(true);
  });
});
