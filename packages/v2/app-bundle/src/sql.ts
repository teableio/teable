const dollarTagPattern = /\$\w*\$/y;

interface IChunk {
  readonly chunk: string;
  readonly nextIndex: number;
}

const readLineComment = (text: string, index: number): IChunk => {
  const lineEnd = text.indexOf('\n', index);
  const end = lineEnd === -1 ? text.length : lineEnd + 1;
  return { chunk: text.slice(index, end), nextIndex: end };
};

const readBlockComment = (text: string, index: number): IChunk => {
  const blockEnd = text.indexOf('*/', index + 2);
  const end = blockEnd === -1 ? text.length : blockEnd + 2;
  return { chunk: text.slice(index, end), nextIndex: end };
};

const readQuotedLiteral = (text: string, index: number): IChunk => {
  const quote = text[index]!;
  let end = index + 1;
  while (end < text.length) {
    if (text[end] !== quote) {
      end += 1;
      continue;
    }
    if (text[end + 1] === quote) {
      end += 2;
      continue;
    }
    end += 1;
    break;
  }
  return { chunk: text.slice(index, end), nextIndex: end };
};

const readDollarQuoted = (text: string, index: number): IChunk | undefined => {
  dollarTagPattern.lastIndex = index;
  const tagMatch = dollarTagPattern.exec(text);
  if (!tagMatch) return undefined;
  const tag = tagMatch[0];
  const bodyEnd = text.indexOf(tag, index + tag.length);
  const end = bodyEnd === -1 ? text.length : bodyEnd + tag.length;
  return { chunk: text.slice(index, end), nextIndex: end };
};

const readSpecialChunk = (text: string, index: number): IChunk | undefined => {
  const char = text[index];
  const next = text[index + 1];
  if (char === '-' && next === '-') return readLineComment(text, index);
  if (char === '/' && next === '*') return readBlockComment(text, index);
  if (char === "'" || char === '"') return readQuotedLiteral(text, index);
  if (char === '$') return readDollarQuoted(text, index);
  return undefined;
};

/**
 * Splits authored migration SQL into individual statements. PGlite's Kysely
 * driver runs one statement per query, so multi-statement migration files must
 * be executed piecewise. This splitter tracks line/block comments,
 * single/double-quoted literals, and dollar-quoted bodies so semicolons inside
 * them do not terminate a statement.
 */
export const splitSqlStatements = (sqlText: string): string[] => {
  const statements: string[] = [];
  let current = '';
  let index = 0;

  while (index < sqlText.length) {
    if (sqlText[index] === ';') {
      const statement = current.trim();
      if (statement.length > 0) statements.push(statement);
      current = '';
      index += 1;
      continue;
    }

    const special = readSpecialChunk(sqlText, index);
    if (special) {
      current += special.chunk;
      index = special.nextIndex;
      continue;
    }

    current += sqlText[index];
    index += 1;
  }

  const trailing = current.trim();
  if (trailing.length > 0) statements.push(trailing);
  return statements;
};
