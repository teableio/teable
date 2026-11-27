import { FieldType, Relationship } from '@teable/core';
import type { IBaseErdVo } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';
import { ErdDirection, ErdFieldKind, ErdGraph } from './erd-graph';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  EXPANDED_WIDTH,
  computeBaseLayout,
  placeCards,
} from './erd-layout';
import { ErdLineageNodeKind, buildLineage, lineageReach } from './erd-lineage';
import {
  ErdCardinality,
  ErdEdgeKind,
  ErdFlow,
  buildScene,
  cardinalityAt,
  flowAlong,
  routeEdges,
} from './erd-scene';
import { pressable } from './ErdContext';

const field = (id: string, type: FieldType, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  type,
  ...extra,
});

const ref = (from: [string, string], to: [string, string], type: string) => ({
  source: { tableId: from[0], tableName: from[0], fieldId: from[1], fieldName: from[1] },
  target: { tableId: to[0], tableName: to[0], fieldId: to[1], fieldName: to[1] },
  type,
});

// students <-> classes (two-way), scores -> students (one-way), notes has no links
const vo = {
  baseId: 'bse1',
  nodes: [
    {
      id: 'students',
      name: 'Students',
      fields: [
        field('sName', FieldType.SingleLineText, { isPrimary: true }),
        field('sClass', FieldType.Link),
        field('sTeacher', FieldType.SingleLineText, {
          isLookup: true,
          lookupLinkedFieldId: 'sClass',
          lookupFieldId: 'cTeacher',
        }),
        field('sCopied', FieldType.SingleLineText, {
          isLookup: true,
          lookupLinkedFieldId: 'elsewhere',
          lookupFieldId: 'cTeacher',
        }),
        field('sLabel', FieldType.Formula),
      ],
    },
    {
      id: 'classes',
      name: 'Classes',
      fields: [
        field('cName', FieldType.SingleLineText, { isPrimary: true }),
        field('cTeacher', FieldType.SingleLineText),
        field('cStudents', FieldType.Link),
        field('cCount', FieldType.Rollup, { lookupLinkedFieldId: 'cStudents' }),
      ],
    },
    {
      id: 'scores',
      name: 'Scores',
      fields: [
        field('scId', FieldType.AutoNumber, { isPrimary: true }),
        field('scStudent', FieldType.Link),
        field('scLabel', FieldType.Formula),
      ],
    },
    { id: 'notes', name: 'Notes', fields: [field('nTitle', FieldType.SingleLineText)] },
  ],
  edges: [
    {
      ...ref(['classes', 'cStudents'], ['students', 'sClass'], FieldType.Link),
      relationship: Relationship.ManyOne,
      isOneWay: false,
    },
    {
      ...ref(['students', 'sName'], ['scores', 'scStudent'], FieldType.Link),
      relationship: Relationship.ManyOne,
      isOneWay: true,
    },
    ref(['classes', 'cName'], ['students', 'sClass'], FieldType.Link),
    ref(['students', 'sName'], ['classes', 'cStudents'], FieldType.Link),
    ref(['classes', 'cTeacher'], ['students', 'sTeacher'], 'lookup'),
    ref(['classes', 'cTeacher'], ['students', 'sCopied'], 'lookup'),
    ref(['students', 'sName'], ['classes', 'cCount'], FieldType.Rollup),
    ref(['students', 'sTeacher'], ['students', 'sLabel'], FieldType.Formula),
    ref(['students', 'sLabel'], ['scores', 'scLabel'], 'lookup'),
  ],
} as unknown as IBaseErdVo;

describe('ErdGraph', () => {
  const graph = new ErdGraph(vo);

  it('counts the lookups and rollups between two tables, both ways', () => {
    const pair = (x: string, y: string) =>
      graph.pairs.find((p) => [p.a, p.b].sort().join() === [x, y].sort().join())!;
    expect(pair('students', 'classes')).toMatchObject({ lookups: 2, rollups: 1 });
    expect(pair('students', 'scores')).toMatchObject({ lookups: 1, rollups: 0 });
  });

  it('reads links and their relationship from both sides', () => {
    const link = graph.linkOf('cStudents')!;
    expect(link).toBe(graph.linkOf('sClass'));
    expect(graph.relationshipFrom('students', link)).toBe(Relationship.ManyOne);
    expect(graph.relationshipFrom('classes', link)).toBe(Relationship.OneMany);
    expect(graph.linkOf('scStudent')?.fieldB).toBeUndefined();
    expect(graph.pairs.map((p) => `${p.a}|${p.b}`).sort()).toEqual([
      'classes|students',
      'scores|students',
    ]);
  });

  it('reads each end of a link to the same table from its own field, and its lookups', () => {
    const self = new ErdGraph({
      baseId: 'bse3',
      nodes: [
        {
          id: 'staff',
          name: 'Staff',
          fields: [
            field('name', FieldType.SingleLineText, { isPrimary: true }),
            field('manager', FieldType.Link),
            field('reports', FieldType.Link),
            field('managerName', FieldType.SingleLineText, {
              isLookup: true,
              lookupLinkedFieldId: 'manager',
              lookupFieldId: 'name',
            }),
          ],
        },
      ],
      edges: [
        {
          ...ref(['staff', 'reports'], ['staff', 'manager'], FieldType.Link),
          relationship: Relationship.ManyOne,
          isOneWay: false,
        },
        ref(['staff', 'name'], ['staff', 'managerName'], 'lookup'),
      ],
    } as unknown as IBaseErdVo);
    const link = self.linkOf('manager')!;
    expect(self.relationshipFrom('staff', link, 'manager')).toBe(Relationship.ManyOne);
    expect(self.relationshipFrom('staff', link, 'reports')).toBe(Relationship.OneMany);
    expect(self.pairs).toEqual([]);
    expect(self.lookupSource('managerName')).toEqual({ fieldId: 'name', tableId: 'staff' });
  });

  it('keeps a conditional lookup out of the link to its foreign table', () => {
    const conditional = new ErdGraph({
      baseId: 'bse7',
      nodes: [
        { id: 'orders', name: 'Orders', fields: [field('oTotal', FieldType.Number)] },
        {
          id: 'report',
          name: 'Report',
          fields: [
            field('rOrders', FieldType.Link),
            field('rTotal', FieldType.Number, {
              isLookup: true,
              isConditionalLookup: true,
              lookupFieldId: 'oTotal',
            }),
          ],
        },
      ],
      edges: [
        {
          ...ref(['orders', 'oTotal'], ['report', 'rOrders'], FieldType.Link),
          relationship: Relationship.ManyMany,
          isOneWay: true,
        },
        ref(['orders', 'oTotal'], ['report', 'rTotal'], 'lookup'),
      ],
    } as unknown as IBaseErdVo);
    const { groups, rest } = conditional.groupsOf('report');
    expect(groups.flatMap((g) => g.via.map((f) => f.id))).toEqual([]);
    expect(rest.map((f) => f.id)).toContain('rTotal');
  });

  it('takes the source a conditional lookup reads, not a field its filter references', () => {
    const conditional = new ErdGraph({
      baseId: 'bse4',
      nodes: [
        {
          id: 'orders',
          name: 'Orders',
          fields: [field('oStatus', FieldType.SingleSelect), field('oTotal', FieldType.Number)],
        },
        {
          id: 'report',
          name: 'Report',
          fields: [
            field('rTotal', FieldType.Number, {
              isLookup: true,
              isConditionalLookup: true,
              lookupFieldId: 'oTotal',
            }),
          ],
        },
      ],
      edges: [
        ref(['orders', 'oStatus'], ['report', 'rTotal'], 'lookup'),
        ref(['orders', 'oTotal'], ['report', 'rTotal'], 'lookup'),
      ],
    } as unknown as IBaseErdVo);
    expect(conditional.lookupSource('rTotal')).toEqual({ fieldId: 'oTotal', tableId: 'orders' });
  });

  it('records which way lookups and rollups carry data between two tables', () => {
    const pair = (a: string, b: string) => graph.pairs.find((p) => p.a === a && p.b === b)!;
    // students looks up classes, classes rolls up students
    expect(pair('classes', 'students')).toMatchObject({ flowAB: true, flowBA: true });
    // only scores takes data, from students
    expect(pair('scores', 'students')).toMatchObject({ flowAB: false, flowBA: true });
  });

  it('pairs tables that meet only through a conditional lookup, without counting them as linked', () => {
    const conditional = new ErdGraph({
      baseId: 'bse2',
      nodes: [
        { id: 'orders', name: 'Orders', fields: [field('oTotal', FieldType.Number)] },
        {
          id: 'report',
          name: 'Report',
          fields: [
            field('rTotal', FieldType.Number, { isLookup: true, isConditionalLookup: true }),
          ],
        },
      ],
      edges: [ref(['orders', 'oTotal'], ['report', 'rTotal'], 'lookup')],
    } as unknown as IBaseErdVo);
    expect(conditional.pairs).toEqual([
      {
        a: 'orders',
        b: 'report',
        links: [],
        flowAB: true,
        flowBA: false,
        flowKind: ErdFieldKind.Lookup,
        lookups: 1,
        rollups: 0,
      },
    ]);
    expect(conditional.linkedCount('report')).toBe(0);
    expect(graph.linkedCount('students')).toBe(2);
  });

  it('adds the link field a lookup or rollup goes through as a dependency', () => {
    expect(graph.upOf('sTeacher')).toContainEqual({ id: 'sClass', kind: ErdFieldKind.Link });
    expect(graph.upOf('cCount')).toContainEqual({ id: 'cStudents', kind: ErdFieldKind.Link });
    // a one-way link depends on the foreign field it displays
    expect(graph.upOf('scStudent')).toContainEqual({ id: 'sName', kind: ErdFieldKind.Link });
  });

  it('groups lookups under their link field and falls back to the only link to the same table', () => {
    const { groups, rest, incoming } = graph.groupsOf('students');
    expect(groups.map((g) => [g.field.id, g.via.map((f) => f.id)])).toEqual([
      ['sClass', ['sTeacher', 'sCopied']],
    ]);
    expect(rest.map((f) => f.id)).toEqual(['sName', 'sLabel']);
    expect(incoming.map((l) => l.fieldA)).toEqual(['scStudent']);
  });

  it('walks dependencies and impacts to the end with depths', () => {
    const deep = graph.deepOf('cTeacher');
    expect([...deep[ErdDirection.Down].levels.entries()].map(([id, l]) => [id, l.depth])).toEqual([
      ['sTeacher', 1],
      ['sCopied', 1],
      ['sLabel', 2],
      ['scLabel', 3],
    ]);
    expect(deep[ErdDirection.Down].byTable).toEqual({ students: 3, scores: 1 });
    expect(deep[ErdDirection.Down].depth).toBe(3);
    expect(graph.fieldStat('cTeacher')[ErdDirection.Down]).toEqual({
      count: 4,
      tables: 2,
      depth: 3,
    });
  });

  it('counts a whole table only through other tables', () => {
    const deep = graph.tableDeepOf('students');
    expect(Object.keys(deep[ErdDirection.Down].byTable).sort()).toEqual(['classes', 'scores']);
    expect(deep[ErdDirection.Up].byTable).toEqual({ classes: 2 });
  });

  it('splits direct relations into same-table and other tables', () => {
    const { same, cross } = graph.directOf('sTeacher');
    expect([...same.entries()]).toEqual([
      ['sClass', { direction: ErdDirection.Up, kind: ErdFieldKind.Link }],
      ['sLabel', { direction: ErdDirection.Down, kind: ErdFieldKind.Formula }],
    ]);
    expect(cross).toEqual({
      classes: [{ id: 'cTeacher', direction: ErdDirection.Up, kind: ErdFieldKind.Lookup }],
    });
  });

  it('draws a focused link row with what its link carries, like the table line', () => {
    const scene = buildScene(graph, computeBaseLayout(graph), {
      focus: 'students',
      selected: null,
      openGroups: new Set(),
      restOpen: false,
      reach: null,
    });
    const row = (target: string) =>
      scene.edges.find((e) => e.kind === ErdEdgeKind.Field && e.target === target)!;
    // lookups come in through sClass, a rollup goes out through cStudents
    expect(row('classes')).toMatchObject({ fieldKind: ErdFieldKind.Rollup, flow: ErdFlow.Both });
    expect(row('classes').arrows).toHaveLength(2);
    // scores links to students one way and takes nothing through it
    expect(row('scores')).toMatchObject({ fieldKind: ErdFieldKind.Link, flow: undefined });
    expect(row('scores').arrows).toEqual([]);
  });

  it('follows the longest chain up to the source', () => {
    // via the link field, which itself shows the classes' primary field
    expect(graph.sourcePath('scLabel')).toEqual([
      'cName',
      'sClass',
      'sTeacher',
      'sLabel',
      'scLabel',
    ]);
    expect(graph.lookupSource('sCopied')).toEqual({ fieldId: 'cTeacher', tableId: 'classes' });
  });
});

describe('table line notation', () => {
  const link = (tableA: string, relationship: Relationship) => ({
    tableA,
    fieldA: `${tableA}Link`,
    tableB: tableA === 'a' ? 'b' : 'a',
    relationship,
  });
  const pair = (links: ReturnType<typeof link>[], flowAB = false, flowBA = false) => ({
    a: 'a',
    b: 'b',
    links,
    flowAB,
    flowBA,
    lookups: 0,
    rollups: 0,
  });
  const ends = (p: ReturnType<typeof pair>) => [cardinalityAt(p, 'a'), cardinalityAt(p, 'b')];
  const { One, Many } = ErdCardinality;

  it.each([
    [Relationship.OneOne, [One, One]],
    [Relationship.ManyOne, [Many, One]],
    [Relationship.OneMany, [One, Many]],
    [Relationship.ManyMany, [Many, Many]],
  ])('draws %s from the side that owns the link', (relationship, expected) => {
    expect(ends(pair([link('a', relationship)]))).toEqual(expected);
  });

  it('reads a link owned by the other table the other way round', () => {
    expect(ends(pair([link('b', Relationship.ManyOne)]))).toEqual([One, Many]);
    expect(ends(pair([link('b', Relationship.OneMany)]))).toEqual([Many, One]);
  });

  it('marks an end many when any link between the two tables is many there', () => {
    const mixed = pair([link('a', Relationship.ManyOne), link('a', Relationship.OneMany)]);
    expect(ends(mixed)).toEqual([Many, Many]);
    expect(ends(pair([link('a', Relationship.OneOne), link('b', Relationship.OneOne)]))).toEqual([
      One,
      One,
    ]);
  });

  it('points the flow mark along the path from where it starts', () => {
    expect(flowAlong(pair([], true), 'a')).toBe(ErdFlow.Forward);
    expect(flowAlong(pair([], true), 'b')).toBe(ErdFlow.Backward);
    expect(flowAlong(pair([], false, true), 'a')).toBe(ErdFlow.Backward);
    expect(flowAlong(pair([], true, true), 'b')).toBe(ErdFlow.Both);
    expect(flowAlong(pair([link('a', Relationship.ManyOne)]), 'a')).toBeUndefined();
  });
});

describe('erd layout', () => {
  const graph = new ErdGraph(vo);
  const base = computeBaseLayout(graph);

  it('ranks linked tables left to right and puts unlinked ones in a row below', () => {
    const { positions } = base;
    expect(base.isolated).toEqual(['notes']);
    expect(positions.classes.x).toBe(positions.scores.x);
    expect(positions.students.x).toBeGreaterThan(positions.classes.x);
    expect(positions.scores.y).toBeGreaterThan(positions.classes.y);
    const placed = placeCards(base, {}, null);
    expect(placed.positions.notes.y).toBeGreaterThan(base.mainHeight);
  });

  it('makes room for the expanded card', () => {
    const before = placeCards(base, {}, null).positions;
    const after = placeCards(base, { students: 300 }, 'students').positions;
    expect(after.students).toEqual(before.students);
    for (const id of ['classes', 'scores']) {
      const shift = before[id].x > before.students.x ? EXPANDED_WIDTH - CARD_WIDTH : 0;
      expect(after[id].x).toBe(before[id].x + shift);
    }
    expect(after.notes.y).toBeGreaterThanOrEqual(after.students.y + 300);
    expect(CARD_HEIGHT).toBeLessThan(300);
  });
});

describe('pressable', () => {
  const press = (target: unknown, currentTarget: unknown, key = 'Enter') => {
    const onPress = vi.fn();
    const preventDefault = vi.fn();
    pressable(onPress).onKeyDown({ key, target, currentTarget, preventDefault } as never);
    return onPress.mock.calls.length;
  };

  it('acts on its own keys and leaves a nested button its own', () => {
    const row = {};
    expect(press(row, row)).toBe(1);
    expect(press({}, row)).toBe(0);
    expect(press(row, row, 'a')).toBe(0);
  });
});

describe('lineage', () => {
  // a -> b -> c and a -> c: b and c are both one step from a
  const shortcut = new ErdGraph({
    baseId: 'bse6',
    nodes: [
      { id: 'ta', name: 'A', fields: [field('a', FieldType.Number)] },
      { id: 'tb', name: 'B', fields: [field('b', FieldType.Formula)] },
      { id: 'tc', name: 'C', fields: [field('c', FieldType.Formula)] },
    ],
    edges: [
      ref(['ta', 'a'], ['tb', 'b'], 'formula'),
      ref(['tb', 'b'], ['tc', 'c'], 'formula'),
      ref(['ta', 'a'], ['tc', 'c'], 'formula'),
    ],
  } as unknown as IBaseErdVo);

  it('reaches a field of the same layer that depends on the picked one', () => {
    const layout = buildLineage(shortcut, 'a', new Set(), 1200);
    const indexOf = (id: string) => layout.nodes.find((n) => n.id === id)!.index;
    expect(lineageReach(layout, indexOf('b')).nodes.has(indexOf('c'))).toBe(true);
  });

  it('routes to an affected table along every path, not only the shortest', () => {
    const route = routeEdges(shortcut, 'a', { direction: ErdDirection.Down, tableId: 'tc' });
    expect(route.map(({ a, b }) => `${a}>${b}`).sort()).toEqual(['ta>tb', 'ta>tc', 'tb>tc']);
  });

  // one source field read by two formula fields in each of `count` tables, so layer 1 is merged
  const wideLayer = (count: number) => {
    const tables = Array.from({ length: count }, (_, i) => `t${i}`);
    const graph = new ErdGraph({
      baseId: 'bse5',
      nodes: [
        { id: 'src', name: 'Source', fields: [field('origin', FieldType.Number)] },
        ...tables.map((t) => ({
          id: t,
          name: t,
          fields: [field(`${t}a`, FieldType.Formula), field(`${t}b`, FieldType.Formula)],
        })),
      ],
      edges: tables.flatMap((t) => [
        ref(['src', 'origin'], [t, `${t}a`], 'formula'),
        ref(['src', 'origin'], [t, `${t}b`], 'formula'),
      ]),
    } as unknown as IBaseErdVo);
    return (expanded: string[]) =>
      buildLineage(graph, 'origin', new Set(expanded), 1200).columns.find((c) => c.depth === 1)!
        .nodes;
  };

  it('expands every table of a merged layer, including the last one shown', () => {
    const layerOf = wideLayer(14);
    const merged = layerOf([]);
    expect(merged.map((n) => n.kind)).toEqual(Array(14).fill(ErdLineageNodeKind.Table));
    const last = merged.find((n) => n.tableId === 't13')!;
    const expanded = layerOf([last.expandKey!]).filter((n) => n.members.includes('t13a'));
    expect(expanded.map((n) => [n.kind, n.id])).toEqual([[ErdLineageNodeKind.Field, 't13a']]);
  });

  it('keeps an opened table under a header in its slot, which closes it again', () => {
    const layerOf = wideLayer(14);
    const merged = layerOf([]);
    const t3 = merged.findIndex((n) => n.tableId === 't3');
    const opened = layerOf([merged[t3].expandKey!]);
    expect(opened[t3]).toMatchObject({ open: true, fields: 2, expandKey: merged[t3].expandKey });
    expect(opened.slice(t3 + 1, t3 + 3).map((n) => n.id)).toEqual(['t3a', 't3b']);
    expect(layerOf([])[t3]).toMatchObject({ kind: ErdLineageNodeKind.Table, tableId: 't3' });
  });

  it('keeps the order of a layer when a card opens or closes', () => {
    const layerOf = wideLayer(14);
    const order = (nodes: ReturnType<typeof layerOf>) =>
      nodes.filter((n) => n.kind === ErdLineageNodeKind.Table).map((n) => n.tableId);
    const merged = layerOf([]);
    const t5 = merged.find((n) => n.tableId === 't5')!;
    expect(order(layerOf([t5.expandKey!]))).toEqual(order(merged));
  });

  it('shows a small layer as open cards, one header per table with its fields as rows', () => {
    const layout = buildLineage(shortcut, 'a', new Set(), 1200);
    for (const header of layout.nodes.filter((n) => n.kind === ErdLineageNodeKind.Table)) {
      expect(header.open).toBe(true);
      const rows = layout.nodes.filter((n) => n.card === header.card && n !== header);
      expect(rows.map((n) => n.kind)).toEqual(Array(header.fields).fill(ErdLineageNodeKind.Field));
      expect(rows[0].y).toBe(header.y + header.h);
    }
  });

  it('opens the tables folded into "more" still merged by table', () => {
    const layerOf = wideLayer(16);
    const folded = layerOf([]);
    expect(folded).toHaveLength(14);
    const more = folded.at(-1)!;
    expect(more).toMatchObject({ kind: ErdLineageNodeKind.More, tables: 3 });
    const opened = layerOf([more.expandKey!]);
    expect(opened.map((n) => n.kind)).toEqual(Array(16).fill(ErdLineageNodeKind.Table));
  });
});
