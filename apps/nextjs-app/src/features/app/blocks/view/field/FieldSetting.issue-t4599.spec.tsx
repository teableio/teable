import type { IFieldVo } from '@teable/core';
import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import type * as Sdk from '@teable/sdk';
import type * as FieldSettingModule from '@/features/app/components/field-setting';
import { FieldOperator } from '@/features/app/components/field-setting/type';
import { render, screen } from '@/test-utils';
import { FieldSetting } from './FieldSetting';
import { useFieldSettingStore } from './useFieldSettingStore';

const sdkMocks = vi.hoisted(() => ({
  useBaseId: vi.fn(),
  useField: vi.fn(),
  useTableId: vi.fn(),
}));

vi.mock('@teable/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof Sdk>();
  return {
    ...actual,
    useBaseId: sdkMocks.useBaseId,
    useField: sdkMocks.useField,
    useTableId: sdkMocks.useTableId,
  };
});

vi.mock('@/features/app/components/field-setting', async (importOriginal) => {
  const actual = await importOriginal<typeof FieldSettingModule>();
  return {
    ...actual,
    FieldSetting: ({ field }: { field?: IFieldVo }) => (
      <div data-testid="field-setting-field-name">{field?.name ?? ''}</div>
    ),
  };
});

describe('view FieldSetting issue T4599', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMocks.useBaseId.mockReturnValue('bse3QF4ziW8KZs8oSFO');
    sdkMocks.useTableId.mockReturnValue('tblfPsaqmAL4LgRusAG');
    useFieldSettingStore.setState({ setting: undefined });
  });

  it('passes a lookup field with nullable options through the real grid entry', () => {
    const lookupField = {
      id: 'fld9GMsoC0woRHhdKmc',
      name: '货柜动态/Container dynamics',
      type: FieldType.SingleSelect,
      options: null,
      isLookup: true,
      isConditionalLookup: false,
      lookupOptions: {
        relationship: 'manyOne',
        foreignTableId: 'tblcf5mwKmBFDZE1Fg4',
        lookupFieldId: 'fldKcDeDGpfUvAeWzAY',
        fkHostTableName: 'bse3QF4ziW8KZs8oSFO.Sheet2',
        selfKeyName: '__id',
        foreignKeyName: '__fk_fldBIkO8vGO7UdP3tMb',
        filterByViewId: null,
        visibleFieldIds: null,
        filter: null,
        linkFieldId: 'fldI1krriXWhBB03RA5',
      },
      cellValueType: CellValueType.String,
      isMultipleCellValue: false,
      dbFieldType: DbFieldType.Text,
      dbFieldName: 'Huo_Ju_Dong_Tai',
    } as unknown as IFieldVo;
    sdkMocks.useField.mockReturnValue(lookupField);
    useFieldSettingStore
      .getState()
      .openSetting({ fieldId: lookupField.id, operator: FieldOperator.Edit });

    render(<FieldSetting />);

    expect(screen.getByTestId('field-setting-field-name')).toHaveTextContent(
      '货柜动态/Container dynamics'
    );
  });
});
