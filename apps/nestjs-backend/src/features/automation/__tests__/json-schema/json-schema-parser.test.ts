import { Engine } from 'json-rules-engine';
import type { Almanac } from 'json-rules-engine';
import { JsonSchemaParser } from '../../engine/json-schema/parser';

describe('Json Schema Parser Test', () => {
  it('should parse a type text', async () => {
    const json = {
      tableId: {
        type: 'const',
        value: 'tblwEp45tdvwTxiUl',
      },
    };

    const jsonSchemaParser = new JsonSchemaParser(json);
    const result = await jsonSchemaParser.parse();

    expect(result).toBeDefined();
    expect(result).toStrictEqual(expect.objectContaining({ tableId: expect.any(String) }));
    expect(result).toStrictEqual({ tableId: 'tblwEp45tdvwTxiUl' });
  });

  it('should parse a type array', async () => {
    const json = {
      path: {
        type: 'array',
        elements: [
          {
            type: 'const',
            value: 'a',
          },
          {
            type: 'const',
            value: 'b',
          },
        ],
      },
    };

    const jsonSchemaParser = new JsonSchemaParser(json);
    const result = await jsonSchemaParser.parse();

    expect(result).toBeDefined();
    expect(result).toStrictEqual(
      expect.objectContaining({ path: expect.arrayContaining([expect.any(String)]) })
    );
    expect(result).toStrictEqual({ path: ['a', 'b'] });
  });

  it('should parse a type template', async () => {
    const json = {
      value: {
        type: 'template',
        elements: [
          {
            type: 'const',
            value: 'a',
          },
          {
            type: 'array',
            elements: [
              {
                type: 'const',
                value: 'b',
              },
              {
                type: 'const',
                value: 'c',
              },
            ],
          },
        ],
      },
    };

    const jsonSchemaParser = new JsonSchemaParser(json);
    const result = await jsonSchemaParser.parse();

    expect(result).toBeDefined();
    expect(result).toStrictEqual(expect.objectContaining({ value: expect.any(String) }));
    expect(result).toStrictEqual({ value: 'abc' });
  });

  it('should parse a type object', async () => {
    const json = {
      fields: {
        type: 'object',
        properties: [
          {
            key: {
              type: 'const',
              value: 'name',
            },
            value: {
              type: 'const',
              value: 'aa',
            },
          },
          {
            key: {
              type: 'const',
              value: 'hobby',
            },
            value: {
              type: 'array',
              elements: [
                {
                  type: 'const',
                  value: 'Code',
                },
                {
                  type: 'const',
                  value: 'Music',
                },
              ],
            },
          },
          {
            key: {
              type: 'const',
              value: 'addr',
            },
            value: {
              type: 'template',
              elements: [
                {
                  type: 'array',
                  elements: [
                    {
                      type: 'const',
                      value: 'future ',
                    },
                    {
                      type: 'const',
                      value: 'mars',
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    };

    const jsonSchemaParser = new JsonSchemaParser(json);
    const result = await jsonSchemaParser.parse();

    expect(result).toBeDefined();
    expect(result).toStrictEqual(expect.objectContaining({ fields: expect.any(Object) }));
    expect(result).toStrictEqual(
      expect.objectContaining({ fields: expect.objectContaining({ name: 'aa' }) })
    );
    expect(result).toStrictEqual(
      expect.objectContaining({ fields: expect.objectContaining({ hobby: ['Code', 'Music'] }) })
    );
    expect(result).toStrictEqual({
      fields: { name: 'aa', hobby: ['Code', 'Music'], addr: 'future mars' },
    });
  });

  describe('ObjectPathValue Parse', () => {
    let almanac: Promise<Almanac>;

    beforeEach(() => {
      almanac = almanacTest();
    });

    it('should be defined', async () => {
      expect(await almanac).toBeDefined();
    });

    it('should get object according to path', async () => {
      const data = await (
        await almanac
      ).factValue('trigger.wtrdS3OIXzjyRyvnP', undefined, 'record.fields.fldkTOW9IsLtIHWKrDE');

      expect(data).toBeDefined();
      expect(data).toStrictEqual('New Record');
    });

    it('should parse a type objectPathValue', async () => {
      const json = {
        triggerValue: {
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
                value: 'record',
              },
              {
                type: 'const',
                value: 'fields',
              },
              {
                type: 'const',
                value: 'fldkTOW9IsLtIHWKrDE',
              },
            ],
          },
        },
      };

      const jsonSchemaParser = new JsonSchemaParser(json, {
        pathResolver: async (_, path) => {
          const [id, p] = path;
          return await (await almanac).factValue(id, undefined, p);
        },
      });
      const result = await jsonSchemaParser.parse();

      expect(result).toBeDefined();
      expect(result).toStrictEqual(expect.objectContaining({ triggerValue: expect.any(String) }));
      expect(result).toStrictEqual({ triggerValue: 'New Record' });
    });
  });

  it('should parse a simple schema', async () => {
    const json = {
      inputExpressions: {
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
                    value: 'fields.name ',
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
                          value: 'record.fields',
                        },
                        {
                          type: 'const',
                          value: 'fldkTOW9IsLtIHWKrDE',
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

    const jsonSchemaParser = new JsonSchemaParser(json.inputExpressions, {
      pathResolver: async (_, path) => {
        const almanac = await almanacTest();
        const [id, p] = path;
        return await almanac.factValue(id, undefined, p);
      },
    });

    const result = await jsonSchemaParser.parse();

    expect(result).toBeDefined();
    expect(result).toStrictEqual(
      expect.objectContaining({ tableId: expect.any(String), fields: expect.any(Object) })
    );
    expect(result).toStrictEqual({
      tableId: 'tblwEp45tdvwTxiUl',
      fields: { fldELAd4ssqjk5CBg: 'fields.name New Record' },
    });
  });

  async function almanacTest(): Promise<Almanac> {
    const engine = new Engine();
    const facts = {
      'trigger.wtrdS3OIXzjyRyvnP': {
        record: {
          fields: {
            fldkTOW9IsLtIHWKrDE: 'New Record',
          },
        },
      },
    };
    const { almanac } = await engine.run(facts);
    return almanac;
  }
});
