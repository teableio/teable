import Ajv from 'ajv';
import MailSenderSchema from '../../actions/mail-sender/mail-sender.schema.json';
import CreateRecordSchema from '../../actions/records/create-record/create-record.schema.json';
import WebhookSchema from '../../actions/webhook/webhook.schema.json';

const ajv = new Ajv({
  allErrors: true,
  code: { optimize: false, source: true },
  inlineRefs: false,
});

ajv.addSchema(WebhookSchema, 'WebhookSchema');
ajv.addSchema(MailSenderSchema, 'MailSenderSchema');
ajv.addSchema(CreateRecordSchema, 'CreateRecordSchema');

export default ajv;
