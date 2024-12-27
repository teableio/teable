/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import { useDroppable } from '@dnd-kit/core';
import type { FieldType } from '@teable/core';
import { DraggableHandle, Plus } from '@teable/icons';
import { useView } from '@teable/sdk';
import type { IFieldStatic } from '@teable/sdk/hooks';
import { useFieldStaticGetter, useFields, useIsHydrated } from '@teable/sdk/hooks';
import type { FormView, IFieldInstance } from '@teable/sdk/model';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
import { useMemo } from 'react';
import { FORM_SIDEBAR_DROPPABLE_ID } from '@/features/app/blocks/view/form/constant';
import { FieldOperator } from '@/features/app/components/field-setting';
import { tableConfig } from '@/features/i18n/table.config';
import { useFieldSettingStore } from '../../field/useFieldSettingStore';
import { DraggableItem } from './Drag';

interface IDragItemProps {
  field: IFieldInstance;
  disabled?: boolean;
  onClick?: () => void;
  getFieldStatic: (type: FieldType, isLookup: boolean | undefined) => IFieldStatic;
}

export const DragItem: FC<IDragItemProps> = (props) => {
  const { field, disabled, onClick, getFieldStatic } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { type, name, isLookup } = field;
  const Icon = getFieldStatic(type, isLookup).Icon;
  const content = (
    <div
      className={cn(
        'mb-[6px] flex items-center justify-between rounded-md bg-slate-100 p-2 dark:bg-slate-800',
        disabled && 'cursor-not-allowed text-gray-400'
      )}
      onClick={() => !disabled && onClick?.()}
    >
      <div className="flex items-center overflow-hidden">
        <Icon className="ml-1 mr-2 shrink-0" />
        <span className="truncate text-sm">{name}</span>
      </div>
      {!disabled && <DraggableHandle className="ml-1 shrink-0" />}
    </div>
  );

  return (
    <>
      {disabled ? (
        <TooltipProvider>
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>{content}</TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {t('table:form.unableAddFieldTip')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        content
      )}
    </>
  );
};

interface IFormSidebarProps {
  sidebarAdditionalFieldId: string | null;
}

export const FormSidebar: FC<IFormSidebarProps> = (props) => {
  const { sidebarAdditionalFieldId } = props;
  const isHydrated = useIsHydrated();
  const view = useView() as FormView | undefined;
  const activeViewId = view?.id;
  const allFields = useFields({ withHidden: true, withDenied: true });
  const getFieldStatic = useFieldStaticGetter();
  const { openSetting } = useFieldSettingStore();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { setNodeRef } = useDroppable({ id: FORM_SIDEBAR_DROPPABLE_ID });

  const { hiddenFields, visibleFields, unavailableFields } = useMemo(() => {
    if (!activeViewId) {
      return {
        hiddenFields: [],
        visibleFields: [],
        unavailableFields: [],
      };
    }
    const hiddenFields: IFieldInstance[] = [];
    const visibleFields: IFieldInstance[] = [];
    const unavailableFields: IFieldInstance[] = [];
    allFields.forEach((field) => {
      const { isComputed, isLookup, id } = field;
      if (isComputed || isLookup) {
        return unavailableFields.push(field);
      }
      if (view.columnMeta?.[id]?.visible) {
        if (sidebarAdditionalFieldId && sidebarAdditionalFieldId === id) {
          hiddenFields.push(field);
        }
        return visibleFields.push(field);
      }
      hiddenFields.push(field);
    });
    return {
      hiddenFields,
      visibleFields,
      unavailableFields,
    };
  }, [activeViewId, allFields, view?.columnMeta, sidebarAdditionalFieldId]);

  const onFieldShown = (field: IFieldInstance) => {
    view &&
      view.updateColumnMeta([
        {
          fieldId: field.id,
          columnMeta: {
            visible: true,
          },
        },
      ]);
  };

  const onFieldsVisibleChange = (fields: IFieldInstance[], visible: boolean) => {
    view &&
      view.updateColumnMeta(
        fields.map((field) => ({ fieldId: field.id, columnMeta: { visible } }))
      );
  };

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r py-3">
      <div className="mb-2 flex justify-between px-4">
        <h2 className="text-lg">{t('table:form.fieldsManagement')}</h2>
        <div>
          <Button
            variant={'ghost'}
            size={'xs'}
            className="font-normal"
            disabled={!hiddenFields.length}
            onClick={() => onFieldsVisibleChange(hiddenFields, true)}
          >
            {t('table:form.addAll')}
          </Button>
          <Button
            variant={'ghost'}
            size={'xs'}
            className="font-normal"
            disabled={!visibleFields.length}
            onClick={() => onFieldsVisibleChange(visibleFields, false)}
          >
            {t('table:form.removeAll')}
          </Button>
        </div>
      </div>

      <div className="mb-4 h-auto grow overflow-y-auto px-4">
        {isHydrated && (
          <div ref={setNodeRef}>
            {hiddenFields.map((field) => {
              const { id } = field;
              return (
                <DraggableItem
                  key={'sidebar_' + id}
                  id={id}
                  field={field}
                  draggingClassName={'opacity-50'}
                >
                  <DragItem
                    field={field}
                    onClick={() => onFieldShown(field)}
                    getFieldStatic={getFieldStatic}
                  />
                </DraggableItem>
              );
            })}
            {unavailableFields.map((field) => {
              const { id } = field;
              return (
                <DragItem
                  key={id}
                  disabled
                  field={field}
                  onClick={() => onFieldShown(field)}
                  getFieldStatic={getFieldStatic}
                />
              );
            })}
            <div className="flex h-16 w-full items-center justify-center rounded border-2 border-dashed text-[13px] text-slate-400 dark:text-slate-600">
              {t('table:form.hideFieldTip')}
            </div>
          </div>
        )}
      </div>

      <div className="w-full px-4">
        <Button
          variant={'outline'}
          className="w-full"
          onClick={() => openSetting({ operator: FieldOperator.Add })}
        >
          <Plus fontSize={16} />
          {t('table:field.editor.addField')}
        </Button>
      </div>
    </div>
  );
};
