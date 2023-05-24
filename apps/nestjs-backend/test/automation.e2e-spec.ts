import type { INestApplication } from '@nestjs/common';
import {
  FieldType,
  generateWorkflowActionId,
  generateWorkflowId,
  generateWorkflowTriggerId,
} from '@teable-group/core';
import request from 'supertest';
import type { FieldVo } from 'src/features/field/model/field.vo';
import { ActionTypeEnums } from '../src/features/automation/enums/action-type.enum';
import { TriggerTypeEnums } from '../src/features/automation/enums/trigger-type.enum';
import type { CreateWorkflowActionRo } from '../src/features/automation/model/create-workflow-action.ro';
import type { CreateWorkflowTriggerRo } from '../src/features/automation/model/create-workflow-trigger.ro';
import type { CreateWorkflowRo } from '../src/features/automation/model/create-workflow.ro';
import { initApp } from './init-app';

describe('AutomationController (e2e)', () => {
  let app: INestApplication;
  let tableId = 'tblyPjTHHtKmGOw25if';

  beforeAll(async () => {
    app = await initApp();

    if (tableId === '') {
      tableId = await newTable();
    }
  });

  it('should create a full automation', async () => {
    const workflowId = generateWorkflowId();
    const triggerId = generateWorkflowTriggerId();
    const actionId = generateWorkflowActionId();
    const actionId1 = generateWorkflowActionId();

    // Step.1
    const workflowRo: CreateWorkflowRo = {
      name: 'Automation 1',
    };
    await request(app.getHttpServer())
      .post(`/api/workflow/${workflowId}`)
      .send(workflowRo)
      .expect(201)
      .expect({ success: true });

    // Step.2
    const triggerRo: CreateWorkflowTriggerRo = {
      workflowId: workflowId,
      triggerType: TriggerTypeEnums.RecordCreated,
      inputExpressions: { tableId: tableId },
    };
    await request(app.getHttpServer())
      .post(`/api/workflowTrigger/${triggerId}`)
      .send(triggerRo)
      .expect(201)
      .expect({ success: true });

    // Step.3
    const newTableId = await newTable();
    const fieldsResult = await request(app.getHttpServer()).get(`/api/table/${newTableId}/field`);
    const fields: FieldVo[] = fieldsResult.body.data;
    const firstTextField = fields.find((field) => field.type === FieldType.SingleLineText)!;
    const actionRo: CreateWorkflowActionRo = {
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
                    value: 'firstTextField - ' + new Date(),
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
    await request(app.getHttpServer())
      .post(`/api/workflowAction/${actionId}`)
      .send(actionRo)
      .expect(201)
      .expect({ success: true });

    // Step.4
    const actionRo1: CreateWorkflowActionRo = {
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
                nodeId: `${actionId}`,
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
      parentNodeId: actionId,
      // nextNodeId: null,
    };
    await request(app.getHttpServer())
      .post(`/api/workflowAction/${actionId1}`)
      .send(actionRo1)
      .expect(201)
      .expect({ success: true });

    // Verify
    const result = await request(app.getHttpServer())
      .get(`/api/workflow/${workflowId}`)
      .send(actionRo)
      .expect(200);

    expect(result.body.data).toMatchObject({
      id: workflowId,
      deploymentStatus: 'undeployed',
      trigger: {
        id: triggerId,
        inputExpressions: triggerRo.inputExpressions,
      },
      actions: {
        [actionId]: {
          id: actionId,
          inputExpressions: actionRo.inputExpressions,
        },
      },
    });
  });

  const newTable = async (): Promise<string> => {
    const result = await request(app.getHttpServer()).post('/api/table').send({
      name: 'table1-automation-add',
    });
    return result.body.data.id;
  };
});
