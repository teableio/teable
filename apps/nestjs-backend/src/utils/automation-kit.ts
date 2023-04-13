import type { Almanac } from 'json-rules-engine';
import _ from 'lodash';

export async function replaceVars(
  arr: string | string[] | undefined,
  context: Almanac
): Promise<string | undefined> {
  if (!arr) {
    return undefined;
  }

  arr = _.isArray(arr) ? arr : _.castArray(arr);

  const results = await Promise.all(
    arr.map(async (item) => {
      const regExp = /\$\.((?:[.\w\u4e00-\u9fa5]|\[\d\])*)/;

      const match = regExp.exec(item);
      const matchItem = match && match.length > 1 ? match[1] : item;

      if (matchItem === item) {
        return item;
      }

      const pathExpressions = _.split(matchItem, '.');

      if (pathExpressions.length < 1) {
        throw new Error('`path` expression error');
      }

      const [factId, ...path] = pathExpressions;
      const replacedItem = await context.factValue<string>(factId, undefined, path.join('.'));

      return _.replace(item, match![0], replacedItem);
    })
  );
  return results.join('');
}
