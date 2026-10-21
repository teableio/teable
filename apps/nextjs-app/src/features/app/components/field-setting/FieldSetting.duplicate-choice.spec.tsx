import { CellValueType, DbFieldType, FieldType, type IFieldVo } from '@teable/core';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { render, screen, userEvent } from '@/test-utils';
import { FieldSettingBase } from './FieldSetting';
import { FieldOperator } from './type';

vi.mock('@teable/ui-lib/shadcn/ui/sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('./DynamicFieldEditor', () => ({
  DynamicFieldEditor: ({
    field,
    onChange,
  }: {
    field: {
      options?: { choices?: Array<{ name: string; color?: string; id?: string }> };
    };
    onChange?: (field: unknown) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onChange?.({
            ...field,
            options: {
              ...field.options,
              choices: [...(field.options?.choices ?? []), { name: 'A', color: 'green' }],
            },
          })
        }
      >
        Add duplicate A
      </button>
      <button
        type="button"
        onClick={() =>
          onChange?.({
            ...field,
            options: {
              ...field.options,
              choices: [...(field.options?.choices ?? []), { name: ' A ', color: 'green' }],
            },
          })
        }
      >
        Add trimmed duplicate A
      </button>
    </div>
  ),
}));

const selectField = {
  id: 'fldSelect000000001',
  name: 'Status',
  type: FieldType.SingleSelect,
  options: {
    choices: [
      { id: 'choA', name: 'A', color: 'blue' },
      { id: 'choB', name: 'B', color: 'red' },
    ],
  },
  cellValueType: CellValueType.String,
  dbFieldType: DbFieldType.Text,
  dbFieldName: 'Status',
} satisfies IFieldVo;

describe('FieldSetting duplicate choice toast', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  it.each(['Add duplicate A', 'Add trimmed duplicate A'])(
    'toasts the existing name for %s and does not add a choice',
    async (action) => {
      const onConfirm = vi.fn();
      render(
        <FieldSettingBase
          visible
          field={selectField}
          operator={FieldOperator.Edit}
          onCancel={() => undefined}
          onConfirm={onConfirm}
        />
      );

      await userEvent.click(screen.getByRole('button', { name: action }));
      await userEvent.click(screen.getByRole('button', { name: 'common:actions.save' }));

      expect(toast.error).toHaveBeenCalledWith('Choice name A already exists');
      expect(onConfirm).not.toHaveBeenCalled();
      expect(selectField.options.choices.map((choice) => choice.name)).toEqual(['A', 'B']);
    }
  );
});
