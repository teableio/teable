import zhSdk from '@teable/common-i18n/src/locales/zh/sdk.json';
import type { IFieldVo } from '@teable/core';
import { CellValueType, DbFieldType, FieldType, is, isBefore } from '@teable/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { merge } from 'lodash';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { AppContext } from '../../../../../context/app/AppContext';
import { defaultLocale } from '../../../../../context/app/i18n';
import type { DateField } from '../../../../../model';
import { FilterDatePicker } from './FilterDatePicker';

const zhLocale = merge({}, defaultLocale, zhSdk);

const dateField = {
  id: 'fldDateYearModes01',
  name: '日期',
  dbFieldName: 'date',
  type: FieldType.Date,
  options: {
    formatting: {
      date: 'YYYY-MM-DD',
      time: 'None',
      timeZone: 'Asia/Shanghai',
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

const wrapper = ({ children }: { children: ReactNode }) => (
  <AppContext.Provider value={{ locale: zhLocale, lang: 'zh' }}>{children}</AppContext.Provider>
);

const openModes = (operator: string) => {
  const { container } = render(
    <FilterDatePicker
      field={dateField as unknown as DateField}
      operator={operator}
      value={null}
      onSelect={() => undefined}
    />,
    { wrapper }
  );
  fireEvent.click(within(container).getByRole('combobox'));
  return screen.getAllByRole('option').map((option) => option.textContent);
};

describe('FilterDatePicker year modes T7816', () => {
  it('includes 本年/去年/明年 and 日期范围 for the equals operator', () => {
    expect(openModes(is.value)).toEqual([
      '今天',
      '明天',
      '昨天',
      '本周',
      '上周',
      '下周',
      '本月',
      '上个月',
      '下个月',
      '本年',
      '去年',
      '明年',
      '几天前',
      '几天后',
      '具体日期',
      '日期范围',
    ]);
  });

  it('keeps 本年/去年/明年 and drops 日期范围 for 早于', () => {
    const options = openModes(isBefore.value);
    expect(options).toContain('本年');
    expect(options).toContain('去年');
    expect(options).toContain('明年');
    expect(options).not.toContain('日期范围');
  });
});
