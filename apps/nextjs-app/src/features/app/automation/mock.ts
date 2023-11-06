import type { IWorkflowSection } from '@teable-group/core';

// TODO refactor type
export const menuData = [
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
