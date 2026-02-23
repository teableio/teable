import { describe, expect, it } from 'vitest';

import { LinkFieldUpdateSideEffectVisitor } from './LinkFieldUpdateSideEffectVisitor';
import { LinkFieldConfig } from '../types/LinkFieldConfig';

const buildConfig = (params: {
  relationship: 'oneOne' | 'oneMany' | 'manyOne' | 'manyMany';
  foreignTableId: string;
  lookupFieldId: string;
  isOneWay?: boolean;
}) => LinkFieldConfig.create(params)._unsafeUnwrap();

describe('LinkFieldUpdateSideEffectVisitor.requiresSymmetricFieldChange', () => {
  it('returns true when converting one-way to two-way', () => {
    const previousConfig = buildConfig({
      relationship: 'manyOne',
      foreignTableId: `tbl${'a'.repeat(16)}`,
      lookupFieldId: `fld${'b'.repeat(16)}`,
      isOneWay: true,
    });

    const nextConfig = buildConfig({
      relationship: 'manyOne',
      foreignTableId: `tbl${'a'.repeat(16)}`,
      lookupFieldId: `fld${'b'.repeat(16)}`,
      isOneWay: false,
    });

    expect(
      LinkFieldUpdateSideEffectVisitor.requiresSymmetricFieldChange(previousConfig, nextConfig)
    ).toBe(true);
  });

  it('returns true when relationship changes on two-way links', () => {
    const previousConfig = buildConfig({
      relationship: 'manyOne',
      foreignTableId: `tbl${'c'.repeat(16)}`,
      lookupFieldId: `fld${'d'.repeat(16)}`,
    });

    const nextConfig = buildConfig({
      relationship: 'oneMany',
      foreignTableId: `tbl${'c'.repeat(16)}`,
      lookupFieldId: `fld${'d'.repeat(16)}`,
    });

    expect(
      LinkFieldUpdateSideEffectVisitor.requiresSymmetricFieldChange(previousConfig, nextConfig)
    ).toBe(true);
  });

  it('returns true when foreign table changes on two-way links', () => {
    const previousConfig = buildConfig({
      relationship: 'manyOne',
      foreignTableId: `tbl${'e'.repeat(16)}`,
      lookupFieldId: `fld${'f'.repeat(16)}`,
    });

    const nextConfig = buildConfig({
      relationship: 'manyOne',
      foreignTableId: `tbl${'g'.repeat(16)}`,
      lookupFieldId: `fld${'h'.repeat(16)}`,
    });

    expect(
      LinkFieldUpdateSideEffectVisitor.requiresSymmetricFieldChange(previousConfig, nextConfig)
    ).toBe(true);
  });

  it('returns false when one-way status, relationship, and foreign table are unchanged', () => {
    const previousConfig = buildConfig({
      relationship: 'manyOne',
      foreignTableId: `tbl${'i'.repeat(16)}`,
      lookupFieldId: `fld${'j'.repeat(16)}`,
    });

    const nextConfig = buildConfig({
      relationship: 'manyOne',
      foreignTableId: `tbl${'i'.repeat(16)}`,
      lookupFieldId: `fld${'k'.repeat(16)}`,
    });

    expect(
      LinkFieldUpdateSideEffectVisitor.requiresSymmetricFieldChange(previousConfig, nextConfig)
    ).toBe(false);
  });
});
