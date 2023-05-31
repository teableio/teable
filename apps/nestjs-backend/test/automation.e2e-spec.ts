import type { INestApplication } from '@nestjs/common';
import {
  FieldType,
  generateWorkflowActionId,
  generateWorkflowDecisionId,
  generateWorkflowId,
  generateWorkflowTriggerId,
} from '@teable-group/core';
import request from 'supertest';
import { ActionTypeEnums } from 'src/features/automation/enums/action-type.enum';
import { TriggerTypeEnums } from 'src/features/automation/enums/trigger-type.enum';
import type { CreateWorkflowActionRo } from 'src/features/automation/model/create-workflow-action.ro';
import type { CreateWorkflowTriggerRo } from 'src/features/automation/model/create-workflow-trigger.ro';
import type { CreateWorkflowRo } from 'src/features/automation/model/create-workflow.ro';
import type { FieldVo } from 'src/features/field/model/field.vo';
import { initApp } from './init-app';

describe('AutomationController (e2e)', () => {
  let app: INestApplication;
  let tableId = '';

  beforeAll(async () => {
    app = await initApp();

    if (tableId === '') {
      tableId = await createTable();
    }
  });

  const createTable = async (): Promise<string> => {
    const result = await request(app.getHttpServer()).post('/api/table').send({
      name: 'table1-automation-add',
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
    triggerRo: CreateWorkflowTriggerRo = {
      workflowId: workflowId,
      triggerType: TriggerTypeEnums.RecordCreated,
      inputExpressions: { tableId: tableId },
    }
  ) => {
    const triggerId = generateWorkflowTriggerId();
    await request(app.getHttpServer())
      .post(`/api/workflowTrigger/${triggerId}`)
      .send(triggerRo)
      .expect(201)
      .expect({ success: true });

    await request(app.getHttpServer())
      .put(`/api/workflowTrigger/${triggerId}/updateConfig`)
      .send(triggerRo)
      .expect(200)
      .expect({ success: true });

    return triggerId;
  };

  const createWorkflowAction = async (workflowId: string, actionRo: CreateWorkflowActionRo) => {
    let actionId = generateWorkflowActionId();

    if (actionRo.actionType === ActionTypeEnums.Decision) {
      actionId = generateWorkflowDecisionId();
    }

    await request(app.getHttpServer())
      .post(`/api/workflowAction/${actionId}`)
      .send(actionRo)
      .expect(201)
      .expect({ success: true });

    await request(app.getHttpServer())
      .put(`/api/workflowAction/${actionId}/updateConfig`)
      .send(actionRo)
      .expect(200)
      .expect({ success: true });

    return actionId;
  };

  const deleteWorkflow = async (workflowId: string) => {
    await request(app.getHttpServer())
      .delete(`/api/workflow/${workflowId}/delete`)
      .expect(200)
      .expect({ success: true });
  };

  it('should create a full automation', async () => {
    // Step.1
    const workflowId = await createWorkflow();

    // Step.2
    const triggerId = await createWorkflowTrigger(workflowId);

    // Step.3
    const newTableId = await createTable();
    const fieldsResult = await request(app.getHttpServer()).get(`/api/table/${newTableId}/field`);
    const fields: FieldVo[] = fieldsResult.body.data;
    const firstTextField = fields.find((field) => field.type === FieldType.SingleLineText)!;
    const action1Ro: CreateWorkflowActionRo = {
      workflowId: workflowId,
      actionType: ActionTypeEnums.CreateRecord,
      description: 'description',
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
      // nextNodeId: null,
      // parentNodeId: null,
    };
    const action1Id = await createWorkflowAction(workflowId, action1Ro);

    // Step.4
    const action2Ro: CreateWorkflowActionRo = {
      workflowId: workflowId,
      actionType: ActionTypeEnums.MailSender,
      description: 'description',
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
                nodeId: `${action1Id}`,
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
      parentNodeId: action1Id,
      // nextNodeId: null,
    };
    const action2Id = await createWorkflowAction(workflowId, action2Ro);

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
          [action1Id]: expect.objectContaining({
            id: action1Id,
            inputExpressions: expect.any(Object),
          }),
          [action2Id]: expect.objectContaining({
            id: action2Id,
            inputExpressions: expect.any(Object),
          }),
        }),
      })
    );
  });

  it('create automated workflows with logical groups', async () => {
    const tableId = await createTable();

    // Step.1
    const workflowId = await createWorkflow();

    // Step.2
    const triggerId = await createWorkflowTrigger(workflowId);

    // Step.3 (create logical groups)
    const fieldsResult = await request(app.getHttpServer()).get(`/api/table/${tableId}/field`);
    const fields: FieldVo[] = fieldsResult.body.data;
    const firstTextField = fields.find((field) => field.type === FieldType.SingleLineText)!;
    const action1Ro: CreateWorkflowActionRo = {
      workflowId: workflowId,
      actionType: ActionTypeEnums.Decision,
      description: 'Decision Description',
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
                          value: 'conjunction',
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
    const action1Id = await createWorkflowAction(workflowId, action1Ro);

    // Step.4
    const action2Ro: CreateWorkflowActionRo = {
      workflowId: workflowId,
      actionType: ActionTypeEnums.MailSender,
      description: 'description',
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
                nodeId: `${action1Id}`,
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
      parentNodeId: action1Id,
      parentDecisionArrayIndex: 0,
      // nextNodeId: null,
    };
    const action2Id = await createWorkflowAction(workflowId, action2Ro);

    // Verify
    const result = await request(app.getHttpServer())
      .get(`/api/workflow/${workflowId}`)
      .expect(200);

    // clean data
    await deleteWorkflow(workflowId);

    expect(result.body.data).toStrictEqual(
      expect.objectContaining({
        id: workflowId,
        actions: expect.objectContaining({
          [action1Id]: expect.objectContaining({
            id: action1Id,
            nextActionId: action2Id,
          }),
          [action2Id]: expect.objectContaining({
            id: action2Id,
            nextActionId: null,
          }),
        }),
      })
    );
  });
});
