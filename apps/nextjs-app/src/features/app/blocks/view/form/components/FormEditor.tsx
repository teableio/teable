import type { DragEndEvent, DragOverEvent, DragStartEvent, DropAnimation } from '@dnd-kit/core';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useFieldStaticGetter, useFields, useIsHydrated, useViewId } from '@teable-group/sdk/hooks';
import type { IFieldInstance } from '@teable-group/sdk/model';
import { useMemo, useState } from 'react';
import { FieldSetting } from '../../grid/components';
import { useColumnOrder } from '../../grid/hooks';
import { reorder } from '../../grid/utils';
import { FormEditorMain } from './FormEditorMain';
import { FormFieldEditor } from './FormFieldEditor';
import { DragItem, FormSidebar } from './FormSidebar';

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0.5',
      },
    },
  }),
};

export const FormEditor = () => {
  const isHydrated = useIsHydrated();
  const activeViewId = useViewId();
  const visibleFields = useFields();
  const allFields = useFields({ withHidden: true });
  const { onColumnOrdered } = useColumnOrder();
  const getFieldStatic = useFieldStaticGetter();
  const [activeField, setActiveField] = useState<IFieldInstance | null>(null);
  const [activeSidebarField, setActiveSidebarField] = useState<IFieldInstance | null>(null);
  const [additionalFieldData, setAdditionalFieldData] = useState<{
    field: IFieldInstance;
    index: number;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const renderFields = useMemo(() => {
    const fields = [
      ...visibleFields.filter(({ isComputed, isLookup }) => !isComputed && !isLookup),
    ];
    if (additionalFieldData) {
      const { field, index } = additionalFieldData;
      fields.splice(index, 0, field);
    }
    return fields;
  }, [additionalFieldData, visibleFields]);

  const onClean = () => {
    setActiveField(null);
    setActiveSidebarField(null);
    setAdditionalFieldData(null);
  };

  const onDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const activeData = active.data?.current || {};

    if (activeData?.fromSidebar) {
      const { field } = activeData;
      setActiveSidebarField(field);
      return;
    }

    const { field } = activeData;
    setActiveField(field);
  };

  const onDragOver = (event: DragOverEvent) => {
    const { over, active } = event;
    const activeData = active.data?.current || {};
    const overData = over?.data?.current || {};

    if (activeData?.fromSidebar && overData?.index != null) {
      const index = overData.index;
      setAdditionalFieldData({ field: activeData.field, index });
    }
  };

  const onDragEnd = async (event: DragEndEvent) => {
    const { over } = event;
    const overData = over?.data?.current || {};
    const targetIndex = overData?.index;

    onClean();

    if (activeSidebarField && targetIndex != null) {
      const sourceDragId = activeSidebarField.id;
      if (activeViewId) {
        const sourceIndex = allFields.findIndex((f) => f.id === sourceDragId);
        const draggingField = allFields[sourceIndex];
        await draggingField.updateColumnHidden(activeViewId, false);

        if (sourceIndex === targetIndex) return;
        const newOrders = reorder(1, targetIndex, visibleFields.length, (index) => {
          return visibleFields[index].columnMeta[activeViewId].order;
        });
        draggingField.updateColumnOrder(activeViewId, newOrders[0]);
      }
    }

    if (activeField && targetIndex != null) {
      const sourceDragId = activeField.id;
      const sourceIndex = visibleFields.findIndex((f) => f.id === sourceDragId);
      if (sourceIndex === targetIndex) return;
      return onColumnOrdered(
        [sourceIndex],
        sourceIndex < targetIndex ? targetIndex + 1 : targetIndex
      );
    }
  };

  return (
    <>
      {isHydrated && (
        <DndContext
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          sensors={sensors}
          autoScroll
        >
          <FormSidebar />
          <FormEditorMain fields={renderFields} />
          <FieldSetting />
          <DragOverlay adjustScale={false} dropAnimation={dropAnimation}>
            {activeSidebarField ? (
              <DragItem field={activeSidebarField} getFieldStatic={getFieldStatic} />
            ) : null}
            {activeField ? (
              <div className="w-full overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                <FormFieldEditor field={activeField} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </>
  );
};
