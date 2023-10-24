/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import type { FieldType } from '@teable-group/core';
import { DraggableHandle, Plus } from '@teable-group/icons';
import type { IFieldStatic } from '@teable-group/sdk/hooks';
import { useFieldStaticGetter, useFields, useIsHydrated, useViewId } from '@teable-group/sdk/hooks';
import type { IFieldInstance } from '@teable-group/sdk/model';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@teable-group/ui-lib/shadcn';
import type { FC } from 'react';
import { useMemo } from 'react';
import { FieldOperator } from '@/features/app/components/field-setting';
import { useGridViewStore } from '../../grid/store/gridView';
import { DraggableItem } from './Drag';

interface IDragItemProps {
  field: IFieldInstance;
  disabled?: boolean;
  onClick?: () => void;
  getFieldStatic: (type: FieldType, isLookup: boolean | undefined) => IFieldStatic;
}

export const DragItem: FC<IDragItemProps> = (props) => {
  const { field, disabled, onClick, getFieldStatic } = props;
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
              Unable to add this type field
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        content
      )}
    </>
  );
};

export const FormSidebar = () => {
  const isHydrated = useIsHydrated();
  const activeViewId = useViewId();
  const allFields = useFields({ withHidden: true });
  const getFieldStatic = useFieldStaticGetter();
  const { openSetting } = useGridViewStore();

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
      const { isComputed, isLookup, columnMeta } = field;
      if (isComputed || isLookup) {
        return unavailableFields.push(field);
      }
      if (!columnMeta?.[activeViewId]?.hidden) {
        return visibleFields.push(field);
      }
      hiddenFields.push(field);
    });
    return {
      hiddenFields,
      visibleFields,
      unavailableFields,
    };
  }, [allFields, activeViewId]);

  const onFieldShown = (field: IFieldInstance) => {
    activeViewId && field.updateColumnHidden(activeViewId, false);
  };

  const onFieldsHiddenChange = (fields: IFieldInstance[], hidden: boolean) => {
    if (!activeViewId) return;
    fields.forEach((field) => field.updateColumnHidden(activeViewId, hidden));
  };

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r py-3">
      <div className="mb-2 flex justify-between px-4">
        <h2 className="text-lg">Fields</h2>
        <div>
          <Button
            variant={'ghost'}
            size={'xs'}
            className="font-normal"
            disabled={!hiddenFields.length}
            onClick={() => onFieldsHiddenChange(hiddenFields, false)}
          >
            Add All
          </Button>
          <Button
            variant={'ghost'}
            size={'xs'}
            className="font-normal"
            disabled={!visibleFields.length}
            onClick={() => onFieldsHiddenChange(visibleFields, true)}
          >
            Remove All
          </Button>
        </div>
      </div>

      <div className="mb-4 h-auto grow overflow-y-auto px-4">
        {isHydrated && (
          <>
            {hiddenFields.map((field) => {
              const { id } = field;
              return (
                <DraggableItem key={id} id={id} field={field}>
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
          </>
        )}
        <div className="flex h-16 w-full items-center justify-center rounded border-2 border-dashed text-[13px] text-slate-400">
          Hide the field to here
        </div>
      </div>

      <div className="w-full px-4">
        <Button
          variant={'outline'}
          className="w-full"
          onClick={() => openSetting({ operator: FieldOperator.Add })}
        >
          <Plus fontSize={16} />
          Add Field
        </Button>
      </div>
    </div>
  );
};
