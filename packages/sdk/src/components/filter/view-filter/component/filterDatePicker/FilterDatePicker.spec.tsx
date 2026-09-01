import type { IFieldVo } from '@teable/core';
import { CellValueType, DbFieldType, FieldType, isBefore } from '@teable/core';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../../../../../context/__tests__/createAppContext';
import { createFieldInstance, type DateField } from '../../../../../model';
import { FilterDatePicker } from './FilterDatePicker';

vi.mock('../../../../editor', () => ({ DateEditor: () => null }));
vi.mock('../../hooks', () => ({
  useDateI18nMap: () => new Proxy({}, { get: (_, key) => String(key) }),
}));
vi.mock('../base', () => ({ BaseSingleSelect: () => null }));
vi.mock('./DateRangePicker', () => ({ DateRangePicker: () => null }));

const dateFieldDto = {
  id: 'fldDate00000000001',
  name: 'Due date',
  dbFieldName: 'due_date',
  type: FieldType.Date,
  options: {
    formatting: {
      date: 'YYYY-MM-DD',
      time: 'None',
      timeZone: 'America/New_York',
    },
  },
  unique: false,
  notNull: false,
  isPrimary: false,
  isComputed: false,
  isPending: false,
  hasError: false,
  cellValueType: CellValueType.DateTime,
  dbFieldType: DbFieldType.DateTime,
} as IFieldVo;

const dateFilterValue = {
  mode: 'exactDate',
  exactDate: '2026-08-01T06:06:20.000Z',
  timeZone: 'America/New_York',
} as const;

const malformedLookupDateField = createFieldInstance({
  id: 'fldLookupDate00001',
  name: 'Scheduled date',
  dbFieldName: 'scheduled_date',
  type: FieldType.Date,
  options: {},
  unique: false,
  cellValueType: CellValueType.String,
  dbFieldType: DbFieldType.Text,
  isLookup: true,
  lookupOptions: {
    relationship: 'manyOne',
    foreignTableId: 'tblSource000000001',
    lookupFieldId: 'fldSourceDate00001',
    linkFieldId: 'fldSourceLink00001',
  },
} as unknown as IFieldVo) as DateField;

// The picker names its stacked drawer via the sdk translator, so it needs
// the app context the real tree always provides.
const wrapper = createAppContext();

describe('FilterDatePicker', () => {
  it('renders a legacy date lookup whose formatting metadata is missing', () => {
    expect(() =>
      render(
        <FilterDatePicker
          field={malformedLookupDateField}
          operator={isBefore.value}
          value={{
            mode: 'exactDate',
            exactDate: '2026-08-01T06:06:20.000Z',
            timeZone: 'America/New_York',
          }}
          onSelect={vi.fn()}
        />,
        { wrapper }
      )
    ).not.toThrow();
  });

  it('renders a plain date field DTO from getFields without hydration', () => {
    expect(() =>
      render(
        <FilterDatePicker
          field={dateFieldDto as unknown as DateField}
          operator={isBefore.value}
          value={dateFilterValue}
          onSelect={vi.fn()}
        />,
        { wrapper }
      )
    ).not.toThrow();
  });

  it('renders the same date field after createFieldInstance hydration', () => {
    expect(() =>
      render(
        <FilterDatePicker
          field={createFieldInstance(dateFieldDto) as DateField}
          operator={isBefore.value}
          value={dateFilterValue}
          onSelect={vi.fn()}
        />,
        { wrapper }
      )
    ).not.toThrow();
  });
});
