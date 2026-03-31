import { Filter as FilterIcon, Share2, Plus, EyeOff, Settings, AlertTriangle } from '@teable/icons';
import type { CalendarView } from '@teable/sdk';
import {
  ViewFilter,
  VisibleFields,
  useTablePermission,
  CreateRecordModal,
  useIsReadOnlyPreview,
} from '@teable/sdk';
import { useView } from '@teable/sdk/hooks/use-view';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { CalendarConfig } from '../../calendar/components/CalendarConfig';
import { useToolbarChange } from '../../hooks/useToolbarChange';
import { ToolBarButton } from '../ToolBarButton';

export const CalendarViewOperators: React.FC<{ disabled?: boolean }> = (props) => {
  const { disabled } = props;
  const view = useView() as CalendarView | undefined;
  const permission = useTablePermission();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { onFilterChange } = useToolbarChange();
  const isReadOnlyPreview = useIsReadOnlyPreview();
  if (!view) return null;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {!isReadOnlyPreview && (
        <>
          <CreateRecordModal>
            <Button size={'xs'} variant={'outline'} disabled={!permission['record|create']}>
              <Plus className="size-4" />
              {t('table:view.addRecord')}
            </Button>
          </CreateRecordModal>
          <div className="mx-1 h-4 w-px shrink-0 bg-border" />
        </>
      )}
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
            <div className="mb-2 flex max-w-full items-center justify-start rounded-md border bg-muted px-3 py-2 text-xs text-muted-foreground dark:bg-white/5">
              <Share2 className="mr-2 size-4 shrink-0" />
              <span className="text-muted-foreground">{t('table:toolbar.viewFilterInShare')}</span>
            </div>
          )
        }
      >
        {(text, isActive, hasWarning) => (
          <ToolBarButton
            disabled={disabled}
            isActive={isActive}
            text={text}
            className={cn(
              'max-w-[200px]',
              isActive &&
                'bg-violet-100 dark:bg-violet-600/30 hover:bg-violet-200 dark:hover:bg-violet-500/30',
              hasWarning && 'border-yellow-500'
            )}
            textClassName="@2xl/toolbar:inline"
          >
            <>
              <FilterIcon className="size-4 shrink-0 text-sm" />
              {hasWarning && <AlertTriangle className="size-3.5 shrink-0 text-yellow-500" />}
            </>
          </ToolBarButton>
        )}
      </ViewFilter>
    </div>
  );
};
