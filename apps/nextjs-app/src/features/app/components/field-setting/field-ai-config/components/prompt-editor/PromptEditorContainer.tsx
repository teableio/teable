import type { EditorView } from '@codemirror/view';
import { FieldType } from '@teable/core';
import { Maximize2, Plus } from '@teable/icons';
import { FieldSelector } from '@teable/sdk/components';
import { useFields } from '@teable/sdk/hooks';
import {
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState, useRef, useMemo } from 'react';
import { RequireCom } from '@/features/app/blocks/setting/components/RequireCom';
import { PromptEditor, type EditorViewRef, type IPromptEditorProps } from './PromptEditor';

interface IPromptEditorContainerProps extends IPromptEditorProps {
  label?: string;
  excludedFieldId?: string;
  required?: boolean;
}

export const PromptEditorContainer = (props: IPromptEditorContainerProps) => {
  const { label, className, excludedFieldId, required } = props;
  const fields = useFields({ withHidden: true, withDenied: true });
  const { t } = useTranslation('common');
  const [isDialogVisible, setDialogVisible] = useState(false);
  const mainEditorViewRef = useRef<EditorView | null>(null) as EditorViewRef;
  const dialogEditorViewRef = useRef<EditorView | null>(null) as EditorViewRef;

  const onFieldSelect = (fieldId: string) => {
    const formatValue = `{${fieldId}}`;
    const view = isDialogVisible ? dialogEditorViewRef.current : mainEditorViewRef.current;

    if (view) {
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: formatValue },
        selection: { anchor: from + formatValue.length },
      });
      view.focus();
    }
  };

  const excludedFieldIds = useMemo(() => {
    return fields
      .filter((field) => field.type === FieldType.Attachment || field.id === excludedFieldId)
      .map((field) => field.id);
  }, [fields, excludedFieldId]);

  const fieldSelector = (
    <FieldSelector excludedIds={excludedFieldIds} onSelect={onFieldSelect} modal>
      <Button variant="outline" size="xs" className="gap-1">
        <Plus className="size-4" />
        {t('noun.field')}
      </Button>
    </FieldSelector>
  );

  return (
    <>
      <div className={cn('flex flex-col overflow-hidden gap-y-2', className)}>
        <div className="flex items-center justify-between">
          <div className="text-sm">
            {label}
            {required && <RequireCom />}
          </div>
          <div className="flex items-center gap-2">
            {fieldSelector}
            <Button
              variant="outline"
              size="xs"
              onClick={() => setDialogVisible(true)}
              className="px-1.5"
            >
              <Maximize2 className="size-3" />
            </Button>
          </div>
        </div>
        <div className="flex-1">
          <PromptEditor {...props} editorViewRef={mainEditorViewRef} />
        </div>
      </div>

      <Dialog open={isDialogVisible} onOpenChange={setDialogVisible}>
        <DialogContent className="flex max-w-3xl flex-col" closeable={false}>
          <DialogHeader className="flex-none flex-row items-center justify-between">
            <DialogTitle>{label}</DialogTitle>
            {fieldSelector}
          </DialogHeader>
          <div className="flex-1">
            <PromptEditor {...props} height="280px" editorViewRef={dialogEditorViewRef} />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button size="sm">{t('actions.confirm')}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
