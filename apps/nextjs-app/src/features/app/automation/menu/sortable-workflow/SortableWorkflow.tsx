import {
  DndContext,
  MouseSensor,
  useSensor,
  useSensors,
  rectIntersection,
  TouchSensor,
  DragOverlay,
  MeasuringStrategy,
  defaultDropAnimationSideEffects,
} from '@dnd-kit/core';
import type {
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  UniqueIdentifier,
  DropAnimation,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { IWorkflow, IWorkflowSection } from '@teable-group/core';
import { DeploymentStatus } from '@teable-group/core';
import { DraggableHandle, MoreHorizontal, ChevronRight } from '@teable-group/icons';
import { Button } from '@teable-group/ui-lib';
import { useLocalStorage } from '@uidotdev/usehooks';
import classNames from 'classnames';
import { cloneDeep } from 'lodash';
import { useRouter } from 'next/router';
import { useState } from 'react';

import { DroppableContainer } from './DroppableContainer';
import { WorkflowCard } from './WorkflowCard';

// TODO refactor type
const data = [
  {
    id: 'wscG4F4NKAbVvbeP9',
    name: 'Section 1',
    workflowOrder: [
      {
        id: 'wflCvAIbHaa5E42hp',
        applicationId: 'appiwng3MMPSrZvgg',
        name: 'Section 6 - 1',
        description: 'section6-1',
        version: 5,
        liveWorkflowDeploymentVersion: null,
        targetWorkflowDeploymentId: null,
        deploymentStatus: 'undeployed',
        deploymentError: null,
        origin: null,
        trigger: {
          id: 'wtrghvbmrQ42MpZoU',
          workflowTriggerTypeId: 'wttFORMSUBMITTED0',
        },
        graph: {
          id: 'wgrHJYgMes33p2xdO',
          entryWorkflowActionId: 'wacjN2NunfFsop7fL',
          alwaysGroupName: null,
          alwaysGroupDescription: null,
          actionsById: null,
        },
      },
      {
        id: 'wflCvAIbHaa5E42ha',
        applicationId: 'appiwng3MMPSrZvgg',
        name: 'Section 6 - 2',
        description: 'section6-2',
        version: 5,
        liveWorkflowDeploymentVersion: null,
        targetWorkflowDeploymentId: null,
        deploymentStatus: 'undeployed',
        deploymentError: null,
        origin: null,
        trigger: {
          id: 'wtrghvbmrQ42MpZoU',
          workflowTriggerTypeId: 'wttFORMSUBMITTED0',
        },
        graph: {
          id: 'wgrHJYgMes33p2xdO',
          entryWorkflowActionId: 'wacjN2NunfFsop7fL',
          alwaysGroupName: null,
          alwaysGroupDescription: null,
          actionsById: null,
        },
      },
    ],
  },
  {
    id: 'wscGPvbo4Nw0wpWy3',
    name: 'Section 2',
    workflowOrder: [
      {
        id: 'wflCvAIbHaa5E42hq',
        applicationId: 'appiwng3MMPSrZvgg',
        name: 'Section 4 - 1',
        description: null,
        version: 5,
        liveWorkflowDeploymentVersion: null,
        targetWorkflowDeploymentId: null,
        deploymentStatus: 'undeployed',
        deploymentError: null,
        origin: null,
        trigger: {
          id: 'wtrghvbmrQ42MpZoU',
          workflowTriggerTypeId: 'wttFORMSUBMITTED0',
        },
        graph: {
          id: 'wgrHJYgMes33p2xdO',
          entryWorkflowActionId: 'wacjN2NunfFsop7fL',
          alwaysGroupName: null,
          alwaysGroupDescription: null,
          actionsById: {
            wacjN2NunfFsop7fL: {
              id: 'wacjN2NunfFsop7fL',
              workflowActionTypeId: 'watCREATERECORD00',
              nextWorkflowActionId: 'wdehnB5lFwSUkwQG7',
            },
            wacqU1cywQ8IIv15s: {
              id: 'wacqU1cywQ8IIv15s',
              workflowActionTypeId: 'watBETUHIcuho4hit',
              nextWorkflowActionId: null,
            },
            wdehnB5lFwSUkwQG7: {
              id: 'wdehnB5lFwSUkwQG7',
              workflowDecisionTypeId: 'wdtNWAY0000000000',
              nextWorkflowNodeIds: ['wacqU1cywQ8IIv15s'],
            },
          },
        },
      },
    ],
  },
  {
    id: 'wscb6axXWLNge6I0N',
    name: 'Section 2',
    workflowOrder: [],
  },
] as unknown as IWorkflowSection;

const SortableWorkflow = () => {
  const [sections, setSection] = useState<IWorkflowSection>(data);
  const workflowOrders = sections.map((item) => item.workflowOrder || []);

  const sectionIds = sections.map((item) => item.id);
  const workflowOrdersIds = workflowOrders.map((order) => order.map(({ id }) => id));

  const [draggingId, setDraggingId] = useState<string | null>(null);

  const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: '0.5',
        },
      },
    }),
  };

  const router = useRouter();
  const {
    query: { automationId },
  } = router;
  const [collapseIds] = useLocalStorage<string[]>('workflowsListStates', []);

  const isActive = (id: string) => id === automationId;

  const handleDragEnd = (data: DragEndEvent) => {
    const { over, active } = data;
    if (!over) {
      return;
    }
    const overSection = getSectionId(over.id);
    const activeSection = getSectionId(active.id);

    // section drag
    if (sectionIds.includes(active?.id as string)) {
      const from = active?.data?.current?.sortable?.index;
      const to = over?.data?.current?.sortable?.index;
      const newList = [...sections];
      newList.splice(to, 0, ...newList.splice(from, 1));
      setSection(newList);
      setDraggingId(null);
      return;
    }

    // same section action item drag
    if (overSection === activeSection) {
      const newList = cloneDeep(sections);
      const index = newList.findIndex(({ id }) => id === overSection);
      const from = active?.data?.current?.sortable?.index;
      const to = over?.data?.current?.sortable?.index;
      newList[index].workflowOrder.splice(to, 0, newList[index].workflowOrder.splice(from, 1)[0]);
      setSection(newList);
      setDraggingId(null);
    }
  };

  const handleDragStart = (params: DragStartEvent) => {
    const {
      active: { id },
    } = params;
    setDraggingId(id as string);
  };

  const handleDragOver = (params: DragOverEvent) => {
    const { active, over } = params;
    const overId = over?.id;
    if (overId == null || sectionIds.includes(active.id as string)) {
      return;
    }

    const activeContainer = getSectionId(active.id);
    const overContainer = getSectionId(overId);

    // dragover in a undroppable area
    if (!overContainer || !activeContainer) {
      return;
    }

    // dragover to different section
    if (activeContainer !== overContainer) {
      const newList = cloneDeep(sections);
      const delIndex = newList.findIndex(({ id }) => id === activeContainer);
      const addIndex = newList.findIndex(({ id }) => id === overContainer);

      const from = active?.data?.current?.sortable?.index;
      const to = over?.data?.current?.sortable?.index;

      const del = newList[delIndex].workflowOrder.splice(from, 1)[0];
      newList[addIndex].workflowOrder.splice(to, 0, del);
      setSection(newList);
    }
  };

  const sensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor));

  /**
   * Get section id
   * @param id: string
   * @returns sectionId: string | null
   */
  const getSectionId = (itemId: UniqueIdentifier) => {
    const sectionIndex = sectionIds.findIndex((id) => id === itemId);
    const workflowIndex = workflowOrdersIds.findIndex((order) => order.includes(itemId as string));
    return sectionIds[sectionIndex] || sectionIds[workflowIndex] || null;
  };

  const renderSectionOverlay = (draggingId: string | null) => {
    const sectionInfo = sections.find(({ id }) => id === draggingId);
    const open = true;
    return draggingId ? (
      <Button
        variant="ghost"
        className={classNames('w-full flex justify-between cursor-grab px-3 items-center')}
      >
        <ChevronRight
          className={classNames('w-4 h-4 ease-in-out duration-300', open ? 'rotate-90' : '')}
        />
        <div className="flex flex-1 truncate text-left">{sectionInfo?.name}</div>
        <div className="flex items-center text-slate-400">
          <MoreHorizontal></MoreHorizontal>
          <DraggableHandle></DraggableHandle>
        </div>
      </Button>
    ) : null;
  };

  const renderWorkflowOverlay = (id: string | null) => {
    return id ? (
      <WorkflowCard
        deploymentStatus={DeploymentStatus.Deployed}
        id={id}
        className="rounded-sm border bg-slate-300"
      ></WorkflowCard>
    ) : null;
  };

  return (
    <div className="p-2">
      <DndContext
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        collisionDetection={rectIntersection}
        sensors={sensors}
        measuring={{
          droppable: {
            strategy: MeasuringStrategy.Always,
          },
        }}
      >
        <SortableContext items={sections} strategy={verticalListSortingStrategy}>
          {sections.map(({ name, id: sectionId, workflowOrder }) => (
            <DroppableContainer
              id={sectionId}
              name={name}
              workFlow={workflowOrder as unknown as IWorkflow}
              key={sectionId}
            >
              <SortableContext items={workflowOrder} strategy={verticalListSortingStrategy}>
                {workflowOrder.map(({ id, name, description }) => (
                  <WorkflowCard
                    id={id}
                    key={id}
                    deploymentStatus={DeploymentStatus.Deployed}
                    name={name}
                    description={description}
                    className={
                      collapseIds.includes(sectionId)
                        ? ''
                        : isActive(id) || draggingId === id
                        ? ''
                        : 'hidden'
                    }
                  ></WorkflowCard>
                ))}
              </SortableContext>
            </DroppableContainer>
          ))}
        </SortableContext>
        {draggingId && (
          <DragOverlay adjustScale={false} dropAnimation={dropAnimation}>
            {sectionIds.includes(draggingId)
              ? renderSectionOverlay(draggingId)
              : renderWorkflowOverlay(draggingId)}
          </DragOverlay>
        )}
      </DndContext>
    </div>
  );
};

export { SortableWorkflow };
