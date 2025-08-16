import type { IFieldVo } from '@teable/core';
import { ArrowUpDown, Filter as FilterIcon, Share2, Layers, Settings, Plus } from '@teable/icons';
import type { IFieldInstance, IFieldCreateOrSelectModalRef, KanbanView } from '@teable/sdk';
import {
  Sort,
  ViewFilter,
  useFields,
  useTableId,
  VisibleFields,
  generateLocalId,
  FieldCreateOrSelectModal,
  useTablePermission,
  CreateRecordModal,
} from '@teable/sdk';
import { useView } from '@teable/sdk/hooks/use-view';
import { Button, Label, Switch, cn } from '@teable/ui-lib/shadcn';
import { Trans, useTranslation } from 'next-i18next';
import { useEffect, useMemo, useRef } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { useToolbarChange } from '../../hooks/useToolbarChange';
import { useKanbanStackCollapsedStore } from '../../kanban/store';
import { ToolBarButton } from '../ToolBarButton';
import { CoverFieldSelect } from './CoverFieldSelect';
import { UndoRedoButtons } from './UndoRedoButtons';

export const KanbanViewOperators: React.FC<{ disabled?: boolean }> = (props) => {
  const { disabled } = props;
  const tableId = useTableId();
  const view = useView() as KanbanView | undefined;
  const allFields = useFields({ withHidden: true, withDenied: true });
  const permission = useTablePermission();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { onFilterChange, onSortChange } = useToolbarChange();
  const { setCollapsedStackMap } = useKanbanStackCollapsedStore();
  const dialogRef = useRef<IFieldCreateOrSelectModalRef>(null);

  const { stackFieldId, coverFieldId, isCoverFit, isEmptyStackHidden, isFieldNameHidden } =
    view?.options ?? {};

  const onFieldSelected = async (field: IFieldVo | IFieldInstance) => {
    if (field.id === stackFieldId) return;
    await view?.updateOption({ stackFieldId: field.id });
    const localId = generateLocalId(tableId, view?.id);
    setCollapsedStackMap(localId, []);
  };

  const onCoverFieldChange = (fieldId: string | null) => {
    view?.updateOption({ coverFieldId: fieldId });
  };

  const onCoverFitChange = (checked: boolean) => {
    view?.updateOption({ isCoverFit: checked });
  };

  const onFieldNameHiddenChange = (checked: boolean) => {
    view?.updateOption({ isFieldNameHidden: checked });
  };

  const onEmptyStackHiddenChange = (checked: boolean) => {
    view?.updateOption({ isEmptyStackHidden: checked });
  };

  useEffect(() => {
    if (stackFieldId == null && !disabled) {
      dialogRef.current?.onOpen();
    }
  }, [disabled, stackFieldId]);

  const stackFieldName = useMemo(() => {
    if (stackFieldId == null) return '';
    const groupField = allFields.find(({ id }) => id === stackFieldId);
    return groupField != null ? groupField.name : '';
  }, [allFields, stackFieldId]);

  if (!view) return null;

  return (
    <div className="flex items-center gap-2">
      <UndoRedoButtons />
      <div className="mx-2 h-4 w-px shrink-0 bg-slate-200"></div>
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
      <div className="mx-2 h-4 w-px shrink-0 bg-slate-200"></div>
      <FieldCreateOrSelectModal
        ref={dialogRef}
        title={t('table:kanban.toolbar.chooseStackingField')}
        description={t('table:kanban.toolbar.chooseStackingFieldDescription')}
        content={
          <div className="flex items-center gap-2">
            <Switch
              id="hide-empty-stack"
              checked={isEmptyStackHidden}
              onCheckedChange={(checked) => onEmptyStackHiddenChange(checked)}
            />
            <Label htmlFor="hide-empty-stack" className="text-sm">
              {t('table:kanban.toolbar.hideEmptyStack')}
            </Label>
          </div>
        }
        isCreatable={permission['field|create']}
        selectedFieldId={stackFieldId}
        onConfirm={onFieldSelected}
        getCreateBtnText={(fieldName) => (
          <Trans ns="table" i18nKey={'toolbar.createFieldButtonText'}>
            {fieldName}
          </Trans>
        )}
      >
        {(isActive) => (
          <ToolBarButton
            disabled={disabled}
            isActive={isActive}
            text={
              <Trans ns="table" i18nKey={'kanban.toolbar.stackedBy'}>
                {stackFieldName}
              </Trans>
            }
            textClassName="@2xl/toolbar:inline"
          >
            <Layers className="size-4 text-sm" />
          </ToolBarButton>
        )}
      </FieldCreateOrSelectModal>
      <VisibleFields
        footer={
          <>
            <CoverFieldSelect
              fieldId={coverFieldId}
              isCoverFit={isCoverFit}
              onSelectChange={onCoverFieldChange}
              onCheckedChange={onCoverFitChange}
              className="border-t"
            />
            <div className="flex items-center justify-between border-t p-2">
              <Label htmlFor="is-field-name-hidden" className="text-sm font-normal">
                {t('table:kanban.toolbar.hideFieldName')}
              </Label>
              <Switch
                id="is-field-name-hidden"
                className="h-4 w-7"
                classNameThumb="size-3 data-[state=checked]:translate-x-3"
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
      <Sort sorts={view?.sort || null} onChange={onSortChange}>
        {(text: string, isActive) => (
          <ToolBarButton
            disabled={disabled}
            isActive={isActive}
            text={text}
            className={cn(
              'max-w-xs',
              isActive &&
                'bg-orange-100 dark:bg-orange-600/30 hover:bg-orange-200 dark:hover:bg-orange-500/30'
            )}
            textClassName="@2xl/toolbar:inline"
          >
            <ArrowUpDown className="size-4 text-sm" />
          </ToolBarButton>
        )}
      </Sort>
    </div>
  );
};
