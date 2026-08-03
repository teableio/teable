import type { IBaseJson } from '@teable/openapi';
import {
  adaptStructureTimeZone,
  replaceExpressionFieldIds,
  replaceJsonStringFieldIds,
  replaceTimeZoneDeep,
  replaceWorkflowTimeZoneDeep,
} from './utils';

describe('replaceFieldIds function', () => {
  it('replaces fieldIds in the expression with their mapped values', () => {
    const old2NewFieldMap = {
      fld123: 'newFld456',
      fld789: 'newFld101112',
    };
    const expression = 'This is a test with {fld123} and also {fld789}.';
    const expectedResult = 'This is a test with {newFld456} and also {newFld101112}.';

    expect(replaceExpressionFieldIds(expression, old2NewFieldMap)).toEqual(expectedResult);
  });

  it('does not replace non-existent fieldIds', () => {
    const old2NewFieldMap = {
      fld123: 'newFld456',
    };
    const expression = 'This is a test with {fld123} and also {fldNonExistent}.';
    const expectedResult = 'This is a test with {newFld456} and also {fldNonExistent}.';

    expect(replaceExpressionFieldIds(expression, old2NewFieldMap)).toEqual(expectedResult);
  });

  it('correctly ignores invalid fieldId formats', () => {
    const old2NewFieldMap = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      '1fldInvalid': 'newFld456',
    };
    const expression = 'Check {1fldInvalid} and {fld123}.';
    const expectedResult = 'Check {1fldInvalid} and {fld123}.'; // Assuming fld123 is not in the map, and 1fldInvalid is ignored due to invalid format

    expect(replaceExpressionFieldIds(expression, old2NewFieldMap)).toEqual(expectedResult);
  });
});

describe('replaceJsonStringFieldIds', () => {
  it('should replace fieldIds in jsonString correctly', () => {
    const jsonString =
      '{"exampleFieldId": "fld1234567890abcdef", "nested": {"fld234567890abcdefg": "someValue"}}';
    const old2NewFieldMap = {
      fld1234567890abcdef: 'fldNew1234567890abcd',
      fld234567890abcdefg: 'fldNew234567890abcde',
    };

    const expectedResult =
      '{"exampleFieldId": "fldNew1234567890abcd", "nested": {"fldNew234567890abcde": "someValue"}}';

    const result = replaceJsonStringFieldIds(jsonString, old2NewFieldMap);

    expect(result).toBe(expectedResult);
  });

  it('should not modify jsonString if no fieldIds match', () => {
    const jsonString = '{"unrelatedKey": "unrelatedValue", "anotherKey": 123}';
    const old2NewFieldMap = {
      fldDoesNotExist: 'fldNewValue',
    };
    const result = replaceJsonStringFieldIds(jsonString, old2NewFieldMap);
    expect(result).toBe(jsonString);
  });

  it('should handle jsonString with empty fieldId map', () => {
    const jsonString = '{"exampleFieldId": "fld1234567890abcdef"}';
    const old2NewFieldMap = {};
    const result = replaceJsonStringFieldIds(jsonString, old2NewFieldMap);
    expect(result).toBe(jsonString); // Expect no change since the map is empty
  });

  it('should correctly replace fieldIds when they appear as values', () => {
    const jsonString = '{"key": "fld1234567890abcdef"}';
    const old2NewFieldMap = {
      fld1234567890abcdef: 'fldReplacement',
    };
    const expectedResult = '{"key": "fldReplacement"}';
    const result = replaceJsonStringFieldIds(jsonString, old2NewFieldMap);
    expect(result).toBe(expectedResult);
  });

  it('should correctly replace fieldIds when they appear as keys', () => {
    const jsonString = '{"fld1234567890abcdef": "someValue"}';
    const old2NewFieldMap = {
      fld1234567890abcdef: 'fldNewKey',
    };
    const expectedResult = '{"fldNewKey": "someValue"}';
    const result = replaceJsonStringFieldIds(jsonString, old2NewFieldMap);
    expect(result).toBe(expectedResult);
  });

  it('should handle jsonString with multiple and nested fieldIds', () => {
    const jsonString =
      '{"fld1234567890abcdef": "value1", "nested": {"fld4561237890abcdef": "value2"}}';
    const old2NewFieldMap = {
      fld1234567890abcdef: 'fldNew4567890abcdef',
      fld4561237890abcdef: 'fldNew1237890abcdef',
    };
    const expectedResult =
      '{"fldNew4567890abcdef": "value1", "nested": {"fldNew1237890abcdef": "value2"}}';
    const result = replaceJsonStringFieldIds(jsonString, old2NewFieldMap);
    expect(result).toBe(expectedResult);
  });

  it('should return original jsonString for empty input', () => {
    const jsonString = '';
    const old2NewFieldMap = {
      fld1234567890abcdef: 'fldReplacement',
    };
    const result = replaceJsonStringFieldIds(jsonString, old2NewFieldMap);
    expect(result).toBe(jsonString);
  });

  it('should return null jsonString for null input', () => {
    const jsonString = null;
    const old2NewFieldMap = {
      fld1234567890abcdef: 'fldReplacement',
    };
    const result = replaceJsonStringFieldIds(jsonString, old2NewFieldMap);
    expect(result).toBe(null);
  });
});

describe('replaceTimeZoneDeep', () => {
  it('should replace nested timeZone string values', () => {
    const options = {
      formatting: {
        date: 'YYYY-MM-DD',
        time: 'None',
        timeZone: 'America/New_York',
      },
      defaultValue: 'now',
    };

    expect(replaceTimeZoneDeep(options, 'Asia/Shanghai')).toEqual({
      formatting: {
        date: 'YYYY-MM-DD',
        time: 'None',
        timeZone: 'Asia/Shanghai',
      },
      defaultValue: 'now',
    });
  });

  it('should replace timeZone in arrays and top-level keys', () => {
    const filter = {
      filterSet: [
        {
          fieldId: 'fld1',
          operator: 'isWithIn',
          value: { mode: 'pastNumberOfDays', numberOfDays: 7, timeZone: 'Europe/Paris' },
        },
      ],
      conjunction: 'and',
    };

    expect(replaceTimeZoneDeep(filter, 'Asia/Tokyo')).toEqual({
      filterSet: [
        {
          fieldId: 'fld1',
          operator: 'isWithIn',
          value: { mode: 'pastNumberOfDays', numberOfDays: 7, timeZone: 'Asia/Tokyo' },
        },
      ],
      conjunction: 'and',
    });
  });

  it('should not touch non-string timeZone values or other keys', () => {
    const config = { timeZone: 123, name: 'timeZone', nested: null };
    expect(replaceTimeZoneDeep(config, 'Asia/Shanghai')).toEqual(config);
  });

  it('should handle primitives and null', () => {
    expect(replaceTimeZoneDeep(null, 'Asia/Shanghai')).toBe(null);
    expect(replaceTimeZoneDeep('text', 'Asia/Shanghai')).toBe('text');
    expect(replaceTimeZoneDeep(42, 'Asia/Shanghai')).toBe(42);
  });
});

describe('replaceWorkflowTimeZoneDeep', () => {
  it('should replace tz in scheduled-time trigger configs', () => {
    const config = {
      starting: '2026-01-01T00:00:00.000Z',
      tz: 'America/New_York',
      timing: { type: 'days', interval: 1, triggerTime: { hour: 9, minute: 0 } },
    };

    const result = replaceWorkflowTimeZoneDeep(config, 'Asia/Shanghai');
    expect(result.tz).toBe('Asia/Shanghai');
    expect(result.timing).toEqual(config.timing);
  });

  it('should not replace tz when there is no sibling timing key', () => {
    const config = { tz: 'America/New_York', other: 1 };
    expect(replaceWorkflowTimeZoneDeep(config, 'Asia/Shanghai').tz).toBe('America/New_York');
  });

  it('should replace nested timeZone in node date conditions', () => {
    const nodeConfig = {
      conditions: [
        {
          operator: 'is',
          value: { mode: 'today', timeZone: 'America/New_York' },
        },
      ],
    };

    const result = replaceWorkflowTimeZoneDeep(nodeConfig, 'Asia/Shanghai');
    expect(result.conditions[0].value.timeZone).toBe('Asia/Shanghai');
  });

  it('should not rewrite timeZone inside literal node values (user-authored payloads)', () => {
    // e.g. HTTP request action posting a literal JSON body to an external API
    const nodeConfig = {
      url: { type: 'literal', value: 'https://api.example.com' },
      body: [
        {
          key: { type: 'literal', value: 'payload' },
          value: { type: 'literal', value: { timeZone: 'UTC', items: [{ timeZone: 'UTC' }] } },
        },
      ],
    };

    const result = replaceWorkflowTimeZoneDeep(nodeConfig, 'Asia/Shanghai');
    expect(result.body[0].value.value).toEqual({
      timeZone: 'UTC',
      items: [{ timeZone: 'UTC' }],
    });
  });

  it('should still rewrite timeZone in fact node formatDate pipe options', () => {
    const nodeConfig = {
      prompt: {
        type: 'fact',
        fact: 'wtrTest',
        params: {
          pipes: ['formatDate'],
          pipeOptions: {
            formatDate: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'America/New_York' },
          },
        },
      },
    };

    const result = replaceWorkflowTimeZoneDeep(nodeConfig, 'Asia/Shanghai');
    expect(result.prompt.params.pipeOptions.formatDate.timeZone).toBe('Asia/Shanghai');
  });
});

describe('adaptStructureTimeZone', () => {
  it('should adapt scheduled trigger tz in EE workflows when present', () => {
    const structure = {
      id: 'bseTest',
      name: 'Test',
      icon: null,
      tables: [],
      folders: [],
      nodes: [],
      plugins: {},
      version: '1',
      workflows: [
        {
          id: 'wflTest',
          nodes: [
            {
              id: 'wnoTest',
              type: 'scheduledTime',
              config: {
                starting: '2026-01-01T00:00:00.000Z',
                tz: 'America/New_York',
                timing: { type: 'days', interval: 1, triggerTime: { hour: 9, minute: 0 } },
              },
              // cached external API response: must NOT be rewritten
              testResult: { response: { timeZone: 'America/New_York' } },
            },
          ],
        },
      ],
    } as unknown as IBaseJson;

    const result = adaptStructureTimeZone(structure, 'Asia/Shanghai');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workflows = (result as any).workflows;
    expect(workflows[0].nodes[0].config.tz).toBe('Asia/Shanghai');
    expect(workflows[0].nodes[0].testResult.response.timeZone).toBe('America/New_York');
  });

  it('should adapt field options and view filters without touching other parts', () => {
    const structure = {
      id: 'bseTest',
      name: 'Test',
      icon: null,
      tables: [
        {
          id: 'tblTest',
          name: 'Table',
          fields: [
            {
              id: 'fldDate',
              type: 'date',
              options: {
                formatting: { date: 'YYYY-MM-DD', time: 'None', timeZone: 'America/New_York' },
              },
            },
            {
              id: 'fldFormula',
              type: 'formula',
              options: {
                expression: 'NOW()',
                timeZone: 'America/New_York',
                formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'America/New_York' },
              },
            },
            { id: 'fldText', type: 'singleLineText', options: {} },
          ],
          views: [
            {
              id: 'viwTest',
              filter: {
                filterSet: [
                  {
                    fieldId: 'fldDate',
                    operator: 'is',
                    value: { mode: 'today', timeZone: 'America/New_York' },
                  },
                ],
                conjunction: 'and',
              },
            },
          ],
        },
      ],
      folders: [],
      nodes: [],
      plugins: {},
      version: '1',
    } as unknown as IBaseJson;

    const result = adaptStructureTimeZone(structure, 'Asia/Shanghai');
    const [table] = result.tables;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fields = table.fields as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const views = table.views as any[];

    expect(fields[0].options.formatting.timeZone).toBe('Asia/Shanghai');
    expect(fields[1].options.timeZone).toBe('Asia/Shanghai');
    expect(fields[1].options.formatting.timeZone).toBe('Asia/Shanghai');
    expect(fields[2].options).toEqual({});
    expect(views[0].filter.filterSet[0].value.timeZone).toBe('Asia/Shanghai');
    // untouched parts stay identical
    expect(result.id).toBe('bseTest');
    expect(result.plugins).toBe(structure.plugins);
  });
});
