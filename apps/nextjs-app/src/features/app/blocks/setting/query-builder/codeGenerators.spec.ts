import {
  generateCurlCode,
  generateJavaScriptCode,
  generatePythonCode,
  toPythonLiteral,
} from './codeGenerators';

const endpoint = 'https://example.com/api/table/tbl1/record';
const token = '_YOUR_API_TOKEN_';

describe('toPythonLiteral', () => {
  it('maps null to None', () => {
    expect(toPythonLiteral(null)).toBe('None');
  });

  it('maps undefined to None', () => {
    expect(toPythonLiteral(undefined)).toBe('None');
  });

  it('maps booleans to True/False', () => {
    expect(toPythonLiteral(true)).toBe('True');
    expect(toPythonLiteral(false)).toBe('False');
  });

  it('renders numbers verbatim', () => {
    expect(toPythonLiteral(42)).toBe('42');
    expect(toPythonLiteral(-3.14)).toBe('-3.14');
  });

  it('quotes strings and escapes single quotes', () => {
    expect(toPythonLiteral('hello')).toBe("'hello'");
    expect(toPythonLiteral("it's")).toBe("'it\\'s'");
  });

  it('keeps the literal text "null" as a quoted string (no naive token replace)', () => {
    expect(toPythonLiteral('null')).toBe("'null'");
    expect(toPythonLiteral('true')).toBe("'true'");
  });

  it('serializes nested arrays and objects', () => {
    expect(toPythonLiteral([1, 'a', null])).toBe("[1, 'a', None]");
    expect(toPythonLiteral({ value: null, ok: true })).toBe("{'value': None, 'ok': True}");
    expect(toPythonLiteral({ list: [true, false] })).toBe("{'list': [True, False]}");
  });

  it('omits object properties whose value is undefined (JSON.stringify parity)', () => {
    expect(toPythonLiteral({ mode: 'daysAgo', numberOfDays: undefined })).toBe(
      "{'mode': 'daysAgo'}"
    );
    // arrays still null-fill undefined, matching JSON.stringify([1, undefined]) === '[1,null]'
    expect(toPythonLiteral([1, undefined])).toBe('[1, None]');
  });
});

describe('generatePythonCode (T1242 regression)', () => {
  it('emits Python None/True instead of JSON null/true in filter values', () => {
    const query = {
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: 'fld1', operator: 'is', value: null }],
      },
      fieldKeyType: 'name',
    } as unknown as Record<string, unknown>;

    const code = generatePythonCode(endpoint, query, token);

    expect(code).toContain('None');
    // The bug: raw JSON literals leaking into Python source as bare identifiers.
    // (json.dumps now wraps a real Python dict, so 'null'/'true'/'false' must not
    //  appear in the generated source — they only reappear at runtime.)
    expect(code).not.toMatch(/\bnull\b/);
    expect(code).not.toMatch(/\btrue\b/);
    expect(code).not.toMatch(/\bfalse\b/);
  });

  it('wraps filter/orderBy in json.dumps and other params as plain literals', () => {
    const query = {
      filter: { value: true },
      take: 10,
    } as unknown as Record<string, unknown>;

    const code = generatePythonCode(endpoint, query, token);

    expect(code).toContain('"filter": json.dumps(');
    expect(code).toContain("{'value': True}");
    expect(code).toContain('"take": 10');
  });
});

describe('generateCurlCode / generateJavaScriptCode (move smoke test)', () => {
  const query = { take: 10 } as unknown as Record<string, unknown>;

  it('generateCurlCode still produces a GET curl command', () => {
    const code = generateCurlCode(endpoint, query, token);
    expect(code).toContain('curl -X GET');
    expect(code).toContain(`${endpoint}?take=10`);
    expect(code).toContain(`Authorization: Bearer ${token}`);
  });

  it('generateJavaScriptCode still produces a fetch snippet', () => {
    const code = generateJavaScriptCode(endpoint, query, token);
    expect(code).toContain(`const url = new URL("${endpoint}");`);
    expect(code).toContain('take: 10');
    expect(code).toContain('fetch(url, {');
  });
});
