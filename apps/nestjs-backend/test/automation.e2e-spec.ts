import type { INestApplication } from '@nestjs/common';
import type { IFieldVo } from '@teable/core';
import {
  FieldType,
  generateWorkflowActionId,
  generateWorkflowDecisionId,
  generateWorkflowId,
  generateWorkflowTriggerId,
  identify,
  IdPrefix,
} from '@teable/core';
import { axios } from '@teable/openapi';
import { ActionTypeEnums } from '../src/features/automation/enums/action-type.enum';
import { TriggerTypeEnums } from '../src/features/automation/enums/trigger-type.enum';
import type { CreateWorkflowActionRo } from '../src/features/automation/model/create-workflow-action.ro';
import type { CreateWorkflowTriggerRo } from '../src/features/automation/model/create-workflow-trigger.ro';
import type { CreateWorkflowRo } from '../src/features/automation/model/create-workflow.ro';
import type { UpdateWorkflowActionRo } from '../src/features/automation/model/update-workflow-action.ro';
import type { UpdateWorkflowTriggerRo } from '../src/features/automation/model/update-workflow-trigger.ro';
import { createTable, getFields, initApp } from './utils/init-app';

describe('AutomationController (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  const createWorkflow = async () => {
    const workflowId = generateWorkflowId();
    const workflowRo: CreateWorkflowRo = {
      name: 'Automation 1',
    };

    const axiosRes = await axios.post(`/api/workflow/${workflowId}`, workflowRo);

    expect(axiosRes.status).toBe(201);
    expect(axiosRes.data).toMatchObject({
      success: true,
    });
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
    const axiosRes = await axios.post(`/api/workflow-trigger/${triggerId}`, createRo);

    expect(axiosRes.status).toBe(201);
    expect(axiosRes.data).toMatchObject({
      success: true,
    });
    return triggerId;
  };

  const updateWorkflowTrigger = async (triggerId: string, updateRo: UpdateWorkflowTriggerRo) => {
    const axiosRes = await axios.put(`/api/workflow-trigger/${triggerId}/update-config`, updateRo);

    expect(axiosRes.status).toBe(200);
    expect(axiosRes.data).toMatchObject({
      success: true,
    });
  };

  const createWorkflowAction = async (workflowId: string, createRo: CreateWorkflowActionRo) => {
    let actionId = generateWorkflowActionId();

    let url1 = `/api/workflow-action/${actionId}`;

    if (createRo.actionType === ActionTypeEnums.Decision) {
      actionId = generateWorkflowDecisionId();

      url1 = `/api/workflow-decision/${actionId}`;
    }

    const axiosRes = await axios.post(url1, createRo);

    expect(axiosRes.status).toBe(201);
    expect(axiosRes.data).toMatchObject({
      success: true,
    });
    return actionId;
  };

  const updateWorkflowAction = async (actionId: string, updateRo: UpdateWorkflowActionRo) => {
    let url2 = `/api/workflow-action/${actionId}/update-config`;

    if (identify(actionId) === IdPrefix.WorkflowDecision) {
      url2 = `/api/workflow-decision/${actionId}/update-config`;
    }

    const axiosRes = await axios.put(url2, updateRo);

    expect(axiosRes.status).toBe(200);
    expect(axiosRes.data).toMatchObject({
      success: true,
    });
  };

  // const deleteWorkflow = async (workflowId: string) => {
  //   await axios
  //     .delete(`/api/workflow/${workflowId}/delete`)
  //     .expect(200)
  //     .expect({ success: true });
  // };

  const triggerByRecordUpdated = async (
    workflowId: string,
    tableId: string,
    fieldId: string,
    _viewId?: string
  ): Promise<string> => {
    return await createWorkflowTrigger(workflowId, {
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
                value: fieldId,
              },
            ],
          },
        },
      });
      return id;
    });
  };

  const decisionBySingleField = async (
    workflowId: string,
    left: string[],
    right: string,
    operator = 'equal'
  ) => {
    const actionCreateRo1: CreateWorkflowActionRo = {
      workflowId: workflowId,
      actionType: ActionTypeEnums.Decision,
    };
    return await createWorkflowAction(workflowId, actionCreateRo1).then(async (id) => {
      const actionUpdateRo1: UpdateWorkflowActionRo = {
        description: 'Decision description',
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
                                      value: right,
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
                                      value: operator,
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
                                          value: left[0],
                                        },
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
                                          value: left[1],
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
  };

  const actionByMailSender = async (
    workflowId: string,
    to: string,
    subject: string,
    message: Record<string, unknown>[],
    parentNodeId?: string
  ) => {
    const actionCreateRo2: CreateWorkflowActionRo = {
      workflowId: workflowId,
      actionType: ActionTypeEnums.MailSender,
      parentNodeId: parentNodeId,
      parentDecisionArrayIndex: 0,
    };
    return await createWorkflowAction(workflowId, actionCreateRo2).then(async (id) => {
      const actionUpdateRo1: UpdateWorkflowActionRo = {
        description: 'MailSender description',
        inputExpressions: {
          to: {
            type: 'array',
            elements: [
              {
                type: 'template',
                elements: [
                  {
                    type: 'const',
                    value: to,
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
                value: subject,
              },
            ],
          },
          message: {
            type: 'template',
            elements: message,
          },
        },
      };
      await updateWorkflowAction(id, actionUpdateRo1);

      return id;
    });
  };

  const actionByCreateRecord = async (
    workflowId: string,
    tableId: string,
    fieldId: string,
    fieldValue: Record<string, unknown>[],
    parentNodeId?: string
  ): Promise<string> => {
    const createRecordRo: CreateWorkflowActionRo = {
      workflowId: workflowId,
      actionType: ActionTypeEnums.CreateRecord,
      parentNodeId: parentNodeId,
    };
    return await createWorkflowAction(workflowId, createRecordRo).then(async (id) => {
      const actionUpdateRo2: UpdateWorkflowActionRo = {
        description: 'CreateRecord description',
        inputExpressions: {
          tableId: {
            type: 'const',
            value: tableId,
          },
          fields: {
            type: 'object',
            properties: [
              {
                key: {
                  type: 'const',
                  value: fieldId,
                },
                value: {
                  type: 'template',
                  elements: fieldValue,
                },
              },
            ],
          },
        },
      };
      await updateWorkflowAction(id, actionUpdateRo2);

      return id;
    });
  };

  const actionByUpdateRecord = async (
    workflowId: string,
    tableId: string,
    recordId: Record<string, unknown>[],
    fieldId: string,
    fieldValue: Record<string, unknown>[],
    parentNodeId?: string
  ): Promise<string> => {
    const createRecordRo: CreateWorkflowActionRo = {
      workflowId: workflowId,
      actionType: ActionTypeEnums.UpdateRecord,
      parentNodeId: parentNodeId,
    };
    return await createWorkflowAction(workflowId, createRecordRo).then(async (id) => {
      const actionUpdateRo2: UpdateWorkflowActionRo = {
        description: 'UpdateRecord description',
        inputExpressions: {
          tableId: {
            type: 'const',
            value: tableId,
          },
          recordId: {
            type: 'template',
            elements: recordId,
          },
          fields: {
            type: 'object',
            properties: [
              {
                key: {
                  type: 'const',
                  value: fieldId,
                },
                value: {
                  type: 'template',
                  elements: fieldValue,
                },
              },
            ],
          },
        },
      };
      await updateWorkflowAction(id, actionUpdateRo2);

      return id;
    });
  };

  it('Simulate the creation of a `create table record` trigger without a logical group', async () => {
    const tableId = (await createTable(baseId, { name: 'automation-table-1' })).id;

    const newTableId = (await createTable(baseId, { name: 'automation-table-2' })).id;

    const fields: IFieldVo[] = await getFields(newTableId);
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
    const fieldValue = [
      {
        type: 'const',
        value: 'a new text',
      },
    ];
    const actionId1 = await actionByCreateRecord(
      workflowId,
      tableId,
      firstTextField.id,
      fieldValue
    );

    // Step.4
    const message = [
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
    ];
    const actionId2 = await actionByMailSender(
      workflowId,
      'penganpingprivte@gmail.com',
      'A test email from `table` - ' + new Date(),
      message,
      actionId1
    );

    // Verify
    const result = await axios.get(`/api/workflow/${workflowId}`);

    expect(result.data).toStrictEqual(
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
    const tableId = (await createTable(baseId, { name: 'Automation-RecordUpdated-SendMail' })).id;
    const fields: IFieldVo[] = await getFields(tableId);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const firstTextField = fields.find((field) => field.type === FieldType.SingleLineText)!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const firstNumField = fields.find((field) => field.type === FieldType.Number)!;

    // Step.1
    const workflowId = await createWorkflow();

    // Step.2
    const triggerId = await triggerByRecordUpdated(workflowId, tableId, firstTextField.id);

    // Step.3 (create logical groups)
    const actionId1 = await decisionBySingleField(
      workflowId,
      [`trigger.${triggerId}`, `${firstTextField.id}`],
      '发送邮件'
    );

    // Step.4
    const message = [
      {
        type: 'const',
        value: '<h1>New Record By Trigger RecordId: </h1>',
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
        value: '<br/>Trigger Record: 【',
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
        value: ' - ',
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
              value: `${firstNumField.id}`,
            },
          ],
        },
      },
      {
        type: 'const',
        value: `】<br/>

The following is a <font color=orange> Markdown </font> grammatical sugar
# h1 Heading 8-)
## h2 Heading
### h3 Heading
#### h4 Heading
##### h5 Heading
###### h6 Heading
        `,
      },
    ];
    const actionId2 = await actionByMailSender(
      workflowId,
      'penganpingprivte@gmail.com',
      'A test email from `table` - ' + new Date(),
      message,
      actionId1
    );

    // Step.5
    const fieldValue = [
      {
        type: 'const',
        value: 'email sending result: ',
      },
      {
        type: 'objectPathValue',
        object: {
          nodeId: actionId2,
          nodeType: 'action',
        },
        path: {
          type: 'array',
          elements: [
            {
              type: 'const',
              value: 'senderResult',
            },
          ],
        },
      },
    ];
    const actionId3 = await actionByCreateRecord(
      workflowId,
      tableId,
      firstTextField.id,
      fieldValue,
      actionId2
    );

    // Verify
    const result = await axios.get(`/api/workflow/${workflowId}`);

    // clean data
    // await deleteWorkflow(workflowId);

    expect(result.data).toStrictEqual(
      expect.objectContaining({
        id: workflowId,
        actions: expect.objectContaining({
          [actionId1]: expect.objectContaining({
            id: actionId1,
            nextActionId: actionId2,
          }),
          [actionId2]: expect.objectContaining({
            id: actionId2,
            nextActionId: actionId3,
          }),
          [actionId3]: expect.objectContaining({
            id: actionId3,
            nextActionId: null,
          }),
        }),
      })
    );
  });

  it('Simulate the creation of `modify table record` triggers', async () => {
    const tableId = (await createTable(baseId, { name: 'Automation-RecordUpdated' })).id;

    const fields: IFieldVo[] = await getFields(tableId);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const firstTextField = fields.find((field) => field.type === FieldType.SingleLineText)!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const firstNumField = fields.find((field) => field.type === FieldType.Number)!;

    // Step.1
    const workflowId = await createWorkflow();

    // Step.2
    const triggerId = await triggerByRecordUpdated(workflowId, tableId, firstTextField.id);

    // Step.3
    const recordId = [
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
    ];
    const updateFieldValue = [
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
    ];
    const actionId1 = await actionByUpdateRecord(
      workflowId,
      tableId,
      recordId,
      firstNumField.id,
      updateFieldValue
    );

    // Step.4
    const createFieldValue = [
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
    ];
    const actionId2 = await actionByCreateRecord(
      workflowId,
      tableId,
      firstTextField.id,
      createFieldValue,
      actionId1
    );

    // Verify
    const result = await axios.get(`/api/workflow/${workflowId}`);

    expect(result.data).toStrictEqual(
      expect.objectContaining({
        id: workflowId,
        deploymentStatus: 'undeployed',
        trigger: expect.objectContaining({ id: triggerId, inputExpressions: expect.any(Object) }),
        actions: expect.objectContaining({
          [actionId1]: expect.objectContaining({
            id: actionId1,
            inputExpressions: expect.any(Object),
            nextActionId: actionId2,
          }),
          [actionId2]: expect.objectContaining({
            id: actionId2,
            inputExpressions: expect.any(Object),
          }),
        }),
      })
    );
  });
});
