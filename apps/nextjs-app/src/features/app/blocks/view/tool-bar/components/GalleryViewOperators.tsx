import { ArrowUpDown, Filter as FilterIcon, Share2, Settings, AlertTriangle } from '@teable/icons';
import type { GalleryView } from '@teable/sdk';
import { Sort, ViewFilter, VisibleFields } from '@teable/sdk';
import { useIsDrawerLayout } from '@teable/sdk/components';
import { useView } from '@teable/sdk/hooks/use-view';
import { Label, Switch, cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { useToolbarChange } from '../../hooks/useToolbarChange';
import { ToolBarButton } from '../ToolBarButton';
import { CoverFieldSelect } from './CoverFieldSelect';
import { ScrollableToolbarGroup } from './ScrollableToolbarGroup';

export const GalleryViewOperators: React.FC<{ disabled?: boolean }> = (props) => {
  // Same footer as the kanban toolbar: rendered inside the shared shell, so it
  // also appears in the desktop popover.
  const isDrawer = useIsDrawerLayout();
  const { disabled } = props;
  const view = useView() as GalleryView | undefined;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { onFilterChange, onSortChange } = useToolbarChange();
  const { coverFieldId, isCoverFit, isFieldNameHidden } = view?.options ?? {};

  const onCoverFieldChange = (fieldId: string | null) => {
    view?.updateOption({ coverFieldId: fieldId });
  };

  const onCoverFitChange = (checked: boolean) => {
    view?.updateOption({ isCoverFit: checked });
  };

  const onFieldNameHiddenChange = (checked: boolean) => {
    view?.updateOption({ isFieldNameHidden: checked });
  };

  if (!view) return null;

  return (
    <ScrollableToolbarGroup className="items-center">
      <VisibleFields
        responsive
        title={t('table:kanban.toolbar.customizeCards')}
        footer={
          <>
            <CoverFieldSelect
              fieldId={coverFieldId}
              isCoverFit={isCoverFit}
              onSelectChange={onCoverFieldChange}
              onCheckedChange={onCoverFitChange}
              className="border-t"
            />
            {/* min-height instead of a fixed one so the label can wrap in
                de/fr/ru - drawer only, since this footer also renders inside
                the desktop popover. */}
            <div
              className={cn(
                'flex h-10 items-center justify-between border-t px-4',
                isDrawer && 'h-auto min-h-10 gap-3 py-3'
              )}
            >
              <Label
                htmlFor="is-field-name-hidden"
                className={cn('text-sm font-normal', isDrawer && 'min-w-0')}
              >
                {t('table:kanban.toolbar.hideFieldName')}
              </Label>
              <Switch
                id="is-field-name-hidden"
                size={'default'}
                checked={isFieldNameHidden}
                onCheckedChange={onFieldNameHiddenChange}
              />
            </div>
          </>
        }
      >
        {(_text, _isActive) => (
          <ToolBarButton
            disabled={disabled}
            isActive={false}
            text={t('table:kanban.toolbar.customizeCards')}
            textClassName="@2xl/toolbar:inline"
          >
            <Settings className="size-4 text-sm" />
          </ToolBarButton>
        )}
      </VisibleFields>
      <ViewFilter
        responsive
        filters={view?.filter || null}
        onChange={onFilterChange}
        contentHeader={
          view.enableShare && (
            <div className="mb-2 flex max-w-full items-center justify-start rounded-md border bg-muted px-3 py-2 text-xs text-muted-foreground dark:bg-white/5">
              <Share2 className="me-2 size-4 shrink-0" />
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
      <Sort responsive sorts={view?.sort || null} onChange={onSortChange}>
        {(text: string, isActive) => (
          <ToolBarButton
            disabled={disabled}
            isActive={isActive}
            text={text}
            className={cn(
              'max-w-[200px]',
              isActive &&
                'bg-orange-100 dark:bg-orange-600/30 hover:bg-orange-200 dark:hover:bg-orange-500/30'
            )}
            textClassName="@2xl/toolbar:inline"
          >
            <ArrowUpDown className="size-4 shrink-0 text-sm" />
          </ToolBarButton>
        )}
      </Sort>
    </ScrollableToolbarGroup>
  );
};
