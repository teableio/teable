import type { ICreateRecordSchema, IMailSenderSchema, IWebhookSchema } from '../../actions';
import ajv from '../../engine/ajv';

describe('Ajv Compile Test', () => {
  describe('Validate `Webhook`', () => {
    const data = {
      url: {
        type: 'template',
        elements: [
          {
            type: 'text',
            value: 'https://google.com',
          },
        ],
      },
      method: {
        type: 'text',
        value: 'GET',
      },
      headers: {
        type: 'object',
        properties: [
          {
            key: {
              type: 'text',
              value: 'User-Agent',
            },
            value: {
              type: 'template',
              elements: [
                {
                  type: 'text',
                  value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                },
              ],
            },
          },
        ],
      },
      body: {
        type: 'template',
        elements: [
          {
            type: 'text',
            value: '{',
          },
          {
            type: 'text',
            value: '"name":"abc"',
          },
          {
            type: 'text',
            value: '}',
          },
        ],
      },
      responseParams: {
        type: 'object',
        properties: [
          {
            key: {
              type: 'text',
              value: 'customizeKey',
            },
            value: {
              type: 'template',
              elements: [
                {
                  type: 'text',
                  value: 'data.data',
                },
              ],
            },
          },
        ],
      },
    };

    it('need to return true', async () => {
      const validate = ajv.getSchema<IWebhookSchema>('WebhookSchema')!;

      expect(validate).not.toBeUndefined();
      expect(validate(data)).toBeTruthy();
      expect(validate({ ...data, method: { value: 'GET_1' } })).toBeFalsy();
    });
  });

  describe('Validate `Mail Sender`', () => {
    const data = {
      to: {
        type: 'array',
        elements: [
          {
            type: 'template',
            elements: [
              {
                type: 'text',
                value: 'penganpingprivte@gmail.com',
              },
            ],
          },
          {
            type: 'template',
            elements: [
              {
                type: 'text',
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
            type: 'text',
            value: 'A test email from `table`',
          },
        ],
      },
      message: {
        type: 'template',
        elements: [
          {
            type: 'text',
            value: 'first row\n1 <br>br\nsss',
          },
        ],
      },
    };

    it('need to return true', async () => {
      const validate = ajv.getSchema<IMailSenderSchema>('MailSenderSchema')!;

      expect(validate).not.toBeUndefined();
      expect(validate(data)).toBeTruthy();
      expect(validate({ ...data, subject: { type: 'text' } })).toBeFalsy();
    });
  });

  describe('Validate `CreateRecordSchema`', () => {
    const data = {
      tableId: {
        type: 'text',
        value: 'tblwEp45tdvwTxiUl',
      },
      fields: {
        type: 'object',
        properties: [
          {
            key: {
              type: 'text',
              value: 'fldELAd4ssqjk5CBg',
            },
            value: {
              type: 'template',
              elements: [
                {
                  type: 'text',
                  value: 'fields.name',
                },
                {
                  type: 'objectPathValue',
                  object: {
                    nodeId: 'wtrdS3OIXzjyRyvnP',
                    nodeType: 'trigger',
                  },
                  path: {
                    type: 'array',
                    elements: [
                      {
                        type: 'text',
                        value: 'cellValuesByFieldId',
                      },
                      {
                        type: 'text',
                        value: 'fldXPZs9lFMvAIo2E',
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    };

    it('need to return true', async () => {
      const validate = ajv.getSchema<ICreateRecordSchema>('CreateRecordSchema')!;

      expect(validate).not.toBeUndefined();
      expect(validate(data)).toBeTruthy();
      expect(validate({ ...data, table: 'table' })).toBeFalsy();
    });
  });
});
