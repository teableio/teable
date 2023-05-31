import Ajv from 'ajv';
import * as DecisionSchema from '../../actions/decision/decision.schema.json';
import * as MailSenderSchema from '../../actions/mail-sender/mail-sender.schema.json';
import * as CreateRecordSchema from '../../actions/records/create-record/create-record.schema.json';
import * as WebhookSchema from '../../actions/webhook/webhook.schema.json';
import * as ActionMeta from './meta/action-meta.json';

const ajv = new Ajv({
  schemas: {
    ActionMeta: ActionMeta,
  },
  allErrors: true,
  code: { optimize: false, source: true },
});

ajv.addSchema(DecisionSchema, 'DecisionSchema');
ajv.addSchema(WebhookSchema, 'WebhookSchema');
ajv.addSchema(MailSenderSchema, 'MailSenderSchema');
ajv.addSchema(CreateRecordSchema, 'CreateRecordSchema');

export default ajv;
