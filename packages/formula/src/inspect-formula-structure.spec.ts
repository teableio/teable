import { CharStreams, CommonTokenStream } from 'antlr4ts';
import { FieldReferenceVisitor } from './field-reference.visitor';
import {
  inspectFormulaAst,
  inspectFormulaStructure,
  type FormulaStructureCheck,
} from './inspect-formula-structure';
import { Formula } from './parser/Formula';
import { FormulaLexer } from './parser/FormulaLexer';

class StructureLimit extends Error {
  constructor(
    readonly metric: 'astDepth' | 'visitedNodes',
    readonly attempted: number
  ) {
    super(metric);
  }
}

const checkLimits =
  (astDepth: number, visitedNodes = 32768): FormulaStructureCheck =>
  (metric, attempted) => {
    if (attempted > (metric === 'astDepth' ? astDepth : visitedNodes)) {
      throw new StructureLimit(metric, attempted);
    }
  };

const parse = (expression: string) =>
  new Formula(new CommonTokenStream(new FormulaLexer(CharStreams.fromString(expression)))).root();

const references = (expression: string, astDepth: number, visitedNodes = 32768) => {
  const check = checkLimits(astDepth, visitedNodes);
  inspectFormulaStructure(expression, check);
  const tree = parse(expression);
  inspectFormulaAst(tree, check);
  return new FieldReferenceVisitor().visit(tree);
};

describe('formula structure inspection', () => {
  it.each([
    ['unary prefixes', '-'.repeat(10000) + '1'],
    ['brackets', '('.repeat(10000) + '1' + ')'.repeat(10000)],
    ['functions', 'IF(1,'.repeat(10000) + '1' + ',0)'.repeat(10000)],
    ['leading comments', '// comment\n'.repeat(10000) + '1'],
  ])('rejects %s before recursive parsing is necessary', (_name, expression) => {
    expect(() => inspectFormulaStructure(expression, checkLimits(64))).toThrow(StructureLimit);
  });

  it('recognizes recursion across unary, comment and bracket tokens', () => {
    const expression = '-(// comment\n'.repeat(80) + '1' + ')'.repeat(80);
    expect(() => inspectFormulaStructure(expression, checkLimits(64))).toThrow(StructureLimit);
    expect(references(expression, 1024)).toEqual([]);
  });

  it('checks left associative trees before recursive visiting', () => {
    const expression = Array.from({ length: 512 }, () => '1').join('+');
    // Left recursion is a parser loop, so the early recursion check permits it.
    inspectFormulaStructure(expression, checkLimits(64));
    const tree = parse(expression);
    expect(() => inspectFormulaAst(tree, checkLimits(64))).toThrow(StructureLimit);
    expect(references(expression, 1024)).toEqual([]);
  });

  it('counts trailing comment and whitespace wrappers in the AST', () => {
    const expression = '1' + '\n// comment'.repeat(80);
    inspectFormulaStructure(expression, checkLimits(64));
    expect(() => inspectFormulaAst(parse(expression), checkLimits(64))).toThrow(StructureLimit);
  });

  it('does not interpret quoted strings, field names or comment contents as structure', () => {
    const opaque = '-('.repeat(512);
    const expression = `CONCATENATE("${opaque}", {${opaque}}) /* ${opaque} */`;
    expect(references(expression, 32)).toEqual([opaque]);
  });

  it('preserves field references and function arguments with a wide budget', () => {
    const expression = 'IF({first} > 0, CONCATENATE("a\\"(-", {second}), -({third} + 1))';
    expect(references(expression, 128)).toEqual(['first', 'second', 'third']);
  });

  it('rejects wide shallow ASTs by node count without imposing an argument count limit', () => {
    const expression = `SUM(${Array.from({ length: 40 }, () => '1').join(',')})`;
    const tree = parse(expression);
    expect(() => inspectFormulaAst(tree, checkLimits(64, 32))).toThrow(StructureLimit);
    expect(references(expression, 64, 512)).toEqual([]);
  });

  it('reports per-tree counts independently on repeated inspections', () => {
    const tree = parse('{first}+{second}');
    const count = () => {
      let nodes = 0;
      inspectFormulaAst(tree, (metric, attempted) => {
        if (metric === 'visitedNodes') nodes = attempted;
      });
      return nodes;
    };
    const nodes = count();
    expect(() => inspectFormulaAst(tree, checkLimits(64, nodes - 1))).toThrow(StructureLimit);
    inspectFormulaAst(tree, checkLimits(64, nodes));
    expect(count()).toBe(nodes);
  });
});
