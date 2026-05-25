import type { IFieldVo } from '@teable/core';
import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import type * as OpenApi from '@teable/openapi';
import { render, screen, TestAnchorProvider } from '@/test-utils';
import { FieldSettingBase } from './FieldSetting';
import { FieldOperator } from './type';

const openapiMocks = vi.hoisted(() => ({
  getField: vi.fn(),
}));

vi.mock('@teable/openapi', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenApi>();
  return {
    ...actual,
    getField: openapiMocks.getField,
  };
});

describe('FieldSetting issue T4599', () => {
  it('renders the reported lookup single-select field editor without crashing', async () => {
    const sourceField = {
      id: 'fldcZZUoaoNPzbR5QIv',
      name: '货物动态/Cargo dynamics',
      type: FieldType.SingleSelect,
      options: {
        choices: [
          { id: 'choKXBBm9v7', name: '未到仓 NOT ARRIVE', color: 'purple' },
          { id: 'choA3YIxoVJ', name: '在仓 IN', color: 'cyanBright' },
          { id: 'chocDA1juPX', name: '已发SHIPPED', color: 'cyanLight2' },
          { id: 'choDZB1CEbx', name: 'HOLD', color: 'yellowLight1' },
          { id: 'choU2tLjkg4', name: '尾货  remaining goods', color: 'cyanDark1' },
        ],
        defaultValue: '未到仓 NOT ARRIVE',
        preventAutoNewOptions: true,
      },
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Text,
      dbFieldName: 'Huo_Wu_Dong_Tai',
    } as IFieldVo;
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
        linkFieldId: 'fldI1krriXWhBB03RA5',
      },
      cellValueType: CellValueType.String,
      isMultipleCellValue: false,
      dbFieldType: DbFieldType.Text,
      dbFieldName: 'Huo_Ju_Dong_Tai',
    } as unknown as IFieldVo;
    openapiMocks.getField.mockResolvedValue({ data: sourceField });

    render(
      <TestAnchorProvider fields={[sourceField, lookupField] as never}>
        <FieldSettingBase
          visible
          field={lookupField}
          operator={FieldOperator.Edit}
          onCancel={() => undefined}
          onConfirm={() => undefined}
        />
      </TestAnchorProvider>
    );

    expect(
      await screen.findByDisplayValue('货柜动态/Container dynamics', undefined, { timeout: 5000 })
    ).toBeInTheDocument();
  });

  it('renders when cached select options are present but invalid for the field type', async () => {
    const lookupField = {
      id: 'fld9GMsoC0woRHhdKmc',
      name: '货柜动态/Container dynamics',
      type: FieldType.SingleSelect,
      options: {},
      isLookup: true,
      isConditionalLookup: false,
      lookupOptions: {
        relationship: 'manyOne',
        foreignTableId: 'tblcf5mwKmBFDZE1Fg4',
        lookupFieldId: 'fldKcDeDGpfUvAeWzAY',
        linkFieldId: 'fldI1krriXWhBB03RA5',
      },
      cellValueType: CellValueType.String,
      isMultipleCellValue: false,
      dbFieldType: DbFieldType.Text,
      dbFieldName: 'Huo_Ju_Dong_Tai',
    } as unknown as IFieldVo;
    openapiMocks.getField.mockResolvedValue({ data: lookupField });

    render(
      <TestAnchorProvider fields={[lookupField] as never}>
        <FieldSettingBase
          visible
          field={lookupField}
          operator={FieldOperator.Edit}
          onCancel={() => undefined}
          onConfirm={() => undefined}
        />
      </TestAnchorProvider>
    );

    expect(
      await screen.findByDisplayValue('货柜动态/Container dynamics', undefined, { timeout: 5000 })
    ).toBeInTheDocument();
  });
});
