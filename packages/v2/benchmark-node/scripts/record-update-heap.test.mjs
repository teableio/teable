import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  analyzeGraph,
  analyzeSnapshot,
  dominators,
  loadSnapshot,
  main,
  MARKER,
} from './record-update-heap.mjs';

const cliPath = fileURLToPath(new URL('./record-update-heap.mjs', import.meta.url));

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'record-update-heap-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Fixture serializer, deliberately supporting reordered V8 metadata columns.
function snapshot(nodes, edges, { reordered = false } = {}) {
  const strings = [];
  const intern = (value) => {
    let index = strings.indexOf(value);
    if (index === -1) {
      index = strings.length;
      strings.push(value);
    }
    return index;
  };
  const nodeTypes = [
    'synthetic',
    'object',
    'string',
    'array',
    'concatenated string',
    'sliced string',
  ];
  const edgeTypes = ['property', 'element', 'internal', 'weak', 'shortcut', 'hidden'];
  const nodeFields = reordered
    ? ['id', 'edge_count', 'self_size', 'name', 'type']
    : ['type', 'name', 'id', 'self_size', 'edge_count'];
  const edgeFields = reordered
    ? ['to_node', 'name_or_index', 'type']
    : ['type', 'name_or_index', 'to_node'];
  const flatNodes = nodes.flatMap((node, index) => {
    const values = {
      type: nodeTypes.indexOf(node.type ?? (index === 0 ? 'synthetic' : 'object')),
      name: intern(node.name ?? 'Object'),
      id: node.id ?? index * 2 + 1,
      self_size: node.size ?? 1,
      edge_count: edges[index].length,
    };
    return nodeFields.map((field) => values[field]);
  });
  const flatEdges = edges.flatMap((row) =>
    row.flatMap((edge) => {
      const type = edge.type ?? 'property';
      const values = {
        type: edgeTypes.indexOf(type),
        name_or_index:
          type === 'element' || type === 'hidden' ? (edge.name ?? 0) : intern(edge.name ?? 'child'),
        to_node: edge.target * nodeFields.length,
      };
      return edgeFields.map((field) => values[field]);
    })
  );
  return {
    snapshot: {
      meta: {
        node_fields: nodeFields,
        node_types: nodeFields.map((field) => (field === 'type' ? nodeTypes : 'number')),
        edge_fields: edgeFields,
        edge_types: edgeFields.map((field) => (field === 'type' ? edgeTypes : 'number')),
      },
      node_count: nodes.length,
      edge_count: edges.reduce((sum, row) => sum + row.length, 0),
    },
    nodes: flatNodes,
    edges: flatEdges,
    strings,
  };
}

function writeSnapshot(dir, name, data) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(data), { flag: 'wx' });
  return file;
}

function plainGraph(rows, sizes) {
  const offsets = new Uint32Array(rows.length + 1);
  const targets = [];
  for (let node = 0; node < rows.length; node++) {
    targets.push(...rows[node]);
    offsets[node + 1] = targets.length;
  }
  return {
    nodeCount: rows.length,
    offsets,
    targets: Uint32Array.from(targets),
    size: Float64Array.from(sizes),
  };
}

function byOriginalNode(graph) {
  const dom = dominators(graph);
  return Array.from({ length: graph.nodeCount }, (_, node) => {
    const v = dom.dfs[node];
    return { idom: v > 1 ? dom.vertex[dom.idom[v]] : null, retained: v ? dom.retained[v] : null };
  });
}

function markedSnapshot({
  isolateId = 'isolate-a',
  snapshotId = 'snapshot-a',
  groups = true,
  reordered = false,
} = {}) {
  const nodes = [
    { name: '(root)' },
    { name: 'Marker' },
    { name: 'Groups' },
    { name: 'checkpoint', type: 'string' },
    { name: 'Store', size: 10 },
    { name: 'Array', type: 'array', size: 20 },
    { name: 'Row', size: 30 },
    { name: isolateId, type: 'string' },
    { name: snapshotId, type: 'string' },
  ];
  const edges = [
    [{ name: MARKER, target: 1 }],
    [
      { name: 'groups', target: 2 },
      { name: 'stage', target: 3 },
    ],
    groups
      ? [
          { name: 'arbitraryNewRoot', target: 4 },
          { name: 'alias', target: 4 },
        ]
      : [],
    [],
    [{ name: 'states', target: 5 }],
    [{ type: 'element', target: 6 }],
    [],
    [],
    [],
  ];
  if (isolateId !== null) edges[1].push({ name: 'isolateId', target: 7 });
  if (snapshotId !== null) edges[1].push({ name: 'snapshotId', target: 8 });
  return snapshot(nodes, edges, { reordered });
}

function ropeSnapshot(mutate) {
  const nodes = [
    { name: '(root)' },
    { name: 'Marker' },
    { name: 'Groups' },
    { name: '(concatenated string)', type: 'concatenated string' },
    { name: 'phase-', type: 'string' },
    { name: '(concatenated string)', type: 'concatenated string' },
    { name: 'done', type: 'string' },
    { name: '(concatenated string)', type: 'concatenated string' },
    { name: 'isolate-', type: 'string' },
    { name: 'a', type: 'string' },
    { name: '(concatenated string)', type: 'concatenated string' },
    { name: 'snapshot-', type: 'string' },
  ];
  const link = (name, target) => ({ type: 'internal', name, target });
  const edges = [
    [{ name: MARKER, target: 1 }],
    [
      { name: 'groups', target: 2 },
      { name: 'stage', target: 3 },
      { name: 'isolateId', target: 7 },
      { name: 'snapshotId', target: 10 },
    ],
    [],
    [link('first', 4), link('second', 5), link('map', 2)],
    [],
    [link('first', 6), link('second', 6)],
    [],
    [link('first', 8), link('second', 9)],
    [],
    [],
    [link('first', 11), link('second', 9)],
    [],
  ];
  mutate?.(nodes, edges, link);
  return snapshot(nodes, edges);
}

test('nested cons metadata follows actual V8 internal links and allows shared leaves', (t) => {
  const dir = temporary(t);
  const report = analyzeSnapshot(writeSnapshot(dir, 'rope.heapsnapshot', ropeSnapshot()));
  assert.equal(report.stage, 'phase-donedone');
  assert.equal(report.provenance.isolateId, 'isolate-a');
  assert.equal(report.provenance.snapshotId, 'snapshot-a');
});

test('metadata string resolution rejects cycles, ambiguity, unsupported slices and unbounded expansion', (t) => {
  const dir = temporary(t);
  const cases = [
    [
      'cycle',
      (_nodes, edges, link) => {
        edges[5][1] = link('second', 3);
      },
      /Cycle/,
    ],
    [
      'missing',
      (_nodes, edges) => {
        edges[3].shift();
      },
      /Missing first\/second/,
    ],
    [
      'property-not-internal',
      (_nodes, edges) => {
        edges[3][0].type = 'property';
      },
      /Missing first\/second/,
    ],
    [
      'ambiguous',
      (_nodes, edges, link) => {
        edges[3].push(link('first', 4));
      },
      /Ambiguous first/,
    ],
    [
      'slice',
      (nodes) => {
        nodes[3].type = 'sliced string';
      },
      /sliced.*flatten producer/,
    ],
    [
      'characters',
      (nodes) => {
        nodes[4].name = 'x'.repeat(65537);
      },
      /character budget/,
    ],
    [
      'expansion',
      (nodes, edges, link) => {
        let previous = 6;
        for (let i = 0; i < 13; i++) {
          const current = nodes.length;
          nodes.push({ name: '(concatenated string)', type: 'concatenated string' });
          edges.push([link('first', previous), link('second', previous)]);
          previous = current;
        }
        edges[3] = [link('first', previous), link('second', previous)];
      },
      /traversal budget/,
    ],
  ];
  for (const [name, mutate, error] of cases) {
    assert.throws(
      () => analyzeSnapshot(writeSnapshot(dir, `${name}.heapsnapshot`, ropeSnapshot(mutate))),
      error
    );
  }
});

test('diamond shares a reachable child without attributing its retention to either arm', () => {
  assert.deepEqual(byOriginalNode(plainGraph([[1, 2], [3], [3], []], [1, 2, 4, 8])), [
    { idom: null, retained: 15 },
    { idom: 0, retained: 2 },
    { idom: 0, retained: 4 },
    { idom: 0, retained: 8 },
  ]);
});

test('nested dominators accumulate complete subtree sizes', () => {
  assert.deepEqual(byOriginalNode(plainGraph([[1], [2], [3], []], [1, 2, 4, 8])), [
    { idom: null, retained: 15 },
    { idom: 0, retained: 14 },
    { idom: 1, retained: 12 },
    { idom: 2, retained: 8 },
  ]);
});

test('pure graph analysis rejects over-budget node counts before traversal', () => {
  // The fixed budget permits at most 4,194,304 nodes after the 4 KiB allowance.
  // Only offsets are allocated; the guard must run before node columns/traversal.
  const nodeCount = 4_194_305;
  const graph = { nodeCount, offsets: new Uint32Array(nodeCount + 1) };
  assert.throws(() => analyzeGraph(graph), /working-storage budget/);
});

test('cycles terminate and unreachable nodes have no retained attribution', () => {
  assert.deepEqual(
    byOriginalNode(plainGraph([[1], [2, 3], [3], [2, 4], [], [5]], [1, 2, 4, 8, 16, 32])),
    [
      { idom: null, retained: 31 },
      { idom: 0, retained: 30 },
      { idom: 1, retained: 4 },
      { idom: 1, retained: 24 },
      { idom: 3, retained: 16 },
      { idom: null, retained: null },
    ]
  );
});

test('iterative traversal handles deep chains without JS recursion', () => {
  const count = 25000;
  const graph = plainGraph(
    Array.from({ length: count }, (_, i) => (i + 1 < count ? [i + 1] : [])),
    Array(count).fill(1)
  );
  const dom = dominators(graph);
  assert.equal(dom.reachable, count);
  assert.equal(dom.retained[1], count);
  assert.equal(dom.retained[dom.dfs[count - 2]], 2);
});

test('dynamic groups, aliases and child observations use the existing graph', (t) => {
  const dir = temporary(t);
  const graph = loadSnapshot(
    writeSnapshot(dir, 'alias.heapsnapshot', markedSnapshot({ reordered: true }))
  );
  const before = graph.targets.slice();
  const report = analyzeGraph(graph);
  assert.equal(report.schemaVersion, 1);
  assert.deepEqual(
    report.groups.map((group) => group.name),
    ['arbitraryNewRoot', 'alias']
  );
  assert.deepEqual(
    report.groups.map((group) => group.retainedBytes),
    [60, 60]
  );
  assert.equal(report.pairwise[0].sameNode, true);
  assert.equal(report.pairwise[0].retainedIntersectionBytes, 60);
  assert.equal(report.nonOverlappingRetainedUnion.retainedBytes, 60);
  assert.equal(report.nonOverlappingRetainedUnion.retainedNodeCount, 3);
  assert.deepEqual(
    report.observations.map((item) => [item.name, item.retainedBytes]),
    [
      ['arbitraryNewRoot.states', 50],
      ['alias.states', 50],
    ]
  );
  assert.deepEqual(graph.targets, before);
});

test('rejects marker group explosions before pairwise allocation', (t) => {
  const dir = temporary(t);
  const groupCount = 257;
  const data = snapshot(
    [
      { name: '(root)' },
      { name: 'Marker' },
      { name: 'Groups' },
      { name: 'stage', type: 'string' },
      { name: 'isolate-a', type: 'string' },
      { name: 'snapshot-a', type: 'string' },
      { name: 'Shared', size: 10 },
    ],
    [
      [{ name: MARKER, target: 1 }],
      [
        { name: 'groups', target: 2 },
        { name: 'stage', target: 3 },
        { name: 'isolateId', target: 4 },
        { name: 'snapshotId', target: 5 },
      ],
      Array.from({ length: groupCount }, (_, index) => ({ name: `g${index}`, target: 6 })),
      [],
      [],
      [],
      [],
    ]
  );
  assert.throws(
    () => analyzeSnapshot(writeSnapshot(dir, 'groups.heapsnapshot', data)),
    /group limit exceeded/
  );
});

test('a marker alias of a child lowers parent retention, not the child cost', (t) => {
  const dir = temporary(t);
  const data = markedSnapshot();
  // Add result.records as another marker root: Store can no longer dominate it.
  const nf = data.snapshot.meta.node_fields.length;
  const ec = data.snapshot.meta.node_fields.indexOf('edge_count');
  data.nodes[2 * nf + ec]++;
  const extra = [0, data.strings.push('resultRecords') - 1, 5 * nf];
  // Root has 1 edge, marker has 4, and groups originally has 2.
  data.edges.splice((1 + 4 + 2) * 3, 0, ...extra);
  data.snapshot.edge_count++;
  const report = analyzeSnapshot(writeSnapshot(dir, 'split.heapsnapshot', data));
  assert.equal(report.groups.find((group) => group.name === 'arbitraryNewRoot').retainedBytes, 10);
  assert.equal(report.groups.find((group) => group.name === 'resultRecords').retainedBytes, 50);
  assert.equal(report.observations[0].retainedBytes, 50);
  assert.equal(report.nonOverlappingRetainedUnion.retainedBytes, 60);
});

test('weak edges are excluded using metadata, shortcuts remain strong', (t) => {
  const dir = temporary(t);
  const data = snapshot(
    [{ size: 1 }, { size: 2 }, { size: 4 }],
    [
      [
        { type: 'weak', name: 'weakOnly', target: 1 },
        { type: 'shortcut', name: 'global', target: 2 },
      ],
      [],
      [],
    ],
    { reordered: true }
  );
  const graph = loadSnapshot(writeSnapshot(dir, 'weak.heapsnapshot', data));
  assert.equal(graph.weakEdgeCount, 1);
  assert.equal(graph.shortcutEdgeCount, 1);
  assert.equal(graph.strongEdgeCount, 1);
  assert.deepEqual(byOriginalNode(graph), [
    { idom: null, retained: 5 },
    { idom: null, retained: null },
    { idom: 0, retained: 4 },
  ]);
});

test('empty-edge graph parses but analysis rejects missing markers', (t) => {
  const dir = temporary(t);
  const file = writeSnapshot(dir, 'none.heapsnapshot', snapshot([{}], [[]]));
  assert.equal(loadSnapshot(file).strongEdgeCount, 0);
  assert.throws(() => analyzeSnapshot(file), /retention marker/);
});

test('malformed metadata and incomplete arrays fail rather than partially analyzing', (t) => {
  const dir = temporary(t);
  const badMeta = markedSnapshot();
  badMeta.snapshot.meta.node_fields = ['type'];
  assert.throws(
    () => loadSnapshot(writeSnapshot(dir, 'bad-meta.heapsnapshot', badMeta)),
    /metadata/
  );
  const badNodes = markedSnapshot();
  badNodes.nodes.pop();
  assert.throws(() => loadSnapshot(writeSnapshot(dir, 'bad-nodes.heapsnapshot', badNodes)));
  const badType = markedSnapshot();
  badType.nodes[0] = 65000;
  assert.throws(
    () => loadSnapshot(writeSnapshot(dir, 'bad-type.heapsnapshot', badType)),
    /Invalid graph node/
  );
  const badGroups = markedSnapshot();
  badGroups.edges[5] = 3 * badGroups.snapshot.meta.node_fields.length;
  assert.throws(
    () => analyzeSnapshot(writeSnapshot(dir, 'bad-groups.heapsnapshot', badGroups)),
    /marker.groups/
  );
});

test('tiny impossible graph declarations fail before allocating claimed columns', (t) => {
  const dir = temporary(t);
  for (const [name, nodes, edges, error] of [
    ['nodes', 100_000_000, 0, /working-storage budget/],
    ['edges', 1, 100_000_000, /working-storage budget/],
    ['impossible', 1_000_000, 0, /Declared graph cannot fit/],
  ]) {
    const data = markedSnapshot();
    data.snapshot.node_count = nodes;
    data.snapshot.edge_count = edges;
    delete data.nodes;
    delete data.edges;
    const source = writeSnapshot(dir, `${name}.heapsnapshot`, data);
    assert.throws(() => loadSnapshot(source), error);
    if (name === 'nodes') {
      const output = path.join(dir, 'report.json');
      const result = spawnSync(process.execPath, [cliPath, source, output], { encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /^Heap analysis failed\./);
      assert.equal(fs.existsSync(output), false);
    }
  }
});

test('CLI tracking preserves JSON omission semantics for optional prior report fields', (t) => {
  const dir = temporary(t);
  const baseline = analyzeSnapshot(writeSnapshot(dir, 'baseline.heapsnapshot', markedSnapshot()));
  delete baseline.snapshotPath;
  delete baseline.stage;
  const previous = writeSnapshot(dir, 'previous.json', baseline);
  const source = writeSnapshot(
    dir,
    'current.heapsnapshot',
    markedSnapshot({ snapshotId: 'snapshot-b' })
  );
  const output = path.join(dir, 'report.json');
  const result = spawnSync(process.execPath, [cliPath, source, output, '--track', previous], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(report.tracking.provenanceMatched, true);
  assert.equal(Object.hasOwn(report.tracking, 'baselineSnapshotPath'), false);
  assert.equal(Object.hasOwn(report.tracking, 'baselineStage'), false);
});

test('snapshot and previous-report file budgets reject sparse oversized files', (t) => {
  const dir = temporary(t);
  for (const [name, bytes, action] of [
    ['snapshot', 1024 ** 3 + 1, (file) => loadSnapshot(file)],
    [
      'previous',
      8 * 1024 ** 2 + 1,
      (file) =>
        main([
          path.join(dir, 'not-read.heapsnapshot'),
          path.join(dir, 'report.json'),
          '--track',
          file,
        ]),
    ],
  ]) {
    const file = path.join(dir, `${name}.json`);
    const fd = fs.openSync(file, 'wx');
    try {
      fs.ftruncateSync(fd, bytes);
    } finally {
      fs.closeSync(fd);
    }
    assert.throws(() => action(file), /file budget/);
  }
  assert.equal(fs.existsSync(path.join(dir, 'report.json')), false);
});

test('metadata, strings and JSON nesting are bounded before reconstruction', (t) => {
  const dir = temporary(t);
  const cases = [
    ['metadata', `{"snapshot":{"padding":[${'0,'.repeat(262_144)}0]}}`, /metadata budget/],
    ['string', `{"strings":["${'x'.repeat(524_288)}"]}`, /string budget/],
    ['skipped-string', `{"ignored":"${'x'.repeat(524_288)}"}`, /string budget/],
    ['captured-depth', `{"snapshot":${'['.repeat(129)}0${']'.repeat(129)}}`, /depth budget/],
    ['skipped-depth', `{"ignored":${'['.repeat(129)}0${']'.repeat(129)}}`, /depth budget/],
  ];
  for (const [name, source, error] of cases) {
    const file = path.join(dir, `${name}.heapsnapshot`);
    fs.writeFileSync(file, source);
    assert.throws(() => loadSnapshot(file), error);
  }
});

test('many empty strings cannot evade the string-table storage budget', (t) => {
  const dir = temporary(t);
  const file = path.join(dir, 'strings.heapsnapshot');
  // Six MiB of JSON exercises the 128 MiB estimate without a huge fixture or
  // allocating actual 128 MiB strings; each entry costs at least 64 budget bytes.
  fs.writeFileSync(file, `{"strings":[${'"",'.repeat(2_097_152)}""]}`);
  assert.throws(() => loadSnapshot(file), /string table exceeds storage budget/);
});

test('pairwise repetition cannot expand report JSON beyond the previous-report budget', (t) => {
  const dir = temporary(t);
  const data = markedSnapshot();
  const nf = data.snapshot.meta.node_fields.length;
  const edgeCountIndex = data.snapshot.meta.node_fields.indexOf('edge_count');
  const extraEdges = [];
  for (let index = 0; index < 16; index++) {
    const name = data.strings.push(`${index}-${'x'.repeat(40_000)}`) - 1;
    extraEdges.push(0, name, 4 * nf);
  }
  const groupEdgeStart = (1 + 4 + 2) * data.snapshot.meta.edge_fields.length;
  data.edges.splice(groupEdgeStart, 0, ...extraEdges);
  data.nodes[2 * nf + edgeCountIndex] += 16;
  data.snapshot.edge_count += 16;
  const source = writeSnapshot(dir, 'pairwise.heapsnapshot', data);
  const output = path.join(dir, 'report.json');
  assert.throws(() => main([source, output]), /report exceeds output budget/);
  assert.equal(fs.existsSync(output), false);
});

test('ignored ancillary JSON accepts nested values without changing analysis', (t) => {
  const dir = temporary(t);
  const data = markedSnapshot({ reordered: true });
  const expected = analyzeGraph(loadSnapshot(writeSnapshot(dir, 'plain.heapsnapshot', data)));
  const source = JSON.stringify(data);
  const ancillary =
    '{"empty":[],"nested":[null,true,false,{"number":-0.25e+2,"text":"a\\n\\u0041\\\"\\\\"}]}';
  const file = path.join(dir, 'ancillary.heapsnapshot');
  fs.writeFileSync(file, `{"ancillary":${ancillary},${source.slice(1, -1)},"tail":1e-3}`);
  assert.deepEqual(analyzeGraph(loadSnapshot(file)), expected);
});

test('ignored ancillary JSON rejects malformed tokens, containers and number spellings', (t) => {
  const dir = temporary(t);
  const source = JSON.stringify(markedSnapshot());
  const invalid = [
    'undefined',
    'NaN',
    'truefalse',
    'nul',
    '+1',
    '01',
    '-01',
    '--1',
    '1.',
    '1e',
    '1e+',
    '[1,,2]',
    '[1 2]',
    '[1,]',
    '[}',
    '{"key" 1}',
    '{key:1}',
    '{"key":}',
    '{"key":1,}',
    '{"key":1 "next":2}',
    '{"key":1]',
    '"bad\\q"',
    '"bad\\u123x"',
    '"bad\ncontrol"',
  ];
  for (const [index, value] of invalid.entries()) {
    const file = path.join(dir, `ancillary-${index}.heapsnapshot`);
    fs.writeFileSync(file, `{"ancillary":${value},${source.slice(1)}`);
    assert.throws(() => loadSnapshot(file), undefined, `accepted ancillary JSON ${index}`);
  }
});

test('graph numeric tokens reject leading zeroes and noninteger spellings', (t) => {
  const dir = temporary(t);
  const source = JSON.stringify(markedSnapshot());
  for (const [index, token] of ['00', '01', '-0', '0.0', '0e0', '+0'].entries()) {
    for (const column of ['nodes', 'edges']) {
      const file = path.join(dir, `${column}-${index}.heapsnapshot`);
      fs.writeFileSync(file, source.replace(`"${column}":[0,`, `"${column}":[${token},`));
      assert.throws(() => loadSnapshot(file), undefined, `accepted ${column} token ${token}`);
    }
  }
});

test('node zero must be the synthetic V8 root before analysis', (t) => {
  const dir = temporary(t);
  const data = markedSnapshot({ reordered: true });
  const type = data.snapshot.meta.node_fields.indexOf('type');
  data.nodes[type] = data.snapshot.meta.node_types[type].indexOf('object');
  const file = writeSnapshot(dir, 'object-root.heapsnapshot', data);
  assert.throws(() => loadSnapshot(file), /synthetic root/);
  assert.throws(() => analyzeSnapshot(file), /synthetic root/);
});

test('malformed ancillary CLI failures remain generic and do not publish a report', (t) => {
  const dir = temporary(t);
  const source = path.join(dir, 'malformed.heapsnapshot');
  const output = path.join(dir, 'report.json');
  fs.writeFileSync(
    source,
    `{"ancillary":{"CUSTOMER-SECRET-SENTINEL":undefined},${JSON.stringify(markedSnapshot()).slice(1)}`
  );
  const result = spawnSync(process.execPath, [cliPath, source, output], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Heap analysis failed\./);
  assert.equal(result.stderr.includes('CUSTOMER-SECRET-SENTINEL'), false);
  assert.equal(fs.existsSync(output), false);
});

test('tracking fails closed across isolates, absent provenance and repeated snapshots', (t) => {
  const dir = temporary(t);
  const report = analyzeSnapshot(writeSnapshot(dir, 'baseline.heapsnapshot', markedSnapshot()));
  for (const [name, options] of [
    ['cross', { isolateId: 'other-isolate', snapshotId: 'snapshot-b' }],
    ['absent', { isolateId: null, snapshotId: null }],
    ['repeated', {}],
  ]) {
    const file = writeSnapshot(dir, `${name}.heapsnapshot`, markedSnapshot(options));
    assert.throws(() => analyzeSnapshot(file, { previous: report }), /same-isolate provenance/);
  }
  const old = analyzeSnapshot(
    writeSnapshot(dir, 'old.heapsnapshot', markedSnapshot({ isolateId: null, snapshotId: null }))
  );
  assert.equal(old.provenance, null);
  const current = writeSnapshot(
    dir,
    'new.heapsnapshot',
    markedSnapshot({ snapshotId: 'snapshot-b' })
  );
  assert.throws(() => analyzeSnapshot(current, { previous: old }), /same-isolate provenance/);
});

test('tracking accepts 256 previous groups but rejects oversized reports before reconstruction', (t) => {
  const dir = temporary(t);
  const baseline = analyzeSnapshot(writeSnapshot(dir, 'baseline.heapsnapshot', markedSnapshot()));
  const current = writeSnapshot(
    dir,
    'current.heapsnapshot',
    markedSnapshot({ snapshotId: 'snapshot-b' })
  );
  const previous = {
    ...baseline,
    groups: Array.from({ length: 256 }, (_, index) => ({
      ...baseline.groups[0],
      name: `alias-${index}`,
    })),
  };
  assert.equal(analyzeSnapshot(current, { previous }).tracking.groups.length, 256);
  previous.groups.push({ ...baseline.groups[0], name: 'one-too-many' });
  assert.throws(() => analyzeSnapshot(current, { previous }), /Invalid tracking report schema/);
});

test('partial provenance and non-string marker metadata are rejected', (t) => {
  const dir = temporary(t);
  assert.throws(
    () =>
      analyzeSnapshot(
        writeSnapshot(dir, 'partial.heapsnapshot', markedSnapshot({ isolateId: null }))
      ),
    /both isolateId and snapshotId/
  );
  const data = markedSnapshot();
  data.nodes[3 * data.snapshot.meta.node_fields.length] = 1;
  assert.throws(
    () => analyzeSnapshot(writeSnapshot(dir, 'bad-stage.heapsnapshot', data)),
    /must contain strings/
  );
});

test('CLI refuses overwrite, keeps private output and never echoes heap strings', (t) => {
  const dir = temporary(t);
  const data = markedSnapshot();
  data.strings[data.strings.indexOf('checkpoint')] = 'CUSTOMER-SECRET-SENTINEL';
  const source = writeSnapshot(dir, 'input.heapsnapshot', data);
  const output = path.join(dir, 'report.json');
  const run = spawnSync(process.execPath, [cliPath, source, output], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.includes('CUSTOMER-SECRET-SENTINEL'), false);
  assert.deepEqual(Object.keys(JSON.parse(run.stdout)), ['nodeCount', 'groups', 'trackedGroups']);
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  const bytes = fs.readFileSync(output);
  const overwrite = spawnSync(process.execPath, [cliPath, source, output], { encoding: 'utf8' });
  assert.equal(overwrite.status, 1);
  assert.deepEqual(fs.readFileSync(output), bytes);
  const sameInput = spawnSync(process.execPath, [cliPath, source, source], { encoding: 'utf8' });
  assert.equal(sameInput.status, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(source, 'utf8')), data);
  const invalidOutput = path.join(dir, 'failed.json');
  const failure = spawnSync(process.execPath, [cliPath, source, invalidOutput, '--track', source], {
    encoding: 'utf8',
  });
  assert.equal(failure.status, 1);
  assert.equal(failure.stderr.includes('CUSTOMER-SECRET-SENTINEL'), false);
  assert.equal(fs.existsSync(invalidOutput), false);
});

test('CLI rejects shared directories and private children below a replaceable ancestor', (t) => {
  const dir = temporary(t);
  const source = writeSnapshot(dir, 'input.heapsnapshot', markedSnapshot());
  const shared = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'record-update-shared-'));
  t.after(() => fs.rmSync(shared, { recursive: true, force: true }));
  fs.chmodSync(shared, 0o777);
  const privateChild = fs.mkdtempSync(path.join(shared, 'private-'));
  for (const directory of [shared, privateChild]) {
    const output = path.join(directory, 'report.json');
    assert.throws(() => main([source, output]), /owner-only|directly under \/tmp/);
    assert.equal(fs.existsSync(output), false);
  }
});

test('failed analysis never unlinks a replacement of its original output inode', (t) => {
  const dir = temporary(t);
  const source = path.join(dir, 'malformed.heapsnapshot');
  const output = path.join(dir, 'report.json');
  fs.writeFileSync(source, '{"ignored":undefined}');
  const code = `
    import fs from 'node:fs';
    import assert from 'node:assert/strict';
    import { main } from ${JSON.stringify(new URL('./record-update-heap.mjs', import.meta.url).href)};
    const read = fs.readSync;
    let replaced = false;
    fs.readSync = (...args) => {
      if (!replaced) {
        replaced = true;
        fs.unlinkSync(${JSON.stringify(output)});
        fs.writeFileSync(${JSON.stringify(output)}, 'replacement');
      }
      return read(...args);
    };
    assert.throws(() => main(${JSON.stringify([source, output])}), /Invalid JSON value/);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(output, 'utf8'), 'replacement');
});

test('stdout failure after report publication preserves the completed private report', (t) => {
  const dir = temporary(t);
  const source = writeSnapshot(dir, 'input.heapsnapshot', markedSnapshot());
  const output = path.join(dir, 'report.json');
  const code = `
    import assert from 'node:assert/strict';
    import { main } from ${JSON.stringify(new URL('./record-update-heap.mjs', import.meta.url).href)};
    process.stdout.write = () => { throw new Error('stdout unavailable'); };
    assert.throws(() => main(${JSON.stringify([source, output])}), /stdout unavailable/);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).stage, 'checkpoint');
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
});

test('importing the analyzer has no CLI or filesystem side effects', (t) => {
  const dir = temporary(t);
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(new URL('./record-update-heap.mjs', import.meta.url).href)});`,
    ],
    { encoding: 'utf8', cwd: dir }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('prototype property is structural while node index zero remains a valid named target', (t) => {
  const dir = temporary(t);
  const data = markedSnapshot();
  const nf = data.snapshot.meta.node_fields.length;
  const ec = data.snapshot.meta.node_fields.indexOf('edge_count');
  data.nodes[2 * nf + ec] += 2;
  const protoName = data.strings.push('__proto__') - 1;
  const rootName = data.strings.push('syntheticRootObservation') - 1;
  data.edges.splice((1 + 4 + 2) * 3, 0, 0, protoName, 4 * nf, 0, rootName, 0);
  data.snapshot.edge_count += 2;
  const report = analyzeSnapshot(writeSnapshot(dir, 'prototype.heapsnapshot', data));
  assert.equal(
    report.groups.some((group) => group.name === '__proto__'),
    false
  );
  assert.deepEqual(report.instrumentation.ignoredStructuralProperties, ['__proto__']);
  const root = report.groups.find((group) => group.name === 'syntheticRootObservation');
  assert.equal(root.nodeIndex, 0);
  assert.equal(root.retainedBytes, report.graph.rootReachableSelfBytes);
  assert.equal(
    report.nonOverlappingRetainedUnion.retainedBytes,
    report.graph.rootReachableSelfBytes
  );
});

// Opt-in small real-V8 identity experiment, never synthetic-ID collection proof.
// RECORD_UPDATE_HEAP_V8_TEST=1 node --test scripts/record-update-heap.test.mjs
// The producer process exits before analysis so analyzer locals cannot pin objects.
test(
  'real same-isolate sentinel ID survives, then is absent after release',
  { skip: process.env.RECORD_UPDATE_HEAP_V8_TEST !== '1' },
  (t) => {
    const dir = temporary(t);
    const producer = `
    import { writeHeapSnapshot } from 'node:v8';
    import { randomUUID } from 'node:crypto';
    import path from 'node:path';
    const isolateId = randomUUID();
    globalThis.retentionSentinel = { payload: new Array(100).fill(42) };
    function capture(name, retain) {
      globalThis[${JSON.stringify(MARKER)}] = {
        stage: name, isolateId, snapshotId: randomUUID(),
        groups: retain ? { sentinel: globalThis.retentionSentinel } : {},
      };
      global.gc(); global.gc();
      writeHeapSnapshot(path.join(${JSON.stringify(dir)}, name + '.heapsnapshot'));
    }
    capture('first', true);
    capture('second', true);
    delete globalThis.retentionSentinel;
    delete globalThis[${JSON.stringify(MARKER)}];
    capture('released', false);
  `;
    const result = spawnSync(
      process.execPath,
      ['--expose-gc', '--input-type=module', '-e', producer],
      { encoding: 'utf8', timeout: 60000 }
    );
    assert.equal(result.status, 0, result.stderr);
    const first = analyzeSnapshot(path.join(dir, 'first.heapsnapshot'));
    const second = analyzeSnapshot(path.join(dir, 'second.heapsnapshot'), { previous: first });
    assert.equal(second.groups[0].nodeId, first.groups[0].nodeId);
    assert.equal(second.tracking.provenanceMatched, true);
    assert.equal(second.tracking.groups[0].presentInSnapshot, true);
    assert.equal(second.tracking.groups[0].rootReachableWithoutInstrumentation, true);
    const released = analyzeSnapshot(path.join(dir, 'released.heapsnapshot'), { previous: first });
    assert.equal(released.tracking.groups[0].status, 'missing');
    assert.equal(released.tracking.groups[0].presentInSnapshot, false);
  }
);
