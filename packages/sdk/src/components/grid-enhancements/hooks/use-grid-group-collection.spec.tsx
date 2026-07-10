import { CellValueType, FieldType } from '@teable/core';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFields, useView } from '../../../hooks';
import type { IFieldInstance } from '../../../model';
import { useGridGroupCollection } from './use-grid-group-collection';

vi.mock('../../../hooks', () => ({
  useFields: vi.fn(),
  useView: vi.fn(),
}));

vi.mock('../../../context/app/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@teable/next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}));

const mockedUseFields = vi.mocked(useFields);
const mockedUseView = vi.mocked(useView);

const formatting = { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'Asia/Shanghai' };

const createDateField = (id: string, isMultipleCellValue: boolean) =>
  ({
    id,
    name: 'Publish Date',
    type: FieldType.Date,
    isLookup: true,
    cellValueType: CellValueType.DateTime,
    isMultipleCellValue,
    options: { formatting },
    getDatetimeFormatting: () => formatting,
  }) as unknown as IFieldInstance;

const setup = (field: IFieldInstance) => {
  mockedUseView.mockReturnValue({
    group: [{ fieldId: field.id }],
  } as unknown as ReturnType<typeof useView>);
  mockedUseFields.mockReturnValue([field]);

  const { result } = renderHook(() => useGridGroupCollection());
  return result.current.getGroupCell;
};

describe('useGridGroupCollection getGroupCell', () => {
  it('renders group value of a multi-value lookup date field instead of (Empty)', () => {
    const getGroupCell = setup(createDateField('fldLookupDateMulti', true));

    const cell = getGroupCell(['2026-05-07T03:47:00.000Z'], 0) as { displayData: string };

    // date shape only: rendering falls back to the runtime time zone,
    // so the exact day is machine dependent
    expect(cell.displayData).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('renders group value of a single-value date field', () => {
    const getGroupCell = setup(createDateField('fldLookupDateSingle', false));

    const cell = getGroupCell('2026-05-07T03:47:00.000Z', 0) as { displayData: string };

    expect(cell.displayData).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('renders (Empty) for null group value', () => {
    const getGroupCell = setup(createDateField('fldLookupDateNull', true));

    const cell = getGroupCell(null, 0) as { displayData: string };

    expect(cell.displayData).toBe('(Empty)');
  });
});
