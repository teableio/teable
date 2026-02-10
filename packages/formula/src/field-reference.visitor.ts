import { AbstractParseTreeVisitor } from 'antlr4ts/tree/AbstractParseTreeVisitor.js';
import { extractFieldReferenceId } from './field-reference.util';
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
    const fieldId = extractFieldReferenceId(ctx);
    return fieldId ? [fieldId] : this.defaultResult();
  }
}
