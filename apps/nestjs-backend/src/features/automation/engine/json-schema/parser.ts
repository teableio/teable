import _ from 'lodash';

type IPathResolver<T = unknown> = (value: object, path: string | string[]) => T;

function defaultPathResolver(value: object, path: string | string[]) {
  return _.get(value, path);
}

export class JsonSchemaParser {
  private readonly inputSchema: { [key: string]: unknown };
  private readonly pathResolver: IPathResolver;

  constructor(
    inputSchema: { [key: string]: unknown },
    options: {
      pathResolver?: IPathResolver;
    } = {}
  ) {
    this.inputSchema = inputSchema;
    this.pathResolver = options.pathResolver || defaultPathResolver;
  }

  async parse(): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(this.inputSchema)) {
      if (typeof value === 'string') {
        result[key] = value;
      } else if (typeof value === 'object') {
        if (!value || !('type' in value)) {
          throw new Error(
            'Parse object format exceptions，Missing `type` attribute or object is undefined'
          );
        }

        const valueAs = value as Record<string, unknown>;
        result[key] = await ParserFactory.get(valueAs.type as IParserType).parse({
          schema: valueAs,
          pathResolver: this.pathResolver,
        });
      }
    }

    return result;
  }
}

type IParserType = 'null' | 'const' | 'array' | 'object' | 'template' | 'objectPathValue';

interface IOptions {
  schema: { [key: string]: unknown };
  parentNodeType?: IParserType;
  pathResolver: IPathResolver;
  arraySeparator?: string;
}

interface IParser {
  parse(options: IOptions): Promise<string | string[] | Record<string, unknown> | null | undefined>;
}

class NullParser implements IParser {
  private parserType: IParserType = 'null';

  async parse(options: IOptions): Promise<null> {
    return null;
  }
}

/**
 * const parser：
 * Import:
 * ```
 * {
 *    type: 'const',
 *    value: 'tblwEp45tdvwTxiUl',
 *  }
 * ```
 * Export:
 * 'tblwEp45tdvwTxiUl'
 */
class ConstParser implements IParser {
  private parserType: IParserType = 'const';

  async parse(options: IOptions): Promise<string | undefined> {
    const { schema } = options;
    return schema.value as string;
  }
}

class ArrayParser implements IParser {
  private parserType: IParserType = 'array';

  async parse(options: IOptions): Promise<string | string[] | undefined> {
    const { schema, parentNodeType, arraySeparator } = options;

    const result: string[] = [];
    for (const element of schema.elements as []) {
      const value = await ParserFactory.get(element['type']).parse({
        ...options,
        schema: element,
        parentNodeType: this.parserType,
      });
      result.push(value as string);
    }

    if (!parentNodeType || parentNodeType === 'object') {
      return result;
    }

    return result.join(arraySeparator || '');
  }
}

class ObjectParser implements IParser {
  private parserType: IParserType = 'object';

  async parse(options: IOptions): Promise<Record<string, unknown> | undefined> {
    const { schema } = options;

    const result: Record<string, unknown> = {};

    for (const prop of schema.properties as []) {
      const [key, value] = await Promise.all([
        ParserFactory.get(prop['key']['type']).parse({
          ...options,
          schema: prop['key'],
          parentNodeType: this.parserType,
        }),
        ParserFactory.get(prop['value']['type']).parse({
          ...options,
          schema: prop['value'],
          parentNodeType: this.parserType,
        }),
      ]);

      result[key as string] = value;
    }

    return result;
  }
}

class TemplateParser implements IParser {
  private parserType: IParserType = 'template';

  async parse(options: IOptions): Promise<string | string[] | undefined> {
    const { schema } = options;

    const result: string[] = [];

    for (const element of schema.elements as []) {
      const value = await ParserFactory.get(element['type']).parse({
        ...options,
        schema: element,
        parentNodeType: this.parserType,
      });
      result.push(value as string);
    }

    return result.join('');
  }
}

class ObjectPathValueParser implements IParser {
  private parserType: IParserType = 'objectPathValue';

  async parse(options: IOptions): Promise<string | Record<string, unknown> | undefined> {
    const { schema, pathResolver } = options;

    const { nodeId, nodeType } = schema.object as Record<string, string>;
    const pathAs = schema.path as Record<string, unknown>;

    const path = (await ParserFactory.get(pathAs.type as IParserType).parse({
      ...options,
      schema: pathAs,
      arraySeparator: '.',
      parentNodeType: this.parserType,
    })) as string;

    return pathResolver(schema, [`${nodeType}.${nodeId}`, path]) as
      | string
      | Record<string, unknown>
      | undefined;
  }
}

class ParserFactory {
  private static _parsers: { [type: string]: IParser } = {
    null: new NullParser(),
    const: new ConstParser(),
    array: new ArrayParser(),
    object: new ObjectParser(),
    template: new TemplateParser(),
    objectPathValue: new ObjectPathValueParser(),
  };

  static get(type: IParserType): IParser {
    const service: IParser = this._parsers[type];
    if (!service) {
      throw new Error('Unknown parser type: ' + type);
    }
    return service;
  }
}
