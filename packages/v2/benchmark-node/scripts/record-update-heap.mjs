import fs from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MARKER = '__TEABLE_RECORD_UPDATE_RETENTION_ROOTS__';
export const SCHEMA_VERSION = 1;
const MAX_GROUPS = 256;
const MAX_OBSERVATIONS = 1024;
const MAX_SNAPSHOT_BYTES = 1024 ** 3;
const MAX_GRAPH_BYTES = 1024 ** 3;
const MAX_METADATA_BYTES = 1024 ** 2;
const MAX_STRING_BYTES = 1024 ** 2;
const MAX_STRING_TABLE_BYTES = 128 * 1024 ** 2;
const MAX_PREVIOUS_BYTES = 8 * 1024 ** 2;
const MAX_JSON_DEPTH = 128;

// Conservative working-storage estimate, not just the input columns: all node
// columns, DFS/Lengauer-Tarjan/Euler arrays, predecessor CSR, both tracking BFS
// workspaces and allowance for node-index sets. Edges include input columns and
// predecessor indices. String storage is separately bounded below.
function checkGraphBudget(nodeCount, edgeCount) {
  if (256 * nodeCount + 16 * edgeCount + 4096 > MAX_GRAPH_BYTES)
    throw new Error('Heap graph exceeds working-storage budget');
}

// Stream the large numeric arrays directly into columns, rather than constructing
// a JS object for every node/edge or holding the entire JSON source in memory.
class JsonReader {
  constructor(path, maxBytes = MAX_SNAPSHOT_BYTES) {
    this.fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    try {
      const stat = fs.fstatSync(this.fd);
      if (!stat.isFile() || stat.size > maxBytes)
        throw new Error('Heap JSON input exceeds file budget or is not a regular file');
      this.maxBytes = maxBytes;
      this.fileBytes = stat.size;
      this.bytesRead = 0;
      this.buffer = Buffer.allocUnsafe(1024 * 1024);
      this.text = '';
      this.pos = 0;
      this.eof = false;
      this.decoder = new TextDecoder('utf-8', { fatal: true });
    } catch (error) {
      fs.closeSync(this.fd);
      throw error;
    }
  }
  fill() {
    if (this.pos < this.text.length) return true;
    if (this.eof) return false;
    const n = fs.readSync(this.fd, this.buffer, 0, this.buffer.length, null);
    this.bytesRead += n;
    if (this.bytesRead > this.maxBytes) throw new Error('Heap JSON input exceeds file budget');
    this.text = this.decoder.decode(this.buffer.subarray(0, n), { stream: n !== 0 });
    this.pos = 0;
    if (n === 0) this.eof = true;
    return this.text.length !== 0 || (!this.eof && this.fill());
  }
  peek() {
    return this.fill() ? this.text.charCodeAt(this.pos) : -1;
  }
  take() {
    const c = this.peek();
    if (c !== -1) this.pos++;
    return c;
  }
  ws() {
    while (this.peek() === 32 || this.peek() === 10 || this.peek() === 13 || this.peek() === 9)
      this.pos++;
  }
  expect(c) {
    this.ws();
    if (this.take() !== c.charCodeAt(0))
      throw new Error(`Expected ${JSON.stringify(c)} in heap JSON`);
  }
  string() {
    this.ws();
    if (this.take() !== 34) throw new Error('Expected JSON string');
    const parts = ['"'];
    let escaped = false;
    let bytes = 2;
    while (this.fill()) {
      const start = this.pos;
      while (this.pos < this.text.length) {
        const c = this.text.charCodeAt(this.pos++);
        // Bound the encoded token before collecting or JSON.parse-ing it. Two
        // bytes per UTF-16 code unit also bounds the temporary JS source text.
        bytes += 2;
        if (bytes > MAX_STRING_BYTES) throw new Error('JSON string exceeds string budget');
        if (escaped) escaped = false;
        else if (c === 92) escaped = true;
        else if (c === 34) {
          parts.push(this.text.slice(start, this.pos));
          return JSON.parse(parts.join(''));
        }
      }
      parts.push(this.text.slice(start, this.pos));
    }
    throw new Error('Unterminated JSON string');
  }
  integer() {
    this.ws();
    let c = this.peek(),
      value = 0,
      seen = false;
    const leadingZero = c === 48;
    while (c >= 48 && c <= 57) {
      seen = true;
      value = value * 10 + c - 48;
      this.pos++;
      c = this.peek();
      if (leadingZero && c >= 48 && c <= 57) throw new Error('Leading zero in graph integer');
    }
    if (!seen || !Number.isSafeInteger(value)) throw new Error('Expected safe unsigned integer');
    return value;
  }
  skipString() {
    this.expect('"');
    let bytes = 2;
    while (true) {
      const c = this.take();
      bytes += 2;
      if (bytes > MAX_STRING_BYTES) throw new Error('JSON string exceeds string budget');
      if (c === 34) return;
      if (c < 32) throw new Error('Invalid JSON string');
      if (c !== 92) continue;
      const escape = this.take();
      bytes += 2;
      if (escape === 117) {
        for (let i = 0; i < 4; i++) {
          const hex = this.take();
          bytes += 2;
          if (bytes > MAX_STRING_BYTES) throw new Error('JSON string exceeds string budget');
          if (!((hex >= 48 && hex <= 57) || (hex >= 65 && hex <= 70) || (hex >= 97 && hex <= 102)))
            throw new Error('Invalid JSON Unicode escape');
        }
      } else if (
        escape !== 34 &&
        escape !== 92 &&
        escape !== 47 &&
        escape !== 98 &&
        escape !== 102 &&
        escape !== 110 &&
        escape !== 114 &&
        escape !== 116
      ) {
        throw new Error('Invalid JSON escape');
      }
    }
  }
  skipNumber() {
    if (this.peek() === 45) this.take();
    let c = this.peek();
    if (c === 48) {
      this.take();
      c = this.peek();
      if (c >= 48 && c <= 57) throw new Error('Leading zero in JSON number');
    } else {
      if (c < 49 || c > 57) throw new Error('Invalid JSON number');
      do {
        this.take();
        c = this.peek();
      } while (c >= 48 && c <= 57);
    }
    if (c === 46) {
      this.take();
      c = this.peek();
      if (c < 48 || c > 57) throw new Error('Invalid JSON fraction');
      do {
        this.take();
        c = this.peek();
      } while (c >= 48 && c <= 57);
    }
    if (c === 101 || c === 69) {
      this.take();
      c = this.peek();
      if (c === 43 || c === 45) {
        this.take();
        c = this.peek();
      }
      if (c < 48 || c > 57) throw new Error('Invalid JSON exponent');
      do {
        this.take();
        c = this.peek();
      } while (c >= 48 && c <= 57);
    }
  }
  skipValue() {
    // Only nesting state is retained; ancillary strings, arrays and objects are
    // validated without allocating their contents or using the JS call stack.
    const states = ['value'];
    while (states.length) {
      if (states.length > MAX_JSON_DEPTH) throw new Error('JSON nesting exceeds depth budget');
      const state = states.pop();
      this.ws();
      const c = this.peek();
      if (state === 'array-first' && c === 93) {
        this.take();
      } else if (state === 'array-first' || state === 'array-next') {
        if (state === 'array-next') {
          if (c === 93) {
            this.take();
            continue;
          }
          this.expect(',');
        }
        states.push('array-next', 'value');
      } else if (state === 'object-first' && c === 125) {
        this.take();
      } else if (state === 'object-first' || state === 'object-next') {
        if (state === 'object-next') {
          if (c === 125) {
            this.take();
            continue;
          }
          this.expect(',');
        }
        this.skipString();
        this.expect(':');
        states.push('object-next', 'value');
      } else if (c === 123 || c === 91) {
        this.take();
        states.push(c === 123 ? 'object-first' : 'array-first');
      } else if (c === 34) {
        this.skipString();
      } else if (c === 45 || (c >= 48 && c <= 57)) {
        this.skipNumber();
      } else {
        const literal = c === 116 ? 'true' : c === 102 ? 'false' : c === 110 ? 'null' : '';
        if (!literal) throw new Error('Invalid JSON value');
        for (let i = 0; i < literal.length; i++) {
          if (this.take() !== literal.charCodeAt(i)) throw new Error('Invalid JSON literal');
        }
      }
    }
  }
  // Used only for metadata (capture=true) and ignored ancillary snapshot sections.
  value(capture = false, maxBytes = MAX_METADATA_BYTES) {
    if (!capture) return this.skipValue();
    this.ws();
    const first = this.peek();
    const parts = [];
    let bytes = 0,
      stringBytes = 0;
    let depth = 0,
      inString = false,
      escaped = false,
      started = false;
    while (this.fill()) {
      const start = this.pos;
      while (this.pos < this.text.length) {
        const c = this.text.charCodeAt(this.pos);
        if (
          !inString &&
          depth === 0 &&
          started &&
          (c === 44 || c === 125 || c === 93 || c === 32 || c === 10 || c === 13 || c === 9)
        ) {
          parts.push(this.text.slice(start, this.pos));
          return JSON.parse(parts.join(''));
        }
        bytes += 2;
        if (bytes > maxBytes) throw new Error('Captured JSON exceeds metadata budget');
        if (inString) {
          stringBytes += 2;
          if (stringBytes > MAX_STRING_BYTES) throw new Error('JSON string exceeds string budget');
        } else if (c === 34) stringBytes = 2;
        this.pos++;
        started = true;
        if (inString) {
          if (escaped) escaped = false;
          else if (c === 92) escaped = true;
          else if (c === 34) inString = false;
        } else if (c === 34) inString = true;
        else if (c === 123 || c === 91) {
          if (++depth > MAX_JSON_DEPTH) throw new Error('JSON nesting exceeds depth budget');
        } else if (c === 125 || c === 93) depth--;
        if (!inString && depth === 0 && (first === 123 || first === 91 || first === 34)) {
          parts.push(this.text.slice(start, this.pos));
          return JSON.parse(parts.join(''));
        }
      }
      parts.push(this.text.slice(start, this.pos));
    }
    if (!started || inString || depth !== 0) throw new Error('Truncated JSON value');
    return JSON.parse(parts.join(''));
  }
  close() {
    fs.closeSync(this.fd);
  }
}

function fieldIndex(fields, name) {
  const index = fields.indexOf(name);
  if (index < 0) throw new Error(`Snapshot metadata lacks ${name}`);
  return index;
}
function uintCount(value, label) {
  if (!Number.isInteger(value) || value < 0 || value >= 0xffffffff)
    throw new Error(`Unsupported ${label}`);
  return value;
}

export function loadSnapshot(path) {
  const reader = new JsonReader(path);
  let meta, graph, strings;
  let rawEdgeCounts,
    rawEdgesRead = false,
    nodesRead = false;
  try {
    reader.expect('{');
    let first = true;
    while (true) {
      reader.ws();
      if (reader.peek() === 125) {
        reader.take();
        break;
      }
      if (!first) reader.expect(',');
      first = false;
      const key = reader.string();
      reader.expect(':');
      if (key === 'snapshot') {
        if (meta) throw new Error('Duplicate snapshot metadata');
        meta = reader.value(true);
        if (
          !meta ||
          !meta.meta ||
          !Array.isArray(meta.meta.node_fields) ||
          !Array.isArray(meta.meta.edge_fields) ||
          !Array.isArray(meta.meta.node_types) ||
          !Array.isArray(meta.meta.edge_types)
        )
          throw new Error('Malformed snapshot metadata');
        const nodeCount = uintCount(meta.node_count, 'node count');
        if (nodeCount === 0) throw new Error('Snapshot must have a synthetic root');
        const edgeCount = uintCount(meta.edge_count, 'edge count');
        checkGraphBudget(nodeCount, edgeCount);
        const nodeFields = meta.meta.node_fields;
        const edgeFields = meta.meta.edge_fields;
        const typeIndex = fieldIndex(nodeFields, 'type');
        const edgeTypeIndex = fieldIndex(edgeFields, 'type');
        if (
          new Set(nodeFields).size !== nodeFields.length ||
          new Set(edgeFields).size !== edgeFields.length ||
          !Array.isArray(meta.meta.node_types[typeIndex]) ||
          !Array.isArray(meta.meta.edge_types[edgeTypeIndex])
        )
          throw new Error('Malformed snapshot field metadata');
        // Even single-digit numeric entries need one byte and a separator each.
        // Refuse impossible declarations in tiny files before allocating columns,
        // including declarations that fit the independent working-storage cap.
        const minimumGraphBytes =
          2 * (nodeCount * nodeFields.length + edgeCount * edgeFields.length);
        if (minimumGraphBytes > reader.fileBytes)
          throw new Error('Declared graph cannot fit in the snapshot input');
        graph = {
          nodeCount,
          rawEdgeCount: edgeCount,
          strongEdgeCount: 0,
          weakEdgeCount: 0,
          shortcutEdgeCount: 0,
          strings: [],
          nodeFields,
          edgeFields,
          nodeTypes: meta.meta.node_types[typeIndex],
          edgeTypes: meta.meta.edge_types[edgeTypeIndex],
          type: new Uint16Array(nodeCount),
          name: new Uint32Array(nodeCount),
          id: new Float64Array(nodeCount),
          size: new Float64Array(nodeCount),
          offsets: new Uint32Array(nodeCount + 1),
          targets: new Uint32Array(edgeCount),
          edgeName: new Uint32Array(edgeCount),
          edgeType: new Uint16Array(edgeCount),
        };
        rawEdgeCounts = new Uint32Array(nodeCount);
      } else if (key === 'nodes') {
        if (!graph || nodesRead)
          throw new Error('Expected metadata before exactly one nodes array');
        const nf = graph.nodeFields;
        const columns = new Map([
          [fieldIndex(nf, 'type'), graph.type],
          [fieldIndex(nf, 'name'), graph.name],
          [fieldIndex(nf, 'id'), graph.id],
          [fieldIndex(nf, 'self_size'), graph.size],
          [fieldIndex(nf, 'edge_count'), rawEdgeCounts],
        ]);
        reader.expect('[');
        let count = 0,
          declaredEdges = 0;
        for (let node = 0; node < graph.nodeCount; node++) {
          for (let field = 0; field < nf.length; field++) {
            if (count++) reader.expect(',');
            const value = reader.integer();
            const column = columns.get(field);
            if (column) {
              if (
                !(column instanceof Float64Array) &&
                value > (column instanceof Uint16Array ? 65535 : 0xffffffff)
              )
                throw new Error('Numeric column overflow');
              column[node] = value;
            }
          }
          declaredEdges += rawEdgeCounts[node];
        }
        reader.expect(']');
        if (declaredEdges !== graph.rawEdgeCount)
          throw new Error('Node edge counts do not match metadata');
        nodesRead = true;
      } else if (key === 'edges') {
        if (!nodesRead || rawEdgesRead)
          throw new Error('Expected nodes before exactly one edges array');
        const ef = graph.edgeFields;
        const ti = fieldIndex(ef, 'type'),
          ni = fieldIndex(ef, 'name_or_index'),
          toi = fieldIndex(ef, 'to_node');
        const weakType = graph.edgeTypes.indexOf('weak');
        if (weakType < 0) throw new Error('Snapshot metadata lacks weak edge type');
        reader.expect('[');
        let count = 0,
          strongCount = 0,
          weakCount = 0,
          shortcutCount = 0;
        for (let node = 0; node < graph.nodeCount; node++) {
          graph.offsets[node] = strongCount;
          for (let e = 0; e < rawEdgeCounts[node]; e++) {
            let type, name, targetOffset;
            for (let field = 0; field < ef.length; field++) {
              if (count++) reader.expect(',');
              const value = reader.integer();
              if (field === ti) type = value;
              else if (field === ni) name = value;
              else if (field === toi) targetOffset = value;
            }
            const target = targetOffset / graph.nodeFields.length;
            if (
              !Number.isInteger(target) ||
              target >= graph.nodeCount ||
              !graph.edgeTypes[type] ||
              name > 0xffffffff
            )
              throw new Error('Invalid edge');
            if (type === weakType) {
              weakCount++;
              continue;
            }
            if (graph.edgeTypes[type] === 'shortcut') shortcutCount++;
            graph.targets[strongCount] = target;
            graph.edgeName[strongCount] = name;
            graph.edgeType[strongCount++] = type;
          }
        }
        graph.offsets[graph.nodeCount] = strongCount;
        graph.strongEdgeCount = strongCount;
        graph.weakEdgeCount = weakCount;
        graph.shortcutEdgeCount = shortcutCount;
        reader.expect(']');
        rawEdgesRead = true;
        rawEdgeCounts = null;
      } else if (key === 'strings') {
        if (strings) throw new Error('Duplicate strings array');
        strings = [];
        reader.expect('[');
        let firstString = true;
        let stringBytes = 0;
        while (true) {
          reader.ws();
          if (reader.peek() === 93) {
            reader.take();
            break;
          }
          if (!firstString) reader.expect(',');
          firstString = false;
          const value = reader.string();
          // Include per-entry array/string overhead even for empty strings, so
          // many tiny entries cannot evade the table's storage budget.
          stringBytes += 64 + value.length * 2;
          if (stringBytes > MAX_STRING_TABLE_BYTES)
            throw new Error('Heap string table exceeds storage budget');
          strings.push(value);
        }
      } else reader.value(false);
    }
    reader.ws();
    if (reader.peek() !== -1) throw new Error('Trailing snapshot data');
    if (!graph || !nodesRead || !rawEdgesRead || !strings)
      throw new Error('Incomplete heap snapshot');
    graph.strings = strings;
    validateGraph(graph);
    return graph;
  } finally {
    reader.close();
  }
}

export function dominators(graph) {
  const n = graph.nodeCount;
  const { offsets, targets } = graph;
  const dfs = new Uint32Array(n);
  const vertex = new Uint32Array(n + 1);
  const parent = new Uint32Array(n + 1);
  let reachable = 1,
    reachableEdges = 0;
  dfs[0] = 1;
  vertex[1] = 0;
  // Iterative DFS, with a cursor for each active original node.
  {
    const stack = new Uint32Array(n);
    const cursor = new Uint32Array(n);
    let depth = 0;
    stack[0] = 0;
    cursor[0] = offsets[0];
    while (depth >= 0) {
      const node = stack[depth];
      if (cursor[depth] === offsets[node + 1]) {
        depth--;
        continue;
      }
      const child = targets[cursor[depth]++];
      reachableEdges++;
      if (dfs[child]) continue;
      const childDfs = ++reachable;
      dfs[child] = childDfs;
      vertex[childDfs] = child;
      parent[childDfs] = dfs[node];
      stack[++depth] = child;
      cursor[depth] = offsets[child];
    }
  }
  // Predecessor CSR contains only root-reachable edges, indexed by DFS number.
  const predOffsets = new Uint32Array(reachable + 2);
  for (let v = 1; v <= reachable; v++) {
    const node = vertex[v];
    for (let e = offsets[node]; e < offsets[node + 1]; e++) predOffsets[dfs[targets[e]] + 1]++;
  }
  for (let v = 1; v < predOffsets.length; v++) predOffsets[v] += predOffsets[v - 1];
  const predecessors = new Uint32Array(reachableEdges);
  {
    const cursor = predOffsets.slice();
    for (let v = 1; v <= reachable; v++) {
      const node = vertex[v];
      for (let e = offsets[node]; e < offsets[node + 1]; e++)
        predecessors[cursor[dfs[targets[e]]]++] = v;
    }
  }
  // Lengauer-Tarjan's simple link/eval variant (path compression; no recursion).
  const semi = new Uint32Array(reachable + 1);
  const idom = new Uint32Array(reachable + 1);
  const ancestor = new Uint32Array(reachable + 1);
  const label = new Uint32Array(reachable + 1);
  const bucketHead = new Uint32Array(reachable + 1);
  const bucketNext = new Uint32Array(reachable + 1);
  const path = new Uint32Array(reachable + 1);
  for (let v = 1; v <= reachable; v++) semi[v] = label[v] = v;
  function evaluate(v) {
    if (ancestor[v] === 0) return label[v];
    let count = 0,
      current = v;
    while (ancestor[ancestor[current]] !== 0) {
      path[count++] = current;
      current = ancestor[current];
    }
    while (count) {
      current = path[--count];
      const a = ancestor[current];
      if (semi[label[a]] < semi[label[current]]) label[current] = label[a];
      ancestor[current] = ancestor[a];
    }
    return label[v];
  }
  for (let w = reachable; w >= 2; w--) {
    for (let e = predOffsets[w]; e < predOffsets[w + 1]; e++) {
      const u = evaluate(predecessors[e]);
      if (semi[u] < semi[w]) semi[w] = semi[u];
    }
    bucketNext[w] = bucketHead[semi[w]];
    bucketHead[semi[w]] = w;
    ancestor[w] = parent[w];
    let v = bucketHead[parent[w]];
    bucketHead[parent[w]] = 0;
    while (v !== 0) {
      const u = evaluate(v);
      idom[v] = semi[u] < semi[v] ? u : parent[w];
      v = bucketNext[v];
    }
  }
  for (let w = 2; w <= reachable; w++) if (idom[w] !== semi[w]) idom[w] = idom[idom[w]];
  const retained = new Float64Array(reachable + 1);
  const retainedCount = new Uint32Array(reachable + 1);
  for (let v = 1; v <= reachable; v++) {
    retained[v] = graph.size[vertex[v]];
    retainedCount[v] = 1;
  }
  for (let v = reachable; v >= 2; v--) {
    if (!idom[v] || idom[v] >= v) throw new Error('Invalid immediate dominator order');
    retained[idom[v]] += retained[v];
    retainedCount[idom[v]] += retainedCount[v];
  }
  // Euler intervals allow bounded group attribution without exporting a full tree.
  const firstChild = new Uint32Array(reachable + 1);
  const nextSibling = new Uint32Array(reachable + 1);
  for (let v = 2; v <= reachable; v++) {
    nextSibling[v] = firstChild[idom[v]];
    firstChild[idom[v]] = v;
  }
  const enter = new Uint32Array(reachable + 1);
  const leave = new Uint32Array(reachable + 1);
  let current = 1,
    clock = 0;
  while (current) {
    enter[current] = clock++;
    if (firstChild[current]) {
      current = firstChild[current];
      continue;
    }
    while (current && !nextSibling[current]) {
      leave[current] = clock;
      current = idom[current];
    }
    if (current) {
      leave[current] = clock;
      current = nextSibling[current];
    }
  }
  if (clock !== reachable) throw new Error('Incomplete dominator tree');
  return { dfs, vertex, idom, retained, retainedCount, enter, leave, reachable, reachableEdges };
}

function validateGraph(graph) {
  const n = graph.nodeCount;
  if (
    !Number.isInteger(n) ||
    n < 1 ||
    !(graph.offsets instanceof Uint32Array) ||
    graph.offsets.length !== n + 1 ||
    graph.offsets[0] !== 0
  )
    throw new Error('Invalid graph offsets');
  if (256 * n + 4096 > MAX_GRAPH_BYTES)
    throw new Error('Heap graph exceeds working-storage budget');
  for (const key of ['size', 'id', 'name', 'type']) {
    if (!ArrayBuffer.isView(graph[key]) || graph[key].length !== n)
      throw new Error('Invalid graph node columns');
  }
  if (
    !Array.isArray(graph.strings) ||
    !Array.isArray(graph.nodeTypes) ||
    !Array.isArray(graph.edgeTypes)
  )
    throw new Error('Invalid graph metadata');
  const edgeCount = graph.offsets[n];
  checkGraphBudget(n, edgeCount);
  for (const key of ['targets', 'edgeName', 'edgeType']) {
    if (!ArrayBuffer.isView(graph[key]) || graph[key].length < edgeCount)
      throw new Error('Invalid graph edge columns');
  }
  for (let node = 0; node < n; node++) {
    if (
      graph.offsets[node] > graph.offsets[node + 1] ||
      graph.offsets[node + 1] > edgeCount ||
      !Number.isSafeInteger(graph.id[node]) ||
      graph.id[node] < 0 ||
      !Number.isSafeInteger(graph.size[node]) ||
      graph.size[node] < 0 ||
      typeof graph.nodeTypes[graph.type[node]] !== 'string' ||
      typeof graph.strings[graph.name[node]] !== 'string'
    )
      throw new Error('Invalid graph node');
  }
  if (graph.nodeTypes[graph.type[0]] !== 'synthetic')
    throw new Error('Snapshot node zero must be a synthetic root');
  for (let e = 0; e < edgeCount; e++) {
    const type = graph.edgeTypes[graph.edgeType[e]];
    if (
      graph.targets[e] >= n ||
      typeof type !== 'string' ||
      type === 'weak' ||
      (type !== 'element' &&
        type !== 'hidden' &&
        typeof graph.strings[graph.edgeName[e]] !== 'string')
    )
      throw new Error('Invalid strong graph edge');
  }
}

function properties(graph, node, name) {
  const found = new Set();
  for (let e = graph.offsets[node]; e < graph.offsets[node + 1]; e++) {
    if (
      graph.edgeTypes[graph.edgeType[e]] === 'property' &&
      graph.strings[graph.edgeName[e]] === name
    )
      found.add(graph.targets[e]);
  }
  return [...found];
}

function nodeInfo(graph, dom, node) {
  const v = dom.dfs[node];
  return {
    nodeIndex: node,
    nodeId: graph.id[node],
    type: graph.nodeTypes[graph.type[node]],
    shallowBytes: graph.size[node],
    rootReachable: v !== 0,
    retainedBytes: v ? dom.retained[v] : null,
    retainedNodeCount: v ? dom.retainedCount[v] : null,
    immediateDominatorNodeId: v > 1 ? graph.id[dom.vertex[dom.idom[v]]] : null,
  };
}

// V8 may represent UUIDs and checkpoint names as cons strings. Resolve only the
// serialized first/second internal links; sliced strings omit a portable offset.
// Bound expanded work as well as output length so a shared rope DAG cannot grow
// exponentially, and use an active path rather than rejecting harmless aliases.
function metadataString(graph, start) {
  const parts = [];
  const active = new Set();
  const stack = [{ node: start, exit: false }];
  let expandedNodes = 0;
  let characters = 0;
  while (stack.length) {
    const { node, exit } = stack.pop();
    if (exit) {
      active.delete(node);
      continue;
    }
    if (++expandedNodes > 4096) throw new Error('Marker metadata string exceeds traversal budget');
    const type = graph.nodeTypes[graph.type[node]];
    if (type === 'string') {
      const part = graph.strings[graph.name[node]];
      characters += part.length;
      if (characters > 65536) throw new Error('Marker metadata string exceeds character budget');
      parts.push(part);
      continue;
    }
    if (type === 'sliced string')
      throw new Error(
        'Unsupported sliced marker metadata string; flatten producer strings before taking the snapshot'
      );
    if (type !== 'concatenated string') throw new Error('Marker metadata must contain strings');
    if (active.has(node)) throw new Error('Cycle in marker metadata string');
    let first;
    let second;
    for (let e = graph.offsets[node]; e < graph.offsets[node + 1]; e++) {
      if (graph.edgeTypes[graph.edgeType[e]] !== 'internal') continue;
      const name = graph.strings[graph.edgeName[e]];
      if (name === 'first') {
        if (first !== undefined) throw new Error('Ambiguous first link in marker metadata string');
        first = graph.targets[e];
      } else if (name === 'second') {
        if (second !== undefined)
          throw new Error('Ambiguous second link in marker metadata string');
        second = graph.targets[e];
      }
    }
    if (first === undefined || second === undefined)
      throw new Error('Missing first/second internal links in marker metadata string');
    active.add(node);
    stack.push({ node, exit: true }, { node: second, exit: false }, { node: first, exit: false });
  }
  return parts.join('');
}

function markerMetadata(graph, dom) {
  const markers = new Set();
  let markerEdgeCount = 0;
  for (let node = 0; node < graph.nodeCount; node++) {
    if (!dom.dfs[node]) continue;
    for (let e = graph.offsets[node]; e < graph.offsets[node + 1]; e++) {
      if (
        graph.edgeTypes[graph.edgeType[e]] === 'property' &&
        graph.strings[graph.edgeName[e]] === MARKER
      ) {
        markers.add(graph.targets[e]);
        markerEdgeCount++;
      }
    }
  }
  if (markers.size !== 1)
    throw new Error('Expected exactly one distinct reachable retention marker');
  const markerNode = [...markers][0];
  if (graph.nodeTypes[graph.type[markerNode]] !== 'object')
    throw new Error('Marker must be an object');
  const containers = properties(graph, markerNode, 'groups');
  if (containers.length !== 1 || graph.nodeTypes[graph.type[containers[0]]] !== 'object')
    throw new Error('Expected one marker.groups object');
  function stringProperty(name, required) {
    const nodes = properties(graph, markerNode, name);
    if (!required && nodes.length === 0) return null;
    if (nodes.length !== 1) throw new Error('Marker metadata must contain unambiguous strings');
    const value = metadataString(graph, nodes[0]);
    if (!value.length) throw new Error('Marker metadata strings must not be empty');
    return value;
  }
  const stage = stringProperty('stage', true);
  const isolateId = stringProperty('isolateId', false);
  const snapshotId = stringProperty('snapshotId', false);
  if ((isolateId === null) !== (snapshotId === null))
    throw new Error('Marker provenance requires both isolateId and snapshotId');
  return {
    markerNode,
    groupContainer: containers[0],
    stage,
    markerEdgeCount,
    isolateId,
    snapshotId,
  };
}

function summarize(graph, dom, snapshotPath) {
  const marker = markerMetadata(graph, dom);
  const groups = [];
  const groupNames = new Set();
  for (
    let e = graph.offsets[marker.groupContainer];
    e < graph.offsets[marker.groupContainer + 1];
    e++
  ) {
    if (graph.edgeTypes[graph.edgeType[e]] !== 'property') continue;
    const name = graph.strings[graph.edgeName[e]];
    // V8 serializes the prototype link as a property, not a user root.
    if (name === '__proto__') continue;
    if (groupNames.has(name)) throw new Error('Duplicate marker group name');
    if (groups.length >= MAX_GROUPS)
      throw new Error(`Retention group limit exceeded (maximum ${MAX_GROUPS})`);
    groupNames.add(name);
    groups.push({ name, ...nodeInfo(graph, dom, graph.targets[e]) });
  }
  const dominates = (a, b) =>
    a !== 0 && b !== 0 && dom.enter[a] <= dom.enter[b] && dom.enter[b] < dom.leave[a];
  const pairwise = [];
  for (let a = 0; a < groups.length; a++)
    for (let b = a + 1; b < groups.length; b++) {
      const ga = groups[a],
        gb = groups[b];
      const av = dom.dfs[ga.nodeIndex],
        bv = dom.dfs[gb.nodeIndex];
      const aDom = dominates(av, bv),
        bDom = dominates(bv, av);
      pairwise.push({
        a: ga.name,
        b: gb.name,
        sameNode: ga.nodeIndex === gb.nodeIndex,
        dominatorRelation:
          av === bv
            ? 'same-node'
            : aDom
              ? 'a-dominates-b'
              : bDom
                ? 'b-dominates-a'
                : 'disjoint-retained-subtrees',
        retainedIntersectionBytes: aDom ? gb.retainedBytes : bDom ? ga.retainedBytes : 0,
        reachableClosureOverlap: 'not-computed',
      });
    }
  const unionRoots = groups.filter(
    (group, index) =>
      !groups.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          dominates(dom.dfs[other.nodeIndex], dom.dfs[group.nodeIndex]) &&
          (other.nodeIndex !== group.nodeIndex || otherIndex < index)
      )
  );
  const observations = [];
  for (const group of groups) {
    for (const property of ['states', 'records']) {
      for (const node of properties(graph, group.nodeIndex, property)) {
        if (observations.length >= MAX_OBSERVATIONS)
          throw new Error(`Retention observation limit exceeded (maximum ${MAX_OBSERVATIONS})`);
        observations.push({
          parentGroup: group.name,
          property,
          name: `${group.name}.${property}`,
          ...nodeInfo(graph, dom, node),
        });
      }
    }
  }
  let totalSelfBytes = 0,
    unreachableSelfBytes = 0;
  for (let node = 0; node < graph.nodeCount; node++) {
    totalSelfBytes += graph.size[node];
    if (!dom.dfs[node]) unreachableSelfBytes += graph.size[node];
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    snapshotPath,
    stage: marker.stage,
    provenance:
      marker.isolateId === null
        ? null
        : {
            isolateId: marker.isolateId,
            snapshotId: marker.snapshotId,
            source: 'runtime-marker',
            identityBasis: 'producer-asserted fresh per-isolate nonce; no heap-ID reset',
          },
    algorithm:
      'Lengauer-Tarjan simple link/eval; iterative DFS, predecessor CSR and dominator subtree sums',
    retainedDefinition:
      'Exact self_size sum of root-reachable nodes dominated by the named node in the serialized graph with weak edges excluded.',
    assumptions: [
      'Node index 0 is the synthetic root. Every serialized edge except weak is strong, including shortcuts. This is not DevTools filtering or GC ephemeron semantics.',
      'Marker references can substantially lower individual dominated retention by adding root paths. They do not establish original ownership or uninstrumented lifetime.',
      'Group retained sizes are not additive. The union removes aliases and nested dominated sets; it is NOT collective-removal collectible bytes or a shared reachable-closure union.',
      'Zero retained attribution does not imply a group is unimportant: aliases, shared referents, marker paths and native/external memory limit attribution.',
      'Child observations are existing graph properties, not additional marker roots. They do not affect the graph or the root-group union.',
      'Native/external memory absent from node self_size is excluded. Unreachable nodes have no retained attribution.',
    ],
    metadata: {
      nodeFields: graph.nodeFields,
      edgeFields: graph.edgeFields,
      nodeTypes: graph.nodeTypes,
      edgeTypes: graph.edgeTypes,
    },
    graph: {
      nodeCount: graph.nodeCount,
      totalSelfBytes,
      rawEdgeCount: graph.rawEdgeCount,
      strongEdgeCount: graph.offsets[graph.nodeCount],
      excludedWeakEdgeCount: graph.weakEdgeCount,
      includedShortcutEdgeCount: graph.shortcutEdgeCount,
      rootReachableNodeCount: dom.reachable,
      rootReachableStrongEdgeCount: dom.reachableEdges,
      rootReachableSelfBytes: dom.retained[1],
      unreachableNodeCount: graph.nodeCount - dom.reachable,
      unreachableSelfBytes,
    },
    instrumentation: {
      marker: nodeInfo(graph, dom, marker.markerNode),
      groupsContainer: nodeInfo(graph, dom, marker.groupContainer),
      markerEdgeCount: marker.markerEdgeCount,
      ignoredStructuralProperties: ['__proto__'],
    },
    groups,
    observations,
    pairwise,
    nonOverlappingRetainedUnion: {
      representativeGroups: unionRoots.map((group) => group.name),
      retainedBytes: unionRoots.reduce((sum, group) => sum + group.retainedBytes, 0),
      retainedNodeCount: unionRoots.reduce((sum, group) => sum + group.retainedNodeCount, 0),
    },
  };
}

function trackPreviousGroups(graph, dom, summary, previous) {
  if (
    previous?.schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray(previous.groups) ||
    previous.groups.length > MAX_GROUPS
  )
    throw new Error('Invalid tracking report schema');
  const a = previous.provenance,
    b = summary.provenance;
  if (
    !a ||
    !b ||
    a.source !== 'runtime-marker' ||
    typeof a.isolateId !== 'string' ||
    !a.isolateId ||
    typeof a.snapshotId !== 'string' ||
    !a.snapshotId ||
    a.isolateId !== b.isolateId ||
    a.snapshotId === b.snapshotId
  )
    throw new Error('Tracking requires matching same-isolate provenance and distinct snapshot IDs');
  const wantedIds = new Set();
  for (const group of previous.groups) {
    if (
      !Number.isSafeInteger(group.nodeId) ||
      group.nodeId < 0 ||
      typeof group.name !== 'string' ||
      typeof group.type !== 'string'
    )
      throw new Error('Invalid tracked group');
    wantedIds.add(group.nodeId);
  }
  const found = new Map();
  for (let node = 0; node < graph.nodeCount; node++) {
    if (!wantedIds.has(graph.id[node])) continue;
    if (found.has(graph.id[node])) throw new Error('Duplicate tracked node ID');
    found.set(graph.id[node], node);
  }
  const blockedNodes = new Set([
    summary.instrumentation.marker.nodeIndex,
    summary.instrumentation.groupsContainer.nodeIndex,
  ]);
  // One multi-target BFS per policy, rather than a heap traversal for each group.
  function retainingPaths(nodeSet, excludeInstrumentation) {
    const results = new Map();
    if (!nodeSet.size) return results;
    const parentNodePlusOne = new Uint32Array(graph.nodeCount);
    const parentEdge = new Uint32Array(graph.nodeCount);
    const queue = new Uint32Array(graph.nodeCount);
    parentNodePlusOne[0] = 1;
    let read = 0,
      write = 1;
    const pending = new Set(nodeSet);
    pending.delete(0);
    while (read < write && pending.size) {
      const source = queue[read++];
      for (let e = graph.offsets[source]; e < graph.offsets[source + 1]; e++) {
        const target = graph.targets[e];
        if (parentNodePlusOne[target]) continue;
        if (
          excludeInstrumentation &&
          (blockedNodes.has(target) ||
            (graph.edgeTypes[graph.edgeType[e]] === 'property' &&
              graph.strings[graph.edgeName[e]] === MARKER))
        )
          continue;
        parentNodePlusOne[target] = source + 1;
        parentEdge[target] = e;
        queue[write++] = target;
        pending.delete(target);
      }
    }
    for (const node of nodeSet) {
      if (!parentNodePlusOne[node]) {
        results.set(node, null);
        continue;
      }
      let hops = 0;
      for (let current = node; current !== 0; current = parentNodePlusOne[current] - 1) hops++;
      const edges = [];
      let current = node;
      for (let ordinal = hops; ordinal >= 1; ordinal--) {
        const source = parentNodePlusOne[current] - 1;
        if (hops <= 48 || ordinal <= 8 || ordinal > hops - 40) {
          const e = parentEdge[current];
          const type = graph.edgeTypes[graph.edgeType[e]];
          edges.push({
            ordinalFromRoot: ordinal,
            fromNodeId: graph.id[source],
            edgeType: type,
            edgeNameOrIndex:
              type === 'element' || type === 'hidden'
                ? graph.edgeName[e]
                : graph.strings[graph.edgeName[e]],
            toNodeId: graph.id[current],
          });
        }
        current = source;
      }
      edges.reverse();
      results.set(node, {
        shortestStrongPathEdgeCount: hops,
        instrumentationExcluded: excludeInstrumentation,
        omittedMiddleEdgeCount: Math.max(0, hops - 48),
        edges,
      });
    }
    return results;
  }
  const presentNodes = new Set(found.values());
  const naturalPaths = retainingPaths(presentNodes, true);
  const needingFallback = new Set(
    [...presentNodes].filter((node) => dom.dfs[node] && !naturalPaths.get(node))
  );
  const fallbackPaths = retainingPaths(needingFallback, false);
  return {
    baselineSnapshotPath: previous.snapshotPath,
    baselineStage: previous.stage,
    baselineProvenance: previous.provenance,
    provenanceMatched: true,
    stableHeapIdsIndependentlyValidated: false,
    assumptions: [
      'Identity relies on producer-asserted fresh per-isolate nonce and no heap-ID reset. A matching nonce is not an independent V8 stable-ID experiment.',
      'Missing means absent in this snapshot, not proof of GC cause or timing. Validate V8 stable IDs with the real same-isolate sentinel fixture before lifetime claims.',
      'Marker-free paths exclude the current marker/groups nodes and marker properties, not checkpoint locals or stack roots. Dominators remain those of the original serialized graph.',
      'Paths are shortest strong-edge BFS paths including shortcuts. Long paths show the first 8 and last 40 edges.',
    ],
    groups: previous.groups.map((group) => {
      const node = found.get(group.nodeId);
      if (node === undefined)
        return {
          name: group.name,
          baselineNodeId: group.nodeId,
          status: 'missing',
          presentInSnapshot: false,
          rootReachable: null,
          rootReachableWithoutInstrumentation: null,
          retainedBytes: null,
          retainingPath: null,
        };
      const naturalPath = naturalPaths.get(node);
      return {
        name: group.name,
        baselineNodeId: group.nodeId,
        presentInSnapshot: true,
        status: !dom.dfs[node]
          ? 'present-unreachable'
          : naturalPath
            ? 'present-rooted-without-marker'
            : 'present-rooted-marker-dependent',
        ...nodeInfo(graph, dom, node),
        rootReachableWithoutInstrumentation: naturalPath !== null,
        typeMatchesBaseline: group.type === graph.nodeTypes[graph.type[node]],
        retainingPath: naturalPath || fallbackPaths.get(node) || null,
      };
    }),
  };
}

// Pure entry point: typed-array graph in, report out; neither filesystem nor globals.
// The input graph must already exclude weak edges (loadSnapshot does this).
export function analyzeGraph(graph, { snapshotPath = null, previous } = {}) {
  validateGraph(graph);
  const dom = dominators(graph);
  const summary = summarize(graph, dom, snapshotPath);
  if (previous !== undefined) summary.tracking = trackPreviousGroups(graph, dom, summary, previous);
  return summary;
}

export function analyzeSnapshot(snapshotPath, { previous } = {}) {
  return analyzeGraph(loadSnapshot(snapshotPath), { snapshotPath, previous });
}

// Match the producer's trusted temporary-root policy. Resolve ancestors once and
// use only the canonical pathname for both exclusive creation and error cleanup.
function temporaryOutputPath(input) {
  const path = resolve(input);
  const directory = fs.realpathSync(dirname(path));
  const tmp = fs.realpathSync('/tmp');
  const stat = fs.statSync(directory);
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error('Artifact protection requires POSIX ownership');
  if (directory !== tmp && !directory.startsWith(`${tmp}${sep}`))
    throw new Error('Analysis artifacts must be under /tmp');
  const tmpStat = directory === tmp ? stat : fs.statSync(tmp);
  if (
    !tmpStat.isDirectory() ||
    (tmpStat.uid !== 0 && tmpStat.uid !== uid) ||
    ((tmpStat.mode & 0o022) !== 0 && (tmpStat.mode & 0o1000) === 0)
  )
    throw new Error('Temporary artifact directory must protect entries from replacement');
  if (directory !== tmp) {
    if (dirname(directory) !== tmp)
      throw new Error('Artifact subdirectory must be directly under /tmp');
    if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0)
      throw new Error('Artifact directory must be owned by the current user and owner-only');
  }
  return join(directory, basename(path));
}

function loadPrevious(path) {
  const reader = new JsonReader(path, MAX_PREVIOUS_BYTES);
  try {
    const previous = reader.value(true, MAX_PREVIOUS_BYTES * 2);
    reader.ws();
    if (reader.peek() !== -1) throw new Error('Trailing tracking report data');
    return previous;
  } finally {
    reader.close();
  }
}

// Measure the exact pretty-JSON bytes before constructing the entire output.
// In particular, repeated pairwise names and retaining-path labels must not turn
// a bounded string table into an unbounded serialized report. Each temporary
// encoded string is already bounded by the input string/metadata budgets.
function serializeReport(summary) {
  let bytes = 1; // Final newline.
  function add(count) {
    bytes += count;
    if (bytes > MAX_PREVIOUS_BYTES) throw new Error('Analysis report exceeds output budget');
  }
  function measure(value, depth) {
    if (depth > MAX_JSON_DEPTH) throw new Error('Analysis report exceeds depth budget');
    if (value === null || typeof value !== 'object') {
      add(Buffer.byteLength(value === undefined ? 'null' : JSON.stringify(value)));
      return;
    }
    const array = Array.isArray(value);
    const keys = array ? null : Object.keys(value).filter((key) => value[key] !== undefined);
    const length = array ? value.length : keys.length;
    add(2); // Brackets/braces.
    if (!length) return;
    add(1 + length * (2 * (depth + 1) + 1) + length - 1 + 2 * depth);
    for (let index = 0; index < length; index++) {
      const key = array ? index : keys[index];
      if (!array) add(Buffer.byteLength(JSON.stringify(key)) + 2);
      measure(value[key], depth + 1);
    }
  }
  measure(summary, 0);
  return `${JSON.stringify(summary, null, 2)}\n`;
}

export function main(args = process.argv.slice(2)) {
  if (
    !(args.length === 2 || (args.length === 4 && args[2] === '--track')) ||
    args[0]?.startsWith('--') ||
    args[1]?.startsWith('--')
  )
    throw new Error(
      'Usage: node scripts/record-update-heap.mjs SNAPSHOT OUTPUT [--track PREVIOUS_ANALYSIS]'
    );
  const [snapshotPath, outputPath, , previousPath] = args;
  // Exclusive creation plus a trusted canonical ancestor prevents cross-user
  // pathname replacement between create and cleanup.
  const output = temporaryOutputPath(outputPath);
  const fd = fs.openSync(output, 'wx', 0o600);
  const created = fs.fstatSync(fd);
  let published = false;
  try {
    const previous = previousPath === undefined ? undefined : loadPrevious(previousPath);
    const summary = analyzeSnapshot(snapshotPath, { previous });
    fs.writeFileSync(fd, serializeReport(summary));
    published = true;
    process.stdout.write(
      `${JSON.stringify({ nodeCount: summary.graph.nodeCount, groups: summary.groups.length, trackedGroups: summary.tracking?.groups.length ?? 0 })}\n`
    );
    return summary;
  } catch (error) {
    if (!published) {
      try {
        const current = fs.lstatSync(output);
        if (current.dev === created.dev && current.ino === created.ino) fs.unlinkSync(output);
      } catch {
        // Preserve the analysis error if the original artifact is already gone.
      }
    }
    throw error;
  } finally {
    fs.closeSync(fd);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch {
    // Parser errors and filesystem paths may contain customer material. The report
    // is private on disk; CLI failures deliberately avoid echoing raw input.
    process.stderr.write(
      'Heap analysis failed. Use SNAPSHOT OUTPUT [--track PREVIOUS_ANALYSIS] with a new output path. Require __TEABLE_RECORD_UPDATE_RETENTION_ROOTS__ {stage, groups}; tracking also requires matching per-isolate isolateId and distinct snapshotId strings in both reports. Check snapshot metadata and file access.\n'
    );
    process.exitCode = 1;
  }
}
