import { FieldType } from '@teable/core';
import { useFields, useRecords, useView } from '@teable/sdk/hooks';
import type { EditorView } from '@teable/sdk/model';
import { useMemo } from 'react';
import { EditorFieldSelect } from './components/EditorFieldSelect';
import { MarkdownEditorPanel } from './components/MarkdownEditorPanel';
import { RecordList } from './components/RecordList';
import { useEditor } from './context';

export const EditorViewBase = () => {
  const view = useView() as EditorView | undefined;
  const fields = useFields({ withHidden: true, withDenied: true });
  const { records } = useRecords();
  const { selectedRecordId, editorFieldId } = useEditor();

  const longTextFields = useMemo(
    () => fields.filter((field) => field.type === FieldType.LongText),
    [fields]
  );

  const editorField = useMemo(
    () => fields.find((f) => f.id === editorFieldId),
    [fields, editorFieldId]
  );

  const selectedRecord = useMemo(
    () => records.find((r) => r.id === selectedRecordId),
    [records, selectedRecordId]
  );

  // If no long text fields exist, show a message
  if (longTextFields.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h3 className="text-lg font-medium text-muted-foreground">No Long Text Fields</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Create a Long Text field in this table to use the Editor view.
          </p>
        </div>
      </div>
    );
  }

  // If no editor field is selected, show field selection
  if (!editorFieldId || !editorField) {
    return (
      <div className="flex h-full items-center justify-center">
        <EditorFieldSelect
          fields={longTextFields}
          selectedFieldId={editorFieldId}
          onFieldSelect={(fieldId) => view?.updateOption({ editorFieldId: fieldId })}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Record List - Left Panel */}
      <RecordList records={records} selectedRecordId={selectedRecordId} editorField={editorField} />

      {/* Markdown Editor - Right Panel */}
      <MarkdownEditorPanel record={selectedRecord} field={editorField} />
    </div>
  );
};
