import { JSONPath } from 'jsonpath-plus';
import { isEmpty, update, isNil } from 'lodash';

type IType = 'properties';

export class MetaKit {
  private constructor() {}

  static replaceOfPropValue(json: object, path: string | string[], updater: object) {
    return this.replace(json, path, updater, 'properties');
  }

  static queryPathOfProp(
    json: object,
    shortPath: string | string[],
    propKey: string,
    cancelSymbol = true
  ): string | undefined {
    const match = `[?(@.key.value === '${propKey}')]`;

    const matchResults = this.queryPath(json, shortPath, 'properties', match);
    if (isEmpty(matchResults)) {
      return undefined;
    }
    const result = matchResults?.[0];
    return cancelSymbol ? result?.slice(1) : result;
  }

  private static queryPath(
    json: object,
    shortPath: string | string[],
    type?: IType,
    match?: string
  ): string | string[] | undefined {
    const path = `$.${shortPath}${type ? `.${type}` : ''}${match ?? ''}`;
    return JSONPath({ path: path, json: json, resultType: 'path', wrap: false });
  }

  private static replace(json: object, path: string | string[], updater: object, type?: IType) {
    return update(json, path, (value) => {
      if (!isNil(value)) {
        if (type === 'properties') {
          value.value = updater;
        } else {
          value = updater;
        }
      }
      return value;
    });
  }
}
