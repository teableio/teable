import { translateAirtableFormula } from './airtable-formula-translator';

const expr = (formula: string): string => {
  const result = translateAirtableFormula(formula);
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result.expression;
};

describe('translateAirtableFormula', () => {
  it('preserves field references, operators, and literals verbatim', () => {
    expect(expr('{fldabTo0bWtgfSrxf}+1')).toBe('{fldabTo0bWtgfSrxf}+1');
    expect(expr('{fldA} & " - " & {fldB}')).toBe('{fldA} & " - " & {fldB}');
    expect(expr('({fldA} + {fldB}) / 2 >= 10')).toBe('({fldA} + {fldB}) / 2 >= 10');
  });

  it('maps identical and renamed function names', () => {
    expect(expr('CONCATENATE({fldA},"x")')).toBe('CONCATENATE({fldA},"x")');
    expect(expr('ARRAYJOIN({fldA},", ")')).toBe('ARRAY_JOIN({fldA},", ")');
    expect(expr('DATEADD({fldA},1,"days")')).toBe('DATE_ADD({fldA},1,"days")');
    expect(expr('REGEX_REPLACE({fldA},"a","b")')).toBe('REGEXP_REPLACE({fldA},"a","b")');
    expect(expr('ISERROR({fldA})')).toBe('IS_ERROR({fldA})');
  });

  it('resolves function names case-insensitively to the Teable canonical name', () => {
    expect(expr('if({fldA}>5,1,2)')).toBe('IF({fldA}>5,1,2)');
  });

  it('converts TRUE()/FALSE() calls into boolean literals', () => {
    expect(expr('IF({fldA},TRUE(),FALSE())')).toBe('IF({fldA},TRUE,FALSE)');
  });

  it('does not translate text that merely looks like a function inside a string', () => {
    expect(expr('"ARRAYJOIN(x)"')).toBe('"ARRAYJOIN(x)"');
  });

  it('rejects unsupported functions so the importer can fall back to a snapshot', () => {
    expect(translateAirtableFormula('REGEX_MATCH({fldA},"x")').ok).toBe(false);
    expect(translateAirtableFormula('ARRAYSLICE({fldA},1,2)').ok).toBe(false);
  });

  it('rejects the unsupported "^" power operator', () => {
    const result = translateAirtableFormula('{fldA}^2');
    expect(result.ok).toBe(false);
  });

  it('rejects an unrecognized bare identifier', () => {
    expect(translateAirtableFormula('FOO').ok).toBe(false);
  });
});
