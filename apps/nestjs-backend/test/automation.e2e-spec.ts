import type { INestApplication } from '@nestjs/common';
import {
  FieldType,
  generateWorkflowActionId,
  generateWorkflowDecisionId,
  generateWorkflowId,
  generateWorkflowTriggerId,
  identify,
  IdPrefix,
} from '@teable-group/core';
import request from 'supertest';
import { ActionTypeEnums } from 'src/features/automation/enums/action-type.enum';
import { TriggerTypeEnums } from 'src/features/automation/enums/trigger-type.enum';
import type { CreateWorkflowActionRo } from 'src/features/automation/model/create-workflow-action.ro';
import type { CreateWorkflowTriggerRo } from 'src/features/automation/model/create-workflow-trigger.ro';
import type { CreateWorkflowRo } from 'src/features/automation/model/create-workflow.ro';
import type { UpdateWorkflowActionRo } from 'src/features/automation/model/update-workflow-action.ro';
import type { UpdateWorkflowTriggerRo } from 'src/features/automation/model/update-workflow-trigger.ro';
import type { FieldVo } from 'src/features/field/model/field.vo';
import { initApp } from './init-app';

describe('AutomationController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await initApp();
  });

  const createTable = async (tableName = 'automation-table'): Promise<string> => {
    const result = await request(app.getHttpServer()).post('/api/table').send({
      name: tableName,
    });
    return result.body.data.id;
  };

  const createWorkflow = async () => {
    const workflowId = generateWorkflowId();
    const workflowRo: CreateWorkflowRo = {
      name: 'Automation 1',
    };
    await request(app.getHttpServer())
      .post(`/api/workflow/${workflowId}`)
      .send(workflowRo)
      .expect(201)
      .expect({ success: true });

    return workflowId;
  };

  const createWorkflowTrigger = async (
    workflowId: string,
    createRo: CreateWorkflowTriggerRo = {
      workflowId: workflowId,
      triggerType: TriggerTypeEnums.RecordCreated,
    }
  ) => {
    const triggerId = generateWorkflowTriggerId();
    await request(app.getHttpServer())
      .post(`/api/workflowTrigger/${triggerId}`)
      .send(createRo)
      .expect(201)
      .expect({ success: true });

    return triggerId;
  };

  const updateWorkflowTrigger = async (triggerId: string, updateRo: UpdateWorkflowTriggerRo) => {
    await request(app.getHttpServer())
      .put(`/api/workflowTrigger/${triggerId}/updateConfig`)
      .send(updateRo)
      .expect(200)
      .expect({ success: true });
  };

  const createWorkflowAction = async (workflowId: string, createRo: CreateWorkflowActionRo) => {
    let actionId = generateWorkflowActionId();

    let url1 = `/api/workflowAction/${actionId}`;

    if (createRo.actionType === ActionTypeEnums.Decision) {
      actionId = generateWorkflowDecisionId();

      url1 = `/api/workflowDecision/${actionId}`;
    }

    await request(app.getHttpServer())
      .post(url1)
      .send(createRo)
      .expect(201)
      .expect({ success: true });

    return actionId;
  };

  const updateWorkflowAction = async (actionId: string, updateRo: UpdateWorkflowActionRo) => {
    let url2 = `/api/workflowAction/${actionId}/updateConfig`;

    if (identify(actionId) === IdPrefix.WorkflowDecision) {
      url2 = `/api/workflowDecision/${actionId}/updateConfig`;
    }

    await request(app.getHttpServer())
      .put(url2)
      .send(updateRo)
      .expect(200)
      .expect({ success: true });
  };

  const deleteWorkflow = async (workflowId: string) => {
    await request(app.getHttpServer())
      .delete(`/api/workflow/${workflowId}/delete`)
      .expect(200)
      .expect({ success: true });
  };

  it('Simulate the creation of a `create table record` trigger without a logical group', async () => {
    const tableId = await createTable();
    const newTableId = await createTable('automation-table-1');
    const fieldsResult = await request(app.getHttpServer()).get(`/api/table/${newTableId}/field`);
    const fields: FieldVo[] = fieldsResult.body.data;
    const firstTextField = fields.find((field) => field.type === FieldType.SingleLineText)!;

    // Step.1
    const workflowId = await createWorkflow();

    // Step.2
    const triggerId = await createWorkflowTrigger(workflowId).then(async (id) => {
      await updateWorkflowTrigger(id, {
        inputExpressions: {
          tableId: {
            type: 'const',
            value: tableId,
          },
        },
      });
      return id;
    });

    // Step.3
    const actionCreateRo1: CreateWorkflowActionRo = {
      workflowId: workflowId,
      actionType: ActionTypeEnums.CreateRecord,
    };
    const actionId1 = await createWorkflowAction(workflowId, actionCreateRo1).then(async (id) => {
      const actionUpdateRo1: UpdateWorkflowActionRo = {
        description: 'actionId1 CreateRecord description',
        inputExpressions: {
          tableId: {
            type: 'const',
            value: `${newTableId}`,
          },
          fields: {
            type: 'object',
            properties: [
              {
                key: {
                  type: 'const',
                  value: firstTextField.id,
                },
                value: {
                  type: 'template',
                  elements: [
                    {
                      type: 'const',
                      value: 'firstTextField - ',
                    },
                    {
                      type: 'objectPathValue',
                      object: {
                        nodeId: `runEnv`,
                        nodeType: '__system__',
                      },
                      path: {
                        type: 'array',
                        elements: [
                          {
                            type: 'const',
                            value: 'executionTime',
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      };
      await updateWorkflowAction(id, actionUpdateRo1);

      return id;
    });

    // Step.4
    const actionCreateRo2: CreateWorkflowActionRo = {
      workflowId: workflowId,
      actionType: ActionTypeEnums.MailSender,
      parentNodeId: actionId1,
    };
    const actionId2 = await createWorkflowAction(workflowId, actionCreateRo2).then(async (id) => {
      const actionUpdateRo1: UpdateWorkflowActionRo = {
        description: 'actionId2 MailSender description',
        inputExpressions: {
          to: {
            type: 'array',
            elements: [
              {
                type: 'template',
                elements: [
                  {
                    type: 'const',
                    value: 'penganpingprivte@gmail.com',
                  },
                ],
              },
            ],
          },
          subject: {
            type: 'template',
            elements: [
              {
                type: 'const',
                value: 'A test email from `table`',
              },
            ],
          },
          message: {
            type: 'template',
            elements: [
              {
                type: 'const',
                value: '<h1>New Record By Trigger RecordId: <h1>',
              },
              {
                type: 'objectPathValue',
                object: {
                  nodeId: `${triggerId}`,
                  nodeType: 'trigger',
                },
                path: {
                  type: 'array',
                  elements: [
                    {
                      type: 'const',
                      value: 'record',
                    },
                    {
                      type: 'const',
                      value: 'id',
                    },
                  ],
                },
              },
              {
                type: 'const',
                value: '<br/>New Record: 【',
              },
              {
                type: 'objectPathValue',
                object: {
                  nodeId: `${actionId1}`,
                  nodeType: 'action',
                },
                path: {
                  type: 'array',
                  elements: [
                    {
                      type: 'const',
                      value: 'data',
                    },
                    {
                      type: 'const',
                      value: 'fields',
                    },
                    {
                      type: 'const',
                      value: `${firstTextField.id}`,
                    },
                  ],
                },
              },
            ],
          },
        },
      };
      await updateWorkflowAction(id, actionUpdateRo1);

      return id;
    });

    // Verify
    const result = await request(app.getHttpServer())
      .get(`/api/workflow/${workflowId}`)
      .expect(200);

    expect(result.body.data).toStrictEqual(
      expect.objectContaining({
        id: workflowId,
        deploymentStatus: 'undeployed',
        trigger: expect.objectContaining({ id: triggerId, inputExpressions: expect.any(Object) }),
        actions: expect.objectContaining({
          [actionId1]: expect.objectContaining({
            id: actionId1,
            inputExpressions: expect.any(Object),
          }),
          [actionId2]: expect.objectContaining({
            id: actionId2,
            inputExpressions: expect.any(Object),
          }),
        }),
      })
    );
  });

  it('Simulate the creation of a `create table record` trigger with a logical group', async () => {
    const tableId = await createTable();
    const fieldsResult = await request(app.getHttpServer()).get(`/api/table/${tableId}/field`);
    const fields: FieldVo[] = fieldsResult.body.data;
    const firstTextField = fields.find((field) => field.type === FieldType.SingleLineText)!;

    // Step.1
    const workflowId = await createWorkflow();

    // Step.2
    const triggerId = await createWorkflowTrigger(workflowId).then(async (id) => {
      await updateWorkflowTrigger(id, {
        inputExpressions: {
          tableId: {
            type: 'const',
            value: tableId,
          },
        },
      });
      return id;
    });

    // Step.3 (create logical groups)
    const actionCreateRo1: CreateWorkflowActionRo = {
      workflowId: workflowId,
      actionType: ActionTypeEnums.Decision,
    };
    const actionId1 = await createWorkflowAction(workflowId, actionCreateRo1).then(async (id) => {
      const actionUpdateRo1: UpdateWorkflowActionRo = {
        description: 'actionId1 Decision description',
        inputExpressions: {
          groups: {
            type: 'array',
            elements: [
              {
                type: 'object',
                properties: [
                  {
                    key: {
                      type: 'const',
                      value: 'hasCondition',
                    },
                    value: {
                      type: 'const',
                      value: true,
                    },
                  },
                  {
                    key: {
                      type: 'const',
                      value: 'entryNodeId',
                    },
                    value: {
                      type: 'null',
                    },
                  },
                  {
                    key: {
                      type: 'const',
                      value: 'condition',
                    },
                    value: {
                      type: 'object',
                      properties: [
                        {
                          key: {
                            type: 'const',
                            value: 'logical',
                          },
                          value: {
                            type: 'const',
                            value: 'and',
                          },
                        },
                        {
                          key: {
                            type: 'const',
                            value: 'conditions',
                          },
                          value: {
                            type: 'array',
                            elements: [
                              {
                                type: 'object',
                                properties: [
                                  {
                                    key: {
                                      type: 'const',
                                      value: 'right',
                                    },
                                    value: {
                                      type: 'const',
                                      value: '触发邮件',
                                    },
                                  },
                                  {
                                    key: {
                                      type: 'const',
                                      value: 'dataType',
                                    },
                                    value: {
                                      type: 'const',
                                      value: 'text',
                                    },
                                  },
                                  {
                                    key: {
                                      type: 'const',
                                      value: 'valueType',
                                    },
                                    value: {
                                      type: 'const',
                                      value: 'text',
                                    },
                                  },
                                  {
                                    key: {
                                      type: 'const',
                                      value: 'operator',
                                    },
                                    value: {
                                      type: 'const',
                                      value: 'contains',
                                    },
                                  },
                                  {
                                    key: {
                                      type: 'const',
                                      value: 'left',
                                    },
                                    value: {
                                      type: 'array',
                                      elements: [
                                        {
                                          type: 'const',
                                          value: `trigger.${triggerId}`,
                                        },
                                        {
                                          type: 'const',
                                          value: 'fields',
                                        },
                                        {
                                          type: 'const',
                                          value: `${firstTextField.id}`,
                                        },
                                      ],
                                    },
                                  },
                                ],
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        },
      };
      await updateWorkflowAction(id, actionUpdateRo1);

      return id;
    });

    // Step.4
    const actionCreateRo2: CreateWorkflowActionRo = {
      workflowId: workflowId,
      actionType: ActionTypeEnums.MailSender,
      parentNodeId: actionId1,
      parentDecisionArrayIndex: 0,
    };
    const actionId2 = await createWorkflowAction(workflowId, actionCreateRo2).then(async (id) => {
      const actionUpdateRo1: UpdateWorkflowActionRo = {
        description: 'actionId2 MailSender description',
        inputExpressions: {
          to: {
            type: 'array',
            elements: [
              {
                type: 'template',
                elements: [
                  {
                    type: 'const',
                    value: 'penganpingprivte@gmail.com',
                  },
                ],
              },
            ],
          },
          subject: {
            type: 'template',
            elements: [
              {
                type: 'const',
                value: 'A test email from `table`',
              },
            ],
          },
          message: {
            type: 'template',
            elements: [
              {
                type: 'const',
                value: '<h1>New Record By Trigger RecordId: <h1>',
              },
              {
                type: 'objectPathValue',
                object: {
                  nodeId: `${triggerId}`,
                  nodeType: 'trigger',
                },
                path: {
                  type: 'array',
                  elements: [
                    {
                      type: 'const',
                      value: 'record',
                    },
                    {
                      type: 'const',
                      value: 'id',
                    },
                  ],
                },
              },
              {
                type: 'const',
                value: '<br/>New Record: 【',
              },
              {
                type: 'objectPathValue',
                object: {
                  nodeId: `${actionId1}`,
                  nodeType: 'action',
                },
                path: {
                  type: 'array',
                  elements: [
                    {
                      type: 'const',
                      value: 'fields',
                    },
                    {
                      type: 'const',
                      value: `${firstTextField.id}`,
                    },
                  ],
                },
              },
            ],
          },
        },
      };
      await updateWorkflowAction(id, actionUpdateRo1);

      return id;
    });

    // Verify
    const result = await request(app.getHttpServer())
      .get(`/api/workflow/${workflowId}`)
      .expect(200);

    // clean data
    // await deleteWorkflow(workflowId);

    expect(result.body.data).toStrictEqual(
      expect.objectContaining({
        id: workflowId,
        actions: expect.objectContaining({
          [actionId1]: expect.objectContaining({
            id: actionId1,
            nextActionId: actionId2,
          }),
          [actionId2]: expect.objectContaining({
            id: actionId2,
            nextActionId: null,
          }),
        }),
      })
    );
  });

  it('Simulate the creation of `modify table record` triggers', async () => {
    const tableId = await createTable('Automation-RecordUpdated');

    const fieldsResult = await request(app.getHttpServer()).get(`/api/table/${tableId}/field`);
    const fields: FieldVo[] = fieldsResult.body.data;
    const firstTextField = fields.find((field) => field.type === FieldType.SingleLineText)!;
    const firstNumField = fields.find((field) => field.type === FieldType.Number)!;

    // Step.1
    const workflowId = await createWorkflow();

    // Step.2
    const triggerId = await createWorkflowTrigger(workflowId, {
      workflowId: workflowId,
      triggerType: TriggerTypeEnums.RecordUpdated,
    }).then(async (id) => {
      await updateWorkflowTrigger(id, {
        inputExpressions: {
          tableId: {
            type: 'const',
            value: tableId,
          },
          // viewId: null, optional
          watchFields: {
            type: 'array',
            elements: [
              {
                type: 'const',
                value: firstTextField.id,
              },
            ],
          },
        },
      });
      return id;
    });

    // Step.3
    const actionCreateRo1: CreateWorkflowActionRo = {
      workflowId: workflowId,
      actionType: ActionTypeEnums.UpdateRecord,
    };
    const actionId1 = await createWorkflowAction(workflowId, actionCreateRo1).then(async (id) => {
      const actionUpdateRo1: UpdateWorkflowActionRo = {
        description: 'actionId1 UpdateRecord description',
        inputExpressions: {
          tableId: {
            type: 'const',
            value: `${tableId}`,
          },
          recordId: {
            type: 'template',
            elements: [
              {
                type: 'objectPathValue',
                object: {
                  nodeId: triggerId,
                  nodeType: 'trigger',
                },
                path: {
                  type: 'array',
                  elements: [
                    {
                      type: 'const',
                      value: 'record',
                    },
                    {
                      type: 'const',
                      value: 'id',
                    },
                  ],
                },
              },
            ],
          },
          fields: {
            type: 'object',
            properties: [
              {
                key: {
                  type: 'const',
                  value: firstNumField.id,
                },
                value: {
                  type: 'template',
                  elements: [
                    {
                      type: 'objectPathValue',
                      object: {
                        nodeId: triggerId,
                        nodeType: 'trigger',
                      },
                      path: {
                        type: 'array',
                        elements: [
                          {
                            type: 'const',
                            value: 'record',
                          },
                          {
                            type: 'const',
                            value: 'fields',
                          },
                          {
                            type: 'const',
                            value: `${firstTextField.id}`,
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      };
      await updateWorkflowAction(id, actionUpdateRo1);

      return id;
    });

    // Step.4
    const actionCreateRo2: CreateWorkflowActionRo = {
      workflowId: workflowId,
      actionType: ActionTypeEnums.CreateRecord,
      parentNodeId: actionId1,
    };
    const actionId2 = await createWorkflowAction(workflowId, actionCreateRo2).then(async (id) => {
      const actionUpdateRo2: UpdateWorkflowActionRo = {
        description: 'actionId2 CreateRecord description',
        inputExpressions: {
          tableId: {
            type: 'const',
            value: `${tableId}`,
          },
          fields: {
            type: 'object',
            properties: [
              {
                key: {
                  type: 'const',
                  value: firstTextField.id,
                },
                value: {
                  type: 'template',
                  elements: [
                    {
                      type: 'const',
                      value: 'update data in the previous step [',
                    },
                    {
                      type: 'objectPathValue',
                      object: {
                        nodeId: triggerId,
                        nodeType: 'trigger',
                      },
                      path: {
                        type: 'array',
                        elements: [
                          {
                            type: 'const',
                            value: 'record',
                          },
                          {
                            type: 'const',
                            value: 'fields',
                          },
                          {
                            type: 'const',
                            value: `${firstTextField.id}`,
                          },
                        ],
                      },
                    },
                    {
                      type: 'const',
                      value: '] -  ',
                    },
                    {
                      type: 'objectPathValue',
                      object: {
                        nodeId: `runEnv`,
                        nodeType: '__system__',
                      },
                      path: {
                        type: 'array',
                        elements: [
                          {
                            type: 'const',
                            value: 'executionTime',
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      };
      await updateWorkflowAction(id, actionUpdateRo2);

      return id;
    });

    // Verify
    const result = await request(app.getHttpServer())
      .get(`/api/workflow/${workflowId}`)
      .expect(200);

    expect(result.body.data).toStrictEqual(
      expect.objectContaining({
        id: workflowId,
        deploymentStatus: 'undeployed',
        trigger: expect.objectContaining({ id: triggerId, inputExpressions: expect.any(Object) }),
        actions: expect.objectContaining({
          [actionId1]: expect.objectContaining({
            id: actionId1,
            inputExpressions: expect.any(Object),
          }),
        }),
      })
    );
  });
});
