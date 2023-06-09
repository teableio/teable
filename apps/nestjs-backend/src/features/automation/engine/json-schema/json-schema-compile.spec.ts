import type {
  ICreateRecordSchema,
  IMailSenderSchema,
  IUpdateRecordSchema,
  IWebhookSchema,
  IDecisionSchema,
  ITriggerRecordCreatedSchema,
} from '../../actions';
import ajv from './ajv';

describe('Ajv Compile Test', () => {
  describe('Validate `Action Meta`s', () => {
    const objectPathValue = {
      type: 'objectPathValue',
      object: {
        nodeId: 'string',
        nodeType: 'trigger',
      },
      path: {
        type: 'array',
        elements: [
          {
            type: 'const',
            value: 'string',
          },
        ],
      },
    };

    const template = {
      type: 'template',
      elements: [
        {
          type: 'const',
          value: 'abc',
        },
        objectPathValue,
      ],
    };

    const object = {
      type: 'object',
      properties: [
        {
          key: {
            type: 'const',
            value: 'key',
          },
          value: {
            type: 'const',
            value: 'value',
          },
        },
      ],
    };

    it('type=`null`, need to return true', async () => {
      const validate = ajv.compile({
        $ref: 'ActionMeta#/definitions/null',
      });

      expect(validate({ type: 'null' })).toBeTruthy();
      expect(validate({ type: 'null', value: '' })).toBeFalsy();
      expect(validate({ type: 'null1', value: '' })).toBeFalsy();
    });

    it('type=`const`, need to return true', async () => {
      const validate = ajv.compile({
        $ref: 'ActionMeta#/definitions/const',
      });

      expect(validate({ type: 'const', value: 'abc' })).toBeTruthy();
      expect(validate({ type: 'const', value: 1 })).toBeTruthy();
      expect(validate({ type: 'const', value: 1.1 })).toBeTruthy();
      expect(validate({ type: 'const', value: -1 })).toBeTruthy();
      expect(validate({ type: 'const', value: false })).toBeTruthy();
      expect(validate({ type: 'const', value: {} })).toBeFalsy();
      expect(validate({ type: 'const', value: [] })).toBeFalsy();
      expect(validate({ type: 'const1', value: '' })).toBeFalsy();
    });

    it('type=`objectPathValue`, need to return true', async () => {
      const validate = ajv.compile({
        $ref: 'ActionMeta#/definitions/objectPathValue',
      });

      expect(validate(objectPathValue)).toBeTruthy();
      expect(
        validate({
          ...objectPathValue,
          object: { ...objectPathValue.object, nodeType: '__system__' },
        })
      ).toBeTruthy();
      expect(
        validate({ ...objectPathValue, object: { ...objectPathValue.object, nodeType: 'action' } })
      ).toBeTruthy();
      expect(
        validate({ ...objectPathValue, object: { ...objectPathValue.object, nodeType: 'type' } })
      ).toBeFalsy();
      expect(
        validate({ ...objectPathValue, object: { ...objectPathValue.object, a: 'a' } })
      ).toBeFalsy();

      expect(
        validate({ ...objectPathValue, path: { ...objectPathValue.path, elements: [] } })
      ).toBeFalsy();
      expect(
        validate({
          ...objectPathValue,
          path: { ...objectPathValue.path, elements: [{ type: 'null' }] },
        })
      ).toBeFalsy();
    });

    it('type=`template`, need to return true', async () => {
      const validate = ajv.compile({
        $ref: 'ActionMeta#/definitions/template',
      });

      expect(validate(template)).toBeTruthy();
      expect(validate({ ...template, elements: [] })).toBeTruthy();
    });

    it('type=`object`, need to return true', async () => {
      const validate = ajv.compile({
        $ref: 'ActionMeta#/definitions/object',
      });

      const dynamicValue = (value: unknown) => {
        return {
          ...object,
          properties: [
            {
              ...object.properties[0],
              value,
            },
          ],
        };
      };

      expect(validate(object)).toBeTruthy();
      expect(validate(dynamicValue({ type: 'null' }))).toBeTruthy();
      expect(validate(dynamicValue(objectPathValue))).toBeTruthy();
      expect(validate(dynamicValue(template))).toBeTruthy();
      expect(validate(dynamicValue(object))).toBeTruthy();
      expect(validate(dynamicValue({ type: 'array', elements: [object] }))).toBeTruthy();

      expect(validate(dynamicValue({ type: 'null1' }))).toBeFalsy();
    });
  });

  describe('Validate `Webhook`', () => {
    const data = {
      url: {
        type: 'template',
        elements: [
          {
            type: 'const',
            value: 'https://google.com',
          },
        ],
      },
      method: {
        type: 'const',
        value: 'GET',
      },
      headers: {
        type: 'object',
        properties: [
          {
            key: {
              type: 'const',
              value: 'User-Agent',
            },
            value: {
              type: 'template',
              elements: [
                {
                  type: 'const',
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
            type: 'const',
            value: '{',
          },
          {
            type: 'const',
            value: '"name":"abc"',
          },
          {
            type: 'const',
            value: '}',
          },
        ],
      },
      responseParams: {
        type: 'object',
        properties: [
          {
            key: {
              type: 'const',
              value: 'customizeKey',
            },
            value: {
              type: 'template',
              elements: [
                {
                  type: 'const',
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

      expect(validate).toBeDefined();
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
                type: 'const',
                value: 'penganpingprivte@gmail.com',
              },
            ],
          },
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
            value: 'first row\n1 <br>br\nsss',
          },
        ],
      },
    };

    it('need to return true', async () => {
      const validate = ajv.getSchema<IMailSenderSchema>('MailSenderSchema')!;

      expect(validate).toBeDefined();
      expect(validate(data)).toBeTruthy();
      expect(validate({ ...data, subject: { type: 'const' } })).toBeFalsy();
    });
  });

  describe('Validate `CreateRecordSchema`', () => {
    const data = {
      tableId: {
        type: 'const',
        value: 'tblwEp45tdvwTxiUl',
      },
      fields: {
        type: 'object',
        properties: [
          {
            key: {
              type: 'const',
              value: 'fldELAd4ssqjk5CBg',
            },
            value: {
              type: 'template',
              elements: [
                {
                  type: 'const',
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
                        type: 'const',
                        value: 'cellValuesByFieldId',
                      },
                      {
                        type: 'const',
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

      expect(validate).toBeDefined();
      expect(validate(data)).toBeTruthy();
      expect(validate({ ...data, table: 'table' })).toBeFalsy();
    });
  });

  describe('Validate `Decision`', () => {
    const data = {
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
                                  type: 'array',
                                  elements: [
                                    {
                                      type: 'const',
                                      value: 'selSqHdcsGCCDOa0y',
                                    },
                                    {
                                      type: 'const',
                                      value: 'selukpRoWvJ5bMu6C',
                                    },
                                  ],
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
                                  value: 'select',
                                },
                              },
                              {
                                key: {
                                  type: 'const',
                                  value: 'operator',
                                },
                                value: {
                                  type: 'const',
                                  value: 'isNoneOf',
                                },
                              },
                              {
                                key: {
                                  type: 'const',
                                  value: 'operatorOptions',
                                },
                                value: {
                                  type: 'null',
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
                                      value: 'trigger.wtrdS3OIXzjyRyvnP',
                                    },
                                    {
                                      type: 'const',
                                      value: 'data',
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
    };

    it('need to return true', async () => {
      const validate = ajv.getSchema<IDecisionSchema>('DecisionSchema')!;

      expect(validate).toBeDefined();
      expect(validate(data)).toBeTruthy();
    });
  });

  describe('Validate `UpdateRecordSchema`', () => {
    const data = {
      tableId: {
        type: 'const',
        value: 'tblwEp45tdvwTxiUl',
      },
      recordId: {
        type: 'template',
        elements: [
          {
            type: 'const',
            value: 'recELAd4ssqjk5CBg',
          },
        ],
      },
      fields: {
        type: 'object',
        properties: [
          {
            key: {
              type: 'const',
              value: 'fldELAd4ssqjk5CBg',
            },
            value: {
              type: 'template',
              elements: [
                {
                  type: 'const',
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
                        type: 'const',
                        value: 'fields',
                      },
                      {
                        type: 'const',
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
      const validate = ajv.getSchema<IUpdateRecordSchema>('UpdateRecordSchema')!;

      expect(validate).toBeDefined();
      expect(validate(data)).toBeTruthy();
      expect(validate({ ...data, table: 'table' })).toBeFalsy();
    });
  });

  describe('Validate `Trigger Record Created`', () => {
    const data = {
      tableId: {
        type: 'const',
        value: 'tblwEp45tdvwTxiUl',
      },
    };

    it('need to return true', async () => {
      const validate = ajv.getSchema<ITriggerRecordCreatedSchema>('TriggerRecordCreatedSchema')!;

      expect(validate).toBeDefined();
      expect(validate(data)).toBeTruthy();
    });
  });
});
