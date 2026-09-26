import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import Papa from 'papaparse';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as replayFactory from './createCsvReplayStore';
import { createNodeCsvReplayStore } from './NodeCsvReplayStore';
import { PapaparseCsvParser } from './PapaparseCsvParser';
import { parseCsvRows } from './parseCsvRows';

const createCsvResponse = (chunks: string[]) => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    statusText: 'OK',
    headers: [['content-type', 'text/csv; charset=utf-8']],
  });
};

describe('PapaparseCsvParser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('releases consumed row objects while the stream remains open', async () => {
    setFlagsFromString('--expose_gc');
    const collectGarbage: () => void = runInNewContext('gc');
    setFlagsFromString('--no-expose_gc');
    async function* chunks() {
      yield 'Name,Note\n';
      for (let index = 0; index < 10_000; index++) {
        yield `${index},${'x'.repeat(1024)}\n`;
      }
    }

    const parsed = await new PapaparseCsvParser().parseAsync({ type: 'stream', data: chunks() });
    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) return;
    const iterator = parsed.value.rowsAsync![Symbol.asyncIterator]();
    const rememberFirstRow = async () => {
      const first = await iterator.next();
      expect(first.done).toBe(false);
      return new WeakRef(first.value);
    };
    const firstRow = await rememberFirstRow();
    try {
      for (let index = 0; index < 9000; index++) await iterator.next();
      // WeakRefs remain alive for their creation job. Collect only in later turns.
      for (let attempt = 0; attempt < 3; attempt++) {
        await setImmediate();
        collectGarbage();
      }
      expect(firstRow.deref()).toBeUndefined();
      expect((await iterator.next()).value.Name).toBe('9001');
    } finally {
      await iterator.return?.();
    }
  });

  it('pulls on demand and closes the upstream iterator on early return', async () => {
    let pulledCharacters = 0;
    const header = 'Name,Age\n';
    const name = `Person ${'x'.repeat(1024)}`;
    const record = `${name},30\n`;
    let closed = false;
    async function* chunks() {
      try {
        pulledCharacters += header.length;
        yield header;
        for (let index = 0; index < 10_000; index++) {
          pulledCharacters += record.length;
          yield record;
        }
      } finally {
        closed = true;
      }
    }

    const result = await new PapaparseCsvParser().parseAsync({ type: 'stream', data: chunks() });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    for await (const row of result.value.rowsAsync!) {
      expect(row.Name).toBe(name);
      break;
    }
    expect(pulledCharacters).toBeGreaterThanOrEqual(1024 * 1024);
    expect(pulledCharacters).toBeLessThan(1024 * 1024 + record.length);
    expect(closed).toBe(true);
  });

  it('matches Papa CR detection after a long header in small source chunks', async () => {
    const csv = `${'h'.repeat(2000)},b\rv1,v2\r`;
    async function* chunks() {
      for (let offset = 0; offset < csv.length; offset += 17) yield csv.slice(offset, offset + 17);
    }
    const rows = [];
    for await (const row of parseCsvRows({ type: 'stream', data: chunks() })) rows.push(row);
    expect(rows).toEqual(Papa.parse<string[]>(csv, { skipEmptyLines: true }).data);
  });

  it.each([
    ['quoted LF before CR', `"${'h'.repeat(2000)}\nheader",b\r"value\none",v2\r`],
    ['separate quote pairs', '"left",b\r"right\ninside",v2\r'],
    ['escaped quote pairs', 'h,b\r"left""\ninside""",v2\r'],
    ['LF occurring first', 'h,b\nv1,v2\rv3,v4\r'],
    ['CR majority', 'h,b\rv1,v2\r\nv3,v4\r'],
    ['CRLF ratio boundary', 'h,b\r\nv1,v2\r\nv3,v4\r'],
  ])('matches Papa newline inference with %s', async (_name, csv) => {
    async function* chunks() {
      for (let offset = 0; offset < csv.length; offset += 13) yield csv.slice(offset, offset + 13);
    }
    const rows = [];
    for await (const row of parseCsvRows({ type: 'stream', data: chunks() }, { delimiter: ',' })) {
      rows.push(row);
    }
    expect(rows).toEqual(Papa.parse<string[]>(csv, { delimiter: ',', skipEmptyLines: true }).data);
  });

  it.each([',', undefined])(
    'retains decoded overhang exactly once beyond the 1 MiB UTF-16 sample with delimiter %s',
    async (delimiter) => {
      const prefix = `h,b\r${'x'.repeat(1024 * 1024 - 5)}`;
      const overhang = '\u{1f600},v\r\nend,tail\r\n';
      const csv = prefix + overhang;
      async function* chunks() {
        yield prefix;
        yield new TextEncoder().encode(overhang);
      }
      const rows = [];
      for await (const row of parseCsvRows({ type: 'stream', data: chunks() }, { delimiter })) {
        rows.push(row);
      }
      expect(rows).toEqual(Papa.parse<string[]>(csv, { delimiter, skipEmptyLines: true }).data);
    }
  );

  it('matches Papa when the 1 MiB sample ends between CR and LF', async () => {
    const prefix = `h,b\r\n${'x'.repeat(1024 * 1024 - 8)},v\r`;
    const suffix = '\nend,tail\r\n';
    async function* chunks() {
      yield prefix;
      yield suffix;
    }
    const rows = [];
    for await (const row of parseCsvRows({ type: 'stream', data: chunks() }, { delimiter: ',' })) {
      rows.push(row);
    }
    expect(rows).toEqual(
      Papa.parse<string[]>(prefix + suffix, { delimiter: ',', skipEmptyLines: true }).data
    );
  });

  it('preserves quoted records, UTF-8 and CRLF across byte boundaries', async () => {
    const csv =
      '\ufeff Name , Note \r\n"张三","hello\r\nworld and ""quotes"""\r\n"李四","last, value"';
    async function* chunks() {
      for (const byte of new TextEncoder().encode(csv)) yield Uint8Array.of(byte);
    }
    const result = await new PapaparseCsvParser().parseAsync({ type: 'stream', data: chunks() });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const rows = [];
    for await (const row of result.value.rowsAsync!) rows.push(row);
    expect(result.value.headers).toEqual(['Name', 'Note']);
    expect(rows).toEqual([
      { Name: '张三', Note: 'hello\r\nworld and "quotes"' },
      { Name: '李四', Note: 'last, value' },
    ]);
  });

  it('bounds decoded replay chunks when UTF-8 carry-over expands a full byte chunk', async () => {
    const encoder = new TextEncoder();
    const prefix = `name;full,age\nBob;"${'x'.repeat(1024 * 1024)}`;
    async function* chunks() {
      yield new Uint8Array([...encoder.encode(prefix), 0xf0, 0x9f, 0x98]);
      const fullChunk = new Uint8Array(65_536).fill(0x78);
      fullChunk[0] = 0x80;
      yield fullChunk;
      yield encoder.encode(',30\nBob;last,40\n');
    }
    const parsed = (
      await new PapaparseCsvParser().parseAsync({ type: 'stream', data: chunks() })
    )._unsafeUnwrap();
    const rows = [];
    for await (const row of parsed.rowsAsync!) rows.push(row);
    expect(parsed.headers).toEqual(['name;full', 'age']);
    expect(rows).toEqual([
      { ['name;full']: `Bob;"${'x'.repeat(1024 * 1024)}\u{1f600}${'x'.repeat(65_535)}`, age: '30' },
      { ['name;full']: 'Bob;last', age: '40' },
    ]);
  });

  it('keeps a CR at the decoded sample edge when replay chunks need splitting', async () => {
    const encoder = new TextEncoder();
    const header = `\u{1f600}${'x'.repeat(65_532)}`;
    async function* chunks() {
      yield Uint8Array.of(0xf0, 0x9f, 0x98);
      yield new Uint8Array([0x80, ...encoder.encode(`${'x'.repeat(65_532)},b\r`)]);
      yield encoder.encode('value,1\r');
    }
    const parsed = (
      await new PapaparseCsvParser().parseAsync(
        { type: 'stream', data: chunks() },
        { delimiter: ',' }
      )
    )._unsafeUnwrap();
    const rows = [];
    for await (const row of parsed.rowsAsync!) rows.push(row);
    expect(parsed.headers).toEqual([header, 'b']);
    expect(rows).toEqual([{ [header]: 'value', b: '1' }]);
  });

  it('cancels and unlocks URL bodies when the consumer stops', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('Name,Age\nAlice,30\n'));
      },
      cancel,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    const result = await new PapaparseCsvParser().parseAsync({
      type: 'url',
      url: 'https://example.com/synthetic.csv',
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const iterator = result.value.rowsAsync![Symbol.asyncIterator]();
    // Even a consumer which only needed headers must be able to release the source.
    await iterator.return?.();
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('streams explicit data without allocating all parsed rows', async () => {
    const result = await new PapaparseCsvParser().parseAsync({
      type: 'string',
      data: 'Name,Age\nAlice,30\nBob,40',
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.rowsAsync).toBeDefined();
    const rows = [];
    for await (const row of result.value.rowsAsync!) rows.push(row);
    expect(rows).toEqual([
      { Name: 'Alice', Age: '30' },
      { Name: 'Bob', Age: '40' },
    ]);
  });

  it('rejects unterminated quoted inline data instead of importing a recovered row', async () => {
    const result = await new PapaparseCsvParser().parseAsync({
      type: 'string',
      data: 'Name,Age\n"Alice,30',
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('csv.parse_error');
  });

  it.each(['Alice,30,unexpected', 'Alice'])(
    'rejects a header-width mismatch instead of discarding or inventing cells: %s',
    async (row) => {
      const parsed = (
        await new PapaparseCsvParser().parseAsync({ type: 'string', data: `Name,Age\n${row}` })
      )._unsafeUnwrap();
      const rows = [];
      await expect(async () => {
        for await (const value of parsed.rowsAsync!) rows.push(value);
      }).rejects.toMatchObject({ code: 'csv.parse_error' });
      expect(rows).toEqual([]);
    }
  );

  it('propagates a late malformed record and closes the source after earlier rows', async () => {
    let closed = false;
    const name = 'Alice'.padEnd(6000, 'x');
    async function* chunks() {
      try {
        yield `Name,Age\n${`${name},30\n`.repeat(200)}`;
        yield '"unfinished';
      } finally {
        closed = true;
      }
    }
    const parsed = (
      await new PapaparseCsvParser().parseAsync({ type: 'stream', data: chunks() })
    )._unsafeUnwrap();
    let consumed = 0;
    await expect(async () => {
      for await (const row of parsed.rowsAsync!) {
        expect(row).toEqual({ Name: name, Age: '30' });
        consumed++;
      }
    }).rejects.toMatchObject({ code: 'csv.parse_error' });
    expect(consumed).toBe(200);
    expect(closed).toBe(true);
  });

  it('waits for the next chunk after a closing quote followed by whitespace', async () => {
    const warmup = `${'Warmup'.padEnd(6000, 'x')},20\n`;
    async function* chunks() {
      yield `Name,Age\n${warmup.repeat(200)}`;
      yield '"Alice" ';
      yield ',30\n';
    }
    const parsed = (
      await new PapaparseCsvParser().parseAsync({ type: 'stream', data: chunks() })
    )._unsafeUnwrap();
    const rows = [];
    for await (const row of parsed.rowsAsync!) rows.push(row);
    expect(rows).toHaveLength(201);
    expect(rows[200]).toEqual({ Name: 'Alice', Age: '30' });
  });

  it('parses byte-split quoted rows after the initial block and a record larger than a block', async () => {
    const largeNote = 'x'.repeat(1024 * 1024 + 70_000);
    async function* chunks() {
      yield `Name,Note\r\nWarmup,"${largeNote}\r\nend"\r\n`;
      for (const byte of new TextEncoder().encode(
        '"张三","hello\r\nworld ""quoted"""\r\n李四,last'
      )) {
        yield Uint8Array.of(byte);
      }
    }
    const result = await new PapaparseCsvParser().parseAsync({ type: 'stream', data: chunks() });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const rows = [];
    for await (const row of result.value.rowsAsync!) rows.push(row);
    expect(rows).toEqual([
      { Name: 'Warmup', Note: `${largeNote}\r\nend` },
      { Name: '张三', Note: 'hello\r\nworld "quoted"' },
      { Name: '李四', Note: 'last' },
    ]);
  });

  it('closes upstream when the consumer throws into the row iterator', async () => {
    let closed = false;
    async function* chunks() {
      try {
        yield 'Name,Age\n';
        while (true) yield 'Alice,30\n';
      } finally {
        closed = true;
      }
    }
    const result = await new PapaparseCsvParser().parseAsync({ type: 'stream', data: chunks() });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const iterator = result.value.rowsAsync![Symbol.asyncIterator]();
    const failure = new Error('synthetic consumer failure');
    expect(iterator.throw).toBeDefined();
    if (iterator.throw) await expect(iterator.throw(failure)).rejects.toBe(failure);
    expect(closed).toBe(true);
  });

  it('preserves no-header, custom delimiter and blank-record options asynchronously', async () => {
    const result = await new PapaparseCsvParser().parseAsync(
      { type: 'string', data: ' A || 1 \r\n\r\n B || 2 ' },
      { hasHeader: false, delimiter: '||', skipEmptyLines: false }
    );
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const rows = [];
    for await (const row of result.value.rowsAsync!) rows.push(row);
    expect(result.value.headers).toEqual(['Column_1', 'Column_2']);
    expect(rows).toEqual([
      { ['Column_1']: 'A', ['Column_2']: '1' },
      { ['Column_1']: '', ['Column_2']: '' },
      { ['Column_1']: 'B', ['Column_2']: '2' },
    ]);
  });

  it('detects separators from complete records rather than an unfinished sample row', async () => {
    const longName = 'x'.repeat(70_000);
    async function* chunks() {
      yield `Name;Age\n${longName};30\nBob;40`;
    }
    const result = await new PapaparseCsvParser().parseAsync({ type: 'stream', data: chunks() });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const rows = [];
    for await (const row of result.value.rowsAsync!) rows.push(row);
    expect(result.value.headers).toEqual(['Name', 'Age']);
    expect(rows).toEqual([
      { Name: longName, Age: '30' },
      { Name: 'Bob', Age: '40' },
    ]);
  });

  it('waits for a complete long data record before resolving an ambiguous header', async () => {
    const longName = 'x'.repeat(70_000);
    const result = await new PapaparseCsvParser().parseAsync({
      type: 'string',
      data: `name,full;age\n${longName};30\nBob;40`,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    const rows = [];
    for await (const row of result.value.rowsAsync!) rows.push(row);
    expect(result.value.headers).toEqual(['name,full', 'age']);
    expect(rows).toEqual([
      { ['name,full']: longName, age: '30' },
      { ['name,full']: 'Bob', age: '40' },
    ]);
  });

  it('resolves an ambiguous header across chunks without mistaking quoted newlines for records', async () => {
    const longName = 'x'.repeat(70_000);
    let closed = false;
    async function* chunks() {
      try {
        yield '\r\nname,full;note\r';
        yield '\n';
        yield longName.slice(0, 65_536);
        yield longName.slice(65_536);
        yield ';"first\r';
        yield '\nsecond "';
        yield '"quoted"';
        yield '""\r';
        yield '\n';
        yield 'Bob;last';
      } finally {
        closed = true;
      }
    }
    const result = await new PapaparseCsvParser().parseAsync({ type: 'stream', data: chunks() });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.headers).toEqual(['name,full', 'note']);
    const iterator = result.value.rowsAsync![Symbol.asyncIterator]();
    try {
      expect((await iterator.next()).value).toEqual({
        ['name,full']: longName,
        note: 'first\r\nsecond "quoted"',
      });
      expect((await iterator.next()).value).toEqual({ ['name,full']: 'Bob', note: 'last' });
    } finally {
      await iterator.return?.();
    }
    expect(closed).toBe(true);
  });

  it('keeps a stronger quoted delimiter candidate beyond ten apparent physical rows', async () => {
    const lines = `${'x'.repeat(100)},y\n`.repeat(12);
    const quoted = `${lines}${'z'.repeat(70_000)}`;
    async function* chunks() {
      yield `name,full;note;age\nAlice;"${lines}`;
      yield `${'z'.repeat(70_000)}";30\nBob;last;40\n`;
    }
    const parsed = (
      await new PapaparseCsvParser().parseAsync({ type: 'stream', data: chunks() })
    )._unsafeUnwrap();
    const rows = [];
    for await (const row of parsed.rowsAsync!) rows.push(row);
    expect(parsed.headers).toEqual(['name,full', 'note', 'age']);
    expect(rows).toEqual([
      { ['name,full']: 'Alice', note: quoted, age: '30' },
      { ['name,full']: 'Bob', note: 'last', age: '40' },
    ]);
  });

  it.each([
    {
      prefix: 'name;full,age\n"Alice",30\n',
      tail: 'Bob,40\n',
      headers: ['name;full', 'age'],
      first: { ['name;full']: 'Alice', age: '30' },
    },
    {
      prefix: 'name,full;note;age\nAlice;"foo,""bar""";30\n',
      tail: 'Bob;last;40\n',
      headers: ['name,full', 'note', 'age'],
      first: { ['name,full']: 'Alice', note: 'foo,"bar"', age: '30' },
    },
    {
      prefix: 'name;full,age\nBob;"Alice,30\n',
      tail: 'Bob;last,40\n',
      headers: ['name;full', 'age'],
      first: { ['name;full']: 'Bob;"Alice', age: '30' },
    },
    {
      prefix: 'name;full;extra,age\nBob;"Alice,30\n',
      tail: 'Bob;last,40\n',
      headers: ['name;full;extra', 'age'],
      first: { ['name;full;extra']: 'Bob;"Alice', age: '30' },
    },
  ])(
    'preserves values when an alternative delimiter remains ambiguous until EOF: $headers',
    async ({ prefix, tail, headers, first }) => {
      let closed = false;
      async function* chunks() {
        try {
          yield prefix;
          for (let index = 0; index < 10_000; index++) {
            yield tail;
          }
        } finally {
          closed = true;
        }
      }
      const parsed = (
        await new PapaparseCsvParser().parseAsync({ type: 'stream', data: chunks() })
      )._unsafeUnwrap();
      const iterator = parsed.rowsAsync![Symbol.asyncIterator]();
      try {
        expect(parsed.headers).toEqual(headers);
        expect((await iterator.next()).value).toEqual(first);
      } finally {
        await iterator.return?.();
      }
      expect(closed).toBe(true);
    }
  );

  it('preserves comma precedence when a quoted field spans many apparent semicolon rows', async () => {
    const lines = `${'x'.repeat(100)};y\n`.repeat(12);
    const value = `${lines}${'z'.repeat(70_000)}`;
    async function* chunks() {
      yield `name;full,age\nAlice,"${lines}`;
      yield `${'z'.repeat(70_000)}"\nBob,40\n`;
    }
    const parsed = (
      await new PapaparseCsvParser().parseAsync({ type: 'stream', data: chunks() })
    )._unsafeUnwrap();
    const rows = [];
    for await (const row of parsed.rowsAsync!) rows.push(row);
    expect(parsed.headers).toEqual(['name;full', 'age']);
    expect(rows).toEqual([
      { ['name;full']: 'Alice', age: value },
      { ['name;full']: 'Bob', age: '40' },
    ]);
  });

  it.each(['complete', 'early return', 'source error'] as const)(
    'keeps an ambiguous source off the heap and removes its replay files after %s',
    async (mode) => {
      const directory = await mkdtemp(join(tmpdir(), 'teable-csv-replay-test-'));
      vi.spyOn(replayFactory, 'createCsvReplayStore').mockImplementation(() =>
        createNodeCsvReplayStore({ temporaryDirectory: directory })
      );
      setFlagsFromString('--expose_gc');
      const gc: () => void = runInNewContext('gc');
      setFlagsFromString('--no-expose_gc');
      await setImmediate();
      gc();
      const baseline = process.memoryUsage().heapUsed;
      let closed = false;
      let largestGrowth = 0;
      async function* chunks() {
        try {
          yield 'name;full;extra,age\nBob;"Alice,30\n';
          for (let index = 0; index < 16_000; index++) {
            yield `${index}:${'x'.repeat(2048)};last,40\n`;
            if (index % 4000 === 3999) {
              await setImmediate();
              gc();
              largestGrowth = Math.max(largestGrowth, process.memoryUsage().heapUsed - baseline);
              if (mode === 'source error') throw new Error('synthetic source failure');
            }
          }
        } finally {
          closed = true;
        }
      }
      try {
        const result = await new PapaparseCsvParser().parseAsync({
          type: 'stream',
          data: chunks(),
        });
        if (mode === 'source error') {
          expect(result._unsafeUnwrapErr().message).toContain('synthetic source failure');
        } else {
          const parsed = result._unsafeUnwrap();
          expect(parsed.headers).toEqual(['name;full;extra', 'age']);
          let count = 0;
          let last: Record<string, string> | undefined;
          for await (const row of parsed.rowsAsync!) {
            if (count === 0) expect(row).toEqual({ ['name;full;extra']: 'Bob;"Alice', age: '30' });
            count++;
            last = row;
            if (mode === 'early return') break;
          }
          expect(count).toBe(mode === 'early return' ? 1 : 16_001);
          if (mode === 'complete')
            expect(last).toEqual({
              ['name;full;extra']: `15999:${'x'.repeat(2048)};last`,
              age: '40',
            });
        }
        expect(largestGrowth).toBeLessThan(16 * 1024 * 1024);
        expect(closed).toBe(true);
        expect(await readdir(directory)).toEqual([]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    120_000
  );

  it.each([undefined, ','])(
    'retains the terminal empty record at the 1 MiB sample boundary with delimiter %s',
    async (delimiter) => {
      const value = 'x'.repeat(1024 * 1024 - 1);
      const result = await new PapaparseCsvParser().parseAsync(
        { type: 'string', data: `${value}\n` },
        { hasHeader: false, skipEmptyLines: false, delimiter }
      );
      expect(result.isOk()).toBe(true);
      if (result.isErr()) return;
      const rows = [];
      for await (const row of result.value.rowsAsync!) rows.push(row);
      expect(rows).toEqual([{ ['Column_1']: value }, { ['Column_1']: '' }]);
    }
  );

  it('does not duplicate the final URL row when the CSV has no trailing newline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(createCsvResponse(['Name,Age\nAlice,30\nBob,40']))
    );

    const parser = new PapaparseCsvParser();
    const result = await parser.parseAsync({
      type: 'url',
      url: 'https://example.com/import.csv',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    const rows = [];
    for await (const row of result.value.rowsAsync ?? []) {
      rows.push(row);
    }

    expect(result.value.headers).toEqual(['Name', 'Age']);
    expect(rows).toEqual([
      { Name: 'Alice', Age: '30' },
      { Name: 'Bob', Age: '40' },
    ]);
  });

  it('parses stream sources through rowsAsync without collecting the payload first', async () => {
    const parser = new PapaparseCsvParser();
    async function* chunks() {
      yield 'Name,Age\n';
      yield 'Alice,30\n';
      yield 'Bob,40';
    }

    const result = await parser.parseAsync({
      type: 'stream',
      data: chunks(),
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    const rows = [];
    for await (const row of result.value.rowsAsync ?? []) {
      rows.push(row);
    }

    expect(result.value.headers).toEqual(['Name', 'Age']);
    expect(rows).toEqual([
      { Name: 'Alice', Age: '30' },
      { Name: 'Bob', Age: '40' },
    ]);
  });

  it('keeps the first row as data when CSV has no header row', () => {
    const parser = new PapaparseCsvParser();
    const result = parser.parse(
      {
        type: 'string',
        data: ['数据首列A,12,true', '数据首列B,15,false'].join('\n'),
      },
      { hasHeader: false }
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.headers).toEqual(['Column_1', 'Column_2', 'Column_3']);
    expect([...result.value.rows]).toEqual([
      { ['Column_1']: '数据首列A', ['Column_2']: '12', ['Column_3']: 'true' },
      { ['Column_1']: '数据首列B', ['Column_2']: '15', ['Column_3']: 'false' },
    ]);
  });
});
