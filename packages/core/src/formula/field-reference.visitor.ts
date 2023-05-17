import { AbstractParseTreeVisitor } from 'antlr4ts/tree/AbstractParseTreeVisitor';
import type { FieldReferenceCurlyContext } from './parser/Formula';
import type { FormulaVisitor } from './parser/FormulaVisitor';

export class FieldReferenceVisitor
  extends AbstractParseTreeVisitor<string[]>
  implements FormulaVisitor<string[]>
{
  defaultResult() {
    return [];
  }

  aggregateResult(aggregate: string[], nextResult: string[]) {
    return aggregate.concat(nextResult);
  }

  visitFieldReferenceCurly(ctx: FieldReferenceCurlyContext) {
    return [ctx.text.slice(1, -1)];
  }
}
