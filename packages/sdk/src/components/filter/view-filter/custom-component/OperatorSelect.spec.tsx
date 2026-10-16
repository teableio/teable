import zhSdk from '@teable/common-i18n/src/locales/zh/sdk.json';
import type { IFilterOperator } from '@teable/core';
import { CellValueType, FieldType } from '@teable/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { merge } from 'lodash';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../../../context/app/AppContext';
import { defaultLocale } from '../../../../context/app/i18n';
import type { IFieldInstance } from '../../../../model';
import type { IBaseFilterContext } from '../../context';
import { BaseFilterContext } from '../../context';
import { ViewFilterContext } from '../context';
import type { IViewFilterConditionItem } from '../types';
import { OperatorSelect } from './OperatorSelect';

const zhLocale = merge({}, defaultLocale, zhSdk);

// Only the four properties `getValidFilterOperators` reads matter here, so the
// menu under test is driven by field type + multiplicity, exactly as the app.
const singleUserField = {
  id: 'fldSingleUser0001',
  name: 'U1',
  type: FieldType.User,
  cellValueType: CellValueType.String,
  isMultipleCellValue: false,
} as IFieldInstance;

const multipleUserField = {
  id: 'fldMultiUser00001',
  name: 'U2',
  type: FieldType.User,
  cellValueType: CellValueType.String,
  isMultipleCellValue: true,
} as IFieldInstance;

const createdByField = {
  id: 'fldCreatedBy00001',
  name: '创建人',
  type: FieldType.CreatedBy,
  cellValueType: CellValueType.String,
  isMultipleCellValue: false,
} as IFieldInstance;

const singleLineTextField = {
  id: 'fldSingleLineText1',
  name: '文本',
  type: FieldType.SingleLineText,
  cellValueType: CellValueType.String,
  isMultipleCellValue: false,
} as IFieldInstance;

const singleSelectField = {
  id: 'fldSingleSelect01',
  name: '单选',
  type: FieldType.SingleSelect,
  cellValueType: CellValueType.String,
  isMultipleCellValue: false,
} as IFieldInstance;

const multipleSelectField = {
  id: 'fldMultiSelect0001',
  name: '多选',
  type: FieldType.MultipleSelect,
  cellValueType: CellValueType.String,
  isMultipleCellValue: true,
} as IFieldInstance;

const linkField = {
  id: 'fldLink000000000',
  name: '关联',
  type: FieldType.Link,
  cellValueType: CellValueType.String,
  isMultipleCellValue: true,
} as IFieldInstance;

const crud: IBaseFilterContext = {
  getValue: () => ({ conjunction: 'and', children: [] }),
  onDelete: vi.fn(),
  onChange: vi.fn(),
  createCondition: vi.fn(),
  component: {
    FieldComponent: () => null,
    OperatorComponent: () => null,
    ValueComponent: () => null,
  },
};

/**
 * OperatorSelect is the real filter operator menu: it resolves the operator
 * list from `getValidFilterOperators(field)` and each label from
 * `useOperatorI18nMap`. Driving the actual dropdown proves what a zh user
 * reads instead of re-deriving the mapping in the test.
 */
const renderOperatorSelect = (field: IFieldInstance, operator: IFilterOperator) => {
  const item: IViewFilterConditionItem = { field: field.id, operator, value: null };

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AppContext.Provider value={{ locale: zhLocale, lang: 'zh' }}>
      <ViewFilterContext.Provider
        value={{ fields: [field], viewFilterLinkContext: { isLoading: false, data: undefined } }}
      >
        <BaseFilterContext.Provider value={crud}>{children}</BaseFilterContext.Provider>
      </ViewFilterContext.Provider>
    </AppContext.Provider>
  );

  const { container } = render(
    <OperatorSelect value={operator} item={item} path={['filterSet', 0]} />,
    { wrapper: Wrapper }
  );

  fireEvent.click(within(container).getByRole('combobox'));
  return screen.getAllByRole('option').map((option) => option.textContent);
};

describe('OperatorSelect user field operators T7794', () => {
  it('labels the single-user menu 是/不是/是任一/不是任一 in that order', () => {
    expect(renderOperatorSelect(singleUserField, 'is')).toEqual([
      '是',
      '不是',
      '是任一',
      '不是任一',
      '为空',
      '不为空',
    ]);
  });

  it('labels and orders the multiple-users menu 包含任一…不包含任一 before the empty checks', () => {
    expect(renderOperatorSelect(multipleUserField, 'hasAnyOf')).toEqual([
      '包含任一',
      '包含全部',
      '完全等于',
      '不完全等于',
      '不包含任一',
      '为空',
      '不为空',
    ]);
  });
});

describe('OperatorSelect other field types keep their zh menu T7794', () => {
  it.each<[string, IFieldInstance, IFilterOperator, string[]]>([
    [
      'single line text',
      singleLineTextField,
      'is',
      ['等于', '不等于', '包含', '不包含', '为空', '不为空'],
    ],
    [
      'single select',
      singleSelectField,
      'is',
      ['等于', '不等于', '属于', '不属于', '为空', '不为空'],
    ],
    [
      'multiple select',
      multipleSelectField,
      'hasAnyOf',
      ['包含任意一个', '包含所有', '等于', '不等于', '不包含任何', '为空', '不为空'],
    ],
    ['created by', createdByField, 'is', ['等于', '不等于', '属于', '不属于', '为空', '不为空']],
    [
      'link',
      linkField,
      'hasAnyOf',
      [
        '包含任意一个',
        '包含所有',
        '等于',
        '不包含任何',
        '不等于',
        '包含',
        '不包含',
        '为空',
        '不为空',
      ],
    ],
  ])('%s is unchanged', (_name, field, operator, expected) => {
    expect(renderOperatorSelect(field, operator)).toEqual(expected);
  });
});
