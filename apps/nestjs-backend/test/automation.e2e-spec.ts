import type { INestApplication } from '@nestjs/common';
import {
  generateWorkflowActionId,
  generateWorkflowId,
  generateWorkflowTriggerId,
} from '@teable-group/core';
import request from 'supertest';
import { ActionTypeEnums } from '../src/features/automation/enums/action-type.enum';
import { TriggerTypeEnums } from '../src/features/automation/enums/trigger-type.enum';
import type { CreateWorkflowActionRo } from '../src/features/automation/model/create-workflow-action.ro';
import type { CreateWorkflowTriggerRo } from '../src/features/automation/model/create-workflow-trigger.ro';
import type { CreateWorkflowRo } from '../src/features/automation/model/create-workflow.ro';
import { initApp } from './init-app';

describe('AutomationController (e2e)', () => {
  let app: INestApplication;
  let tableId = 'tbluD1SibWWuWFza6YL';

  beforeAll(async () => {
    app = await initApp();

    if (tableId === '') {
      const result = await request(app.getHttpServer()).post('/api/table').send({
        name: 'table1-automation-add',
      });
      tableId = result.body.data.id;
    }
  });

  it('should create a full automation', async () => {
    const workflowId = generateWorkflowId();
    const triggerId = generateWorkflowTriggerId();
    const actionId = generateWorkflowActionId();

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
    const actionRo: CreateWorkflowActionRo = {
      workflowId: workflowId,
      triggerId: triggerId,
      actionType: ActionTypeEnums.MailSender,
      description: 'description',
      inputExpressions: {
        to: ['penganpingprivte@gmail.com'],
        subject: ['New Record【Teable】', ' + ', '$.__system__.execution_time'],
        message: [
          '<h1>New Record<h1>',
          '<h3>',
          'Coming Teable: ',
          '$.__system__.execution_time',
          '<h3>',
        ],
      },
      nextNodeId: null,
      parentNodeId: null,
    };
    await request(app.getHttpServer())
      .post(`/api/workflowAction/${actionId}`)
      .send(actionRo)
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
});
