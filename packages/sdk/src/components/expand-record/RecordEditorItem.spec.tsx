import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import type { IFieldVo } from '@teable/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IFieldInstance } from '../../model/field';
import { createFieldInstance } from '../../model/field/factory';
import { createRecordInstance, recordInstanceFieldMap } from '../../model/record/factory';
import { RecordEditorItem } from './RecordEditorItem';

vi.mock('../../context/app/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const textField = (): IFieldInstance =>
  createFieldInstance({
    id: 'fldNotes',
    name: 'Notes',
    type: FieldType.SingleLineText,
    dbFieldName: 'notes',
    dbFieldType: DbFieldType.Text,
    cellValueType: CellValueType.String,
    options: { defaultValue: 'fallback' },
  } as IFieldVo);

const renderItem = (fields: Record<string, unknown>) => {
  const field = textField();
  const record = recordInstanceFieldMap(createRecordInstance({ id: '', fields }), {
    [field.id]: field,
  });
  const onChange = vi.fn();
  render(<RecordEditorItem field={field} record={record} onChange={onChange} />);
  return { onChange, input: screen.getByRole('textbox') as HTMLInputElement };
};

describe('record editor item blur commit', () => {
  // Create-record dialogs start every field absent, which renders empty. Blurring such a
  // field must not turn "absent" into an explicit null: the server reads explicit null as
  // "clear this cell" and then skips the field's configured default value (T7997).
  it('does not commit an untouched empty field', () => {
    const { onChange, input } = renderItem({});

    fireEvent.focus(input);
    fireEvent.blur(input);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('still commits a cleared field that had a value', () => {
    const { onChange, input } = renderItem({ fldNotes: 'kept' });
    expect(input.value).toBe('kept');

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(null, 'fldNotes');
  });
});
