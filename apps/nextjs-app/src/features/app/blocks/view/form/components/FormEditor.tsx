import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DropAnimation,
  UniqueIdentifier,
} from '@dnd-kit/core';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  useView,
  useFieldStaticGetter,
  useFields,
  useIsHydrated,
  swapReorder,
  reorder,
} from '@teable/sdk';
import type { IFieldInstance } from '@teable/sdk/model';
import { useEffect, useMemo, useState } from 'react';
import { FieldSetting } from '../../grid/components';
import { FORM_SIDEBAR_DROPPABLE_ID } from '../constant';
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
  const isHydrated = useIsHydrated();
  const visibleFields = useFields();
  const allFields = useFields({ withHidden: true, withDenied: true });
  const getFieldStatic = useFieldStaticGetter();
  const [innerVisibleFields, setInnerVisibleFields] = useState([...visibleFields]);
  const [activeField, setActiveField] = useState<IFieldInstance | null>(null);
  const [activeSidebarField, setActiveSidebarField] = useState<IFieldInstance | null>(null);
  const [sidebarAdditionalFieldId, setSidebarAdditionalFieldId] = useState<string | null>(null);
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

  useEffect(() => {
    setInnerVisibleFields(visibleFields);
  }, [visibleFields]);

  const renderFields = useMemo(() => {
    const fields = [
      ...innerVisibleFields.filter(({ isComputed, isLookup }) => !isComputed && !isLookup),
    ];
    if (additionalFieldData) {
      const { field, index } = additionalFieldData;
      fields.splice(index, 0, field);
    }
    return fields;
  }, [additionalFieldData, innerVisibleFields]);

  const onClean = () => {
    setActiveField(null);
    setActiveSidebarField(null);
    setAdditionalFieldData(null);
    setSidebarAdditionalFieldId(null);
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
    const overId: UniqueIdentifier | undefined = over?.id;
    const { fromSidebar, field } = activeData;
    const { index, isContainer } = overData;

    if (fromSidebar && (index != null || isContainer) && !sidebarAdditionalFieldId) {
      setAdditionalFieldData({ field, index: index ?? 0 });
    }

    if (activeField && overId === FORM_SIDEBAR_DROPPABLE_ID && !additionalFieldData) {
      const sourceDragId = activeField.id;
      setSidebarAdditionalFieldId(sourceDragId);
    }
  };

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const onDragEnd = async (event: DragEndEvent) => {
    const { over } = event;
    const overId: UniqueIdentifier | undefined = over?.id;
    const overData = over?.data?.current || {};

    const { index: targetIndex, isContainer } = overData;

    if (!view) {
      return;
    }

    onClean();

    if (activeSidebarField && (targetIndex != null || isContainer)) {
      const newFields = [...innerVisibleFields];
      const sourceDragId = activeSidebarField.id;
      const sourceIndex = allFields.findIndex((f) => f.id === sourceDragId);
      const draggingField = allFields[sourceIndex];

      if (draggingField == null) return;

      newFields.splice(targetIndex, 0, draggingField);
      setInnerVisibleFields(newFields);

      await view.updateColumnMeta([
        {
          fieldId: draggingField.id,
          columnMeta: {
            visible: true,
          },
        },
      ]);

      if (!visibleFields.length) return;

      const finalIndex = targetIndex ?? 0;
      const newOrders = reorder(1, finalIndex, visibleFields.length, (index) => {
        const fieldId = visibleFields[index].id;
        return view?.columnMeta[fieldId].order;
      });
      await view.updateColumnMeta([
        {
          fieldId: draggingField.id,
          columnMeta: {
            order: newOrders[0],
          },
        },
      ]);
    }

    if (activeField && targetIndex != null) {
      const newFields = [...innerVisibleFields];
      const sourceDragId = activeField.id;
      const sourceIndex = visibleFields.findIndex((f) => f.id === sourceDragId);

      if (sourceIndex === targetIndex) return;

      const [moveField] = newFields.splice(sourceIndex, 1);
      const newOrders = swapReorder(
        1,
        sourceIndex,
        targetIndex ?? 0,
        visibleFields.length,
        (index: number) => {
          const fieldId = visibleFields[index].id;
          return view?.columnMeta[fieldId].order;
        }
      );

      newFields.splice(targetIndex, 0, moveField);

      setInnerVisibleFields(newFields);

      await view?.updateColumnMeta([
        {
          fieldId: sourceDragId,
          columnMeta: {
            order: newOrders[0],
          },
        },
      ]);
    }

    if (activeField && overId === FORM_SIDEBAR_DROPPABLE_ID) {
      const sourceDragId = activeField.id;
      await view?.updateColumnMeta([
        {
          fieldId: sourceDragId,
          columnMeta: {
            visible: false,
          },
        },
      ]);
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
          <FormSidebar sidebarAdditionalFieldId={sidebarAdditionalFieldId} />
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
