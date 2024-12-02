import { Filter as FilterIcon, Share2, Plus, EyeOff, Settings } from '@teable/icons';
import type { CalendarView } from '@teable/sdk';
import { ViewFilter, VisibleFields, useTablePermission, CreateRecordModal } from '@teable/sdk';
import { useView } from '@teable/sdk/hooks/use-view';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { GUIDE_VIEW_FILTERING } from '@/components/Guide';
import { tableConfig } from '@/features/i18n/table.config';
import { CalendarConfig } from '../../calendar/components/CalendarConfig';
import { useToolbarChange } from '../../hooks/useToolbarChange';
import { ToolBarButton } from '../ToolBarButton';
import { UndoRedoButtons } from './UndoRedoButtons';

export const CalendarViewOperators: React.FC<{ disabled?: boolean }> = (props) => {
  const { disabled } = props;
  const view = useView() as CalendarView | undefined;
  const permission = useTablePermission();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { onFilterChange } = useToolbarChange();

  if (!view) return null;

  return (
    <div className="flex items-center gap-2">
      <UndoRedoButtons />
      <div className="mx-2 h-4 w-px shrink-0 bg-slate-200" />
      <CreateRecordModal>
        <Button
          className="size-6 shrink-0 rounded-full p-0"
          size={'xs'}
          variant={'outline'}
          disabled={!permission['record|create']}
        >
          <Plus className="size-4" />
        </Button>
      </CreateRecordModal>
      <div className="mx-2 h-4 w-px shrink-0 bg-slate-200" />
      <CalendarConfig>
        <ToolBarButton
          disabled={disabled}
          isActive={false}
          text={t('table:calendar.toolbar.config')}
          textClassName="@2xl/toolbar:inline"
        >
          <Settings className="size-4 text-sm" />
        </ToolBarButton>
      </CalendarConfig>
      <VisibleFields>
        {(_text, _isActive) => (
          <ToolBarButton
            disabled={disabled}
            isActive={false}
            text={t('sdk:hidden.label')}
            textClassName="@2xl/toolbar:inline"
          >
            <EyeOff className="size-4 text-sm" />
          </ToolBarButton>
        )}
      </VisibleFields>
      <ViewFilter
        filters={view?.filter || null}
        onChange={onFilterChange}
        contentHeader={
          view.enableShare && (
            <div className="flex max-w-full items-center justify-start rounded-t bg-accent px-4 py-2 text-[11px]">
              <Share2 className="mr-4 size-4 shrink-0" />
              <span className="text-muted-foreground">{t('table:toolbar.viewFilterInShare')}</span>
            </div>
          )
        }
      >
        {(text, isActive) => (
          <ToolBarButton
            disabled={disabled}
            isActive={isActive}
            text={text}
            className={cn(
              GUIDE_VIEW_FILTERING,
              'max-w-xs',
              isActive &&
                'bg-violet-100 dark:bg-violet-600/30 hover:bg-violet-200 dark:hover:bg-violet-500/30'
            )}
            textClassName="@2xl/toolbar:inline"
          >
            <FilterIcon className="size-4 text-sm" />
          </ToolBarButton>
        )}
      </ViewFilter>
    </div>
  );
};
