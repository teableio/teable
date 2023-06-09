import Ajv from 'ajv';
import * as DecisionSchema from '../../actions/decision/decision.schema.json';
import * as MailSenderSchema from '../../actions/mail-sender/mail-sender.schema.json';
import * as CreateRecordSchema from '../../actions/records/create-record/create-record.schema.json';
import * as UpdateRecordSchema from '../../actions/records/update-record/update-record.schema.json';
import * as TriggerRecordCreatedSchema from '../../actions/triggers/record-created/record-created.schema.json';
import * as TriggerRecordUpdatedSchema from '../../actions/triggers/record-updated/record-updated.schema.json';
import * as WebhookSchema from '../../actions/webhook/webhook.schema.json';
import * as ActionMeta from './meta/action-meta.json';

const ajv = new Ajv({
  schemas: {
    ActionMeta: ActionMeta,
  },
  allErrors: true,
  code: { optimize: false, source: true },
});

ajv.addSchema(TriggerRecordCreatedSchema, 'TriggerRecordCreatedSchema');
ajv.addSchema(TriggerRecordUpdatedSchema, 'TriggerRecordUpdatedSchema');

ajv.addSchema(DecisionSchema, 'DecisionSchema');

ajv.addSchema(WebhookSchema, 'WebhookSchema');
ajv.addSchema(MailSenderSchema, 'MailSenderSchema');
ajv.addSchema(CreateRecordSchema, 'CreateRecordSchema');
ajv.addSchema(UpdateRecordSchema, 'UpdateRecordSchema');

export default ajv;
