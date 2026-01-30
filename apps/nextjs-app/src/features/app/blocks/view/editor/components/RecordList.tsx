import { Plus } from '@teable/icons';
import { CreateRecordModal, useTablePermission } from '@teable/sdk';
import type { Record as RecordInstance, IFieldInstance } from '@teable/sdk/model';
import { Button, cn, ScrollArea } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { useEditor } from '../context';

interface RecordListProps {
  records: RecordInstance[];
  selectedRecordId: string | null;
  editorField: IFieldInstance;
}

export const RecordList = ({ records, selectedRecordId, editorField }: RecordListProps) => {
  const { setSelectedRecordId } = useEditor();
  const permission = useTablePermission();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r bg-muted/30">
      {/* Header with Add Record Button */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-medium">{t('table:editor.recordList.title')}</h3>
        <CreateRecordModal>
          <Button
            size="xs"
            variant="ghost"
            disabled={!permission['record|create']}
            className="h-7 px-2"
          >
            <Plus className="size-4" />
          </Button>
        </CreateRecordModal>
      </div>

      {/* Record List */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-2">
          {records.length === 0 ? (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              {t('table:editor.recordList.empty')}
            </div>
          ) : (
            records.map((record) => {
              const title = record.title || t('table:editor.recordList.untitled');
              const content = record.fields[editorField.id] as string | undefined;
              const preview = content?.slice(0, 50) || '';

              return (
                <button
                  key={record.id}
                  type="button"
                  onClick={() => setSelectedRecordId(record.id)}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-md p-2 text-left transition-colors hover:bg-muted',
                    selectedRecordId === record.id && 'bg-muted'
                  )}
                >
                  <span className="line-clamp-1 text-sm font-medium">{title}</span>
                  {preview && (
                    <span className="line-clamp-2 text-xs text-muted-foreground">{preview}...</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
