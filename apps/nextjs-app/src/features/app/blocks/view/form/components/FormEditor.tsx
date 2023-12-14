import type { DragEndEvent, DragOverEvent, DragStartEvent, DropAnimation } from '@dnd-kit/core';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  View,
  useView,
  useFieldStaticGetter,
  useFields,
  useIsHydrated,
  useGridColumnOrder,
  useTableId,
} from '@teable-group/sdk';
import type { IFieldInstance } from '@teable-group/sdk/model';
import { useMemo, useState } from 'react';
import { FieldSetting } from '../../grid/components';
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
  const view = useView();
  const tableId = useTableId();
  const activeViewId = view?.id;
  const isHydrated = useIsHydrated();
  const visibleFields = useFields();
  const allFields = useFields({ withHidden: true });
  const { onColumnOrdered } = useGridColumnOrder();
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
    const { fromSidebar, field } = activeData;
    const { index, isContainer } = overData;

    if (fromSidebar && (index != null || isContainer)) {
      setAdditionalFieldData({ field, index: index ?? 0 });
    }
  };

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const onDragEnd = async (event: DragEndEvent) => {
    const { over } = event;
    const overData = over?.data?.current || {};
    const { index: targetIndex, isContainer } = overData;

    onClean();

    if (activeSidebarField && (targetIndex != null || isContainer)) {
      const sourceDragId = activeSidebarField.id;
      if (activeViewId && tableId) {
        const sourceIndex = allFields.findIndex((f) => f.id === sourceDragId);
        const draggingField = allFields[sourceIndex];
        await View.setViewColumnMeta(tableId, activeViewId, [
          {
            fieldId: draggingField.id,
            columnMeta: {
              hidden: false,
            },
          },
        ]);

        const finalIndex = targetIndex ?? 0;
        if (sourceIndex === finalIndex) return;
        const newOrders = reorder(1, finalIndex, visibleFields.length, (index) => {
          const fieldId = visibleFields[index].id;
          return view?.columnMeta[fieldId].order;
        });
        await View.setViewColumnMeta(tableId, activeViewId, [
          {
            fieldId: draggingField.id,
            columnMeta: {
              order: newOrders[0],
            },
          },
        ]);
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
