import { Parser } from 'node-sql-parser';
import { describe, expect, it } from 'vitest';
import {
  buildCaseFoldingHint,
  buildMissingColumnHint,
  collectQuotedColumnNames,
  collectUnquotedMixedCaseColumns,
  parseMissingColumnName,
  parseMissingColumnReference,
} from './column-case-folding';

/** Synthetic identifiers: a real tenant field id must never enter a fixture. */
const linkColumn = '__fk_fldAaBbCcDdEeFfG';

const parse = (sql: string) => new Parser().parse(sql, { database: 'postgresql' }).ast;

const collect = (sql: string) => collectUnquotedMixedCaseColumns(parse(sql));

const hintFor = (message: string, sql: string) => buildMissingColumnHint(message, parse(sql));

describe('collectUnquotedMixedCaseColumns', () => {
  it('collects an unquoted link column that keeps the field id case', () => {
    expect(
      collect(`SELECT "__id" FROM "bseXXX"."tblTasks" WHERE ${linkColumn} = 'recXXX' LIMIT 1`)
    ).toEqual([linkColumn]);
  });

  it('ignores the quoted form of the same column', () => {
    expect(
      collect(
        `SELECT "__id", "${linkColumn}" FROM "bseXXX"."tblTasks" WHERE "${linkColumn}" = 'recXXX' LIMIT 1`
      )
    ).toEqual([]);
  });

  it('ignores unquoted names that are already lower case', () => {
    expect(
      collect(
        `SELECT "title" FROM "bseXXX"."tblTasks" WHERE title = 'x' OR __id = 'recXXX' LIMIT 1`
      )
    ).toEqual([]);
  });

  it('ignores upper-case text inside string literals and aliases', () => {
    expect(
      collect(
        `SELECT "title" AS "Total" FROM "bseXXX"."tblTasks" WHERE "title" = 'Not A Column' GROUP BY 1`
      )
    ).toEqual([]);
  });

  it('collects nothing for a star projection and stays stable on an empty statement', () => {
    expect(collect(`SELECT * FROM "bseXXX"."tblTasks" LIMIT 1`)).toEqual([]);
  });

  it('deduplicates and keeps statement order across multiple statements', () => {
    expect(
      collect(
        `SELECT a FROM "bseXXX"."tblTasks" WHERE __fk_fldBbB = 'x'; SELECT b FROM "bseXXX"."tblTasks" WHERE __fk_fldAaA = 'y'`
      )
    ).toEqual(['__fk_fldBbB', '__fk_fldAaA']);
  });

  it('keeps a folded function argument, which PostgreSQL folds as well', () => {
    expect(
      collect(`SELECT count(__id) FROM "bseXXX"."tblTasks" WHERE FkCol = 'x' LIMIT 1`)
    ).toEqual(['FkCol']);
  });
});

describe('collectQuotedColumnNames', () => {
  it('collects quoted references, including one that contains dots', () => {
    expect(
      collectQuotedColumnNames(
        parse(`SELECT "Total", "foo.bar" FROM "bseXXX"."tblTasks" WHERE ${linkColumn} = 'recXXX'`)
      )
    ).toEqual(['Total', 'foo.bar']);
  });
});

describe('parseMissingColumnReference', () => {
  it('keeps the reference as PostgreSQL wrote it', () => {
    expect(parseMissingColumnReference(`column "${linkColumn.toLowerCase()}" does not exist`)).toBe(
      `"${linkColumn.toLowerCase()}"`
    );
    expect(parseMissingColumnReference('column t.missing does not exist')).toBe('t.missing');
  });

  it('returns null when the message is not an undefined column', () => {
    expect(parseMissingColumnReference('relation "tblTasks" does not exist')).toBeNull();
  });
});

describe('parseMissingColumnName', () => {
  it('reads the name PostgreSQL quoted', () => {
    expect(parseMissingColumnName('column "__fk_fldaabbccddeeffg" does not exist')).toBe(
      '__fk_fldaabbccddeeffg'
    );
  });

  it('falls back to the trailing segment of a qualified reference', () => {
    expect(parseMissingColumnName('column t.__fk_fldaabbccddeeffg does not exist')).toBe(
      '__fk_fldaabbccddeeffg'
    );
    // A quoted identifier that contains dots is indistinguishable from a qualifier here;
    // buildMissingColumnHint cross-checks the AST for exactly this case.
    expect(parseMissingColumnName('column t.foo.bar does not exist')).toBe('bar');
  });
});

describe('buildMissingColumnHint', () => {
  it('hints on the column PostgreSQL reported, with the quoted identifier', () => {
    const hint = hintFor(
      `column "${linkColumn.toLowerCase()}" does not exist`,
      `SELECT "__id" FROM "bseXXX"."tblTasks" WHERE ${linkColumn} = 'recXXX' LIMIT 1`
    );

    expect(hint).toContain('PostgreSQL folds unquoted identifiers to lower case');
    expect(hint).toContain(`"${linkColumn}"`);
  });

  it('hints on a qualified reference as well', () => {
    const hint = hintFor(
      `column t.${linkColumn.toLowerCase()} does not exist`,
      `SELECT "t"."__id" FROM "bseXXX"."tblTasks" AS "t" WHERE t.${linkColumn} = 'recXXX' LIMIT 1`
    );

    expect(hint).toContain(`"${linkColumn}"`);
  });

  it('stays silent when an unrelated unquoted mixed-case reference resolved fine', () => {
    expect(
      hintFor(
        'column "missing" does not exist',
        `WITH "t" AS (SELECT 1 AS "__auto_number") SELECT __AUTO_NUMBER, "missing" FROM "t"`
      )
    ).toBeNull();
    expect(
      hintFor(
        'column "missing" does not exist',
        `SELECT __ID FROM "bseXXX"."tblTasks" WHERE "missing" = 'x'`
      )
    ).toBeNull();
  });

  it('stays silent when the reported column was written quoted', () => {
    expect(
      hintFor(
        'column "Foo" does not exist',
        `WITH "t" AS (SELECT 1 AS "foo") SELECT FOO, "Foo" FROM "t"`
      )
    ).toBeNull();
  });

  it('stays silent when the reported column is a quoted identifier containing dots', () => {
    expect(
      hintFor(
        'column "foo.bar" does not exist',
        `SELECT BAR, "foo.bar" FROM "bseXXX"."tblTasks" LIMIT 1`
      )
    ).toBeNull();
    expect(
      hintFor(
        'column t.foo.bar does not exist',
        `SELECT t.BAR, t."foo.bar" FROM "bseXXX"."tblTasks" AS "t" LIMIT 1`
      )
    ).toBeNull();
  });

  it('names only the identifier that matches the missing column', () => {
    const hint = hintFor(
      `column "${linkColumn.toLowerCase()}" does not exist`,
      `SELECT __OtherMixed FROM "bseXXX"."tblTasks" WHERE ${linkColumn} = 'recXXX' LIMIT 1`
    );

    expect(hint).toContain(`"${linkColumn}"`);
    expect(hint).not.toContain('__OtherMixed');
  });

  it('stays silent when the missing column has no unquoted mixed-case candidate', () => {
    expect(
      hintFor(
        'column "MissingColumn" does not exist',
        `SELECT "__id" FROM "bseXXX"."tblTasks" WHERE ${linkColumn} = 'recXXX' LIMIT 1`
      )
    ).toBeNull();
  });
});

describe('buildCaseFoldingHint', () => {
  it('names both the folded and the required quoted identifier', () => {
    const hint = buildCaseFoldingHint([linkColumn]);

    expect(hint).toContain('PostgreSQL folds unquoted identifiers to lower case');
    expect(hint).toContain(`\`${linkColumn.toLowerCase()}\``);
    expect(hint).toContain(`"${linkColumn}"`);
  });

  it('lists at most three identifiers and counts the rest', () => {
    const hint = buildCaseFoldingHint(['AaA', 'BbB', 'CcC', 'DdD', 'EeE']);

    expect(hint).toContain('"AaA", "BbB", "CcC"');
    expect(hint).toContain('(and 2 more)');
    expect(hint).not.toContain('"DdD"');
  });
});
