import { ArrowLeft, ArrowUpRight } from '@teable/icons';
import { Button, cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { TableIcon } from './BaseErdTableNode';
import { ERD_FIELD_KINDS, ErdDirection, ErdFieldKind, countKinds, getFieldKind } from './erd-graph';
import type { IErdRoute } from './erd-scene';
import { RELATIONSHIP_LABEL, useErd, useFieldIcon, useKindIcon } from './ErdContext';

const KEY_FIELDS_SHOWN = 8;

const Bar = ({ ratio }: { ratio: number }) => (
  <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
    <i
      className="block h-full rounded-full bg-foreground/50"
      style={{ width: `${Math.max(4, ratio * 100)}%` }}
    />
  </span>
);

interface ITablePanelProps {
  tableId: string;
  reach: ErdDirection | null;
  onReach: (direction: ErdDirection) => void;
}

export const ErdTablePanel = ({ tableId, reach, onReach }: ITablePanelProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { graph, actions } = useErd();
  const iconOf = useFieldIcon();
  // the key fields follow the direction picked above, impact when none is
  const sort = reach ?? ErdDirection.Down;
  const [showAll, setShowAll] = useState(false);
  const table = graph.tableMap[tableId];
  const counts = countKinds(graph.tableMap[tableId].fields);
  const kindIcon = useKindIcon();
  const deep = graph.tableDeepOf(tableId);
  const linked = graph.linkedCount(tableId);

  const value = (id: string) => {
    const s = graph.fieldStat(id);
    return sort === ErdDirection.Down ? s[ErdDirection.Down].count : s[ErdDirection.Up].depth;
  };
  const list = table.fields
    .map((f) => ({ field: f, stat: graph.fieldStat(f.id) }))
    .filter(({ field }) => value(field.id) > 0)
    .sort(
      (a, b) =>
        value(b.field.id) - value(a.field.id) ||
        (sort === ErdDirection.Down
          ? b.stat[ErdDirection.Down].tables - a.stat[ErdDirection.Down].tables
          : b.stat[ErdDirection.Up].count - a.stat[ErdDirection.Up].count)
    );
  const max = list.length ? value(list[0].field.id) : 1;
  const unused = table.fields.length - list.length;

  const reachCard = (direction: ErdDirection) => {
    const w = deep[direction];
    const n = w.levels.size;
    const tables = Object.keys(w.byTable).length;
    return (
      <button
        type="button"
        disabled={!n}
        aria-pressed={reach === direction}
        title={t('table:erd.panel.reachHint')}
        onClick={() => {
          setShowAll(false);
          onReach(direction);
        }}
        data-reach={direction}
        className={cn(
          'flex flex-1 flex-col gap-0.5 rounded-md border p-2 text-start text-xs transition-colors disabled:cursor-default disabled:opacity-60',
          reach === direction && 'border-primary bg-accent',
          n > 0 && reach !== direction && 'hover:bg-accent'
        )}
      >
        <span className="font-medium">
          {direction === ErdDirection.Up
            ? t('table:erd.panel.dependsOn')
            : t('table:erd.panel.affects')}
        </span>
        <span className="text-muted-foreground">
          {direction === ErdDirection.Up
            ? t('table:erd.panel.dependsOnQuestion')
            : t('table:erd.panel.affectsQuestion')}
        </span>
        <b className="text-sm">
          {n ? t('table:erd.panel.tableCount', { count: tables }) : t('table:erd.panel.none')}
        </b>
        <span className="text-muted-foreground" title={t('table:erd.panel.otherTablesOnly')}>
          {n
            ? t('table:erd.panel.fieldsDepth', { count: n, depth: w.depth })
            : direction === ErdDirection.Up
              ? t('table:erd.panel.noUpTable')
              : t('table:erd.panel.noDownTable')}
        </span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3 p-4" data-panel="table">
      {/* leaves room for the dialog's own close button in the corner */}
      <div className="flex items-start gap-2 pe-8">
        <TableIcon icon={table.icon} className="mt-1" />
        <h3 className="min-w-0 flex-1 truncate text-base font-semibold" title={table.name}>
          {table.name}
        </h3>
      </div>
      <div className="text-xs text-muted-foreground">
        {t('table:erd.panel.tableSummary', { count: table.fields.length, tables: linked })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {ERD_FIELD_KINDS.filter((k) => counts[k]).map((k) => {
          const KindIcon = kindIcon(k);
          return (
            <span key={k} className="flex items-center gap-1">
              {KindIcon && <KindIcon className="size-3.5" />}
              {t(`table:erd.kind.${k}`)} {counts[k]}
            </span>
          );
        })}
      </div>
      <h4 className="mt-1 text-sm font-semibold">{t('table:erd.panel.reachTitle')}</h4>
      <div className="flex gap-2">
        {reachCard(ErdDirection.Down)}
        {reachCard(ErdDirection.Up)}
      </div>
      <h4 className="mt-1 text-sm font-semibold">{t('table:erd.panel.keyFields')}</h4>
      <div className="flex flex-col">
        {(showAll ? list : list.slice(0, KEY_FIELDS_SHOWN)).map(({ field, stat }) => {
          const Icon = iconOf(field);
          return (
            <button
              key={field.id}
              type="button"
              data-key-field={field.id}
              className="flex items-center gap-2 rounded p-1.5 text-start text-sm hover:bg-accent"
              title={t('table:erd.panel.keyFieldTitle', { field: field.name })}
              onClick={() => actions.jumpToField(field.id)}
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{field.name}</span>
              <Bar ratio={value(field.id) / max} />
              <span className="w-24 shrink-0 text-end text-xs text-muted-foreground">
                {sort === ErdDirection.Down
                  ? t('table:erd.panel.keyFieldDown', {
                      count: stat[ErdDirection.Down].count,
                      tables: stat[ErdDirection.Down].tables,
                    })
                  : t('table:erd.panel.keyFieldUp', {
                      depth: stat[ErdDirection.Up].depth,
                      count: stat[ErdDirection.Up].count,
                    })}
              </span>
            </button>
          );
        })}
      </div>
      {list.length > KEY_FIELDS_SHOWN && (
        <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
          {showAll
            ? t('table:erd.panel.showLess')
            : t('table:erd.panel.showAll', { count: list.length })}
        </Button>
      )}
      {unused > 0 && (
        <div className="text-xs text-muted-foreground">
          {/* "the other N" only reads right when some fields are listed above */}
          {list.length
            ? sort === ErdDirection.Down
              ? t('table:erd.panel.unusedDown', { count: unused })
              : t('table:erd.panel.unusedUp', { count: unused })
            : sort === ErdDirection.Down
              ? t('table:erd.panel.noneUsedDown', { count: unused })
              : t('table:erd.panel.noneUsedUp', { count: unused })}
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => actions.openTable(tableId)}
      >
        {t('table:erd.panel.openTable')}
        <ArrowUpRight className="size-4" />
      </Button>
    </div>
  );
};

interface IFieldPanelProps {
  fieldId: string;
  lineageOpen: boolean;
  openTableRoute: string | null;
  onLineage: () => void;
  onBack: () => void;
  onRouteHover: (route: IErdRoute | null) => void;
  onToggleTableRoute: (tableId: string) => void;
}

// eslint-disable-next-line sonarjs/cognitive-complexity
export const ErdFieldPanel = (props: IFieldPanelProps) => {
  const { fieldId, lineageOpen, openTableRoute, onLineage, onBack } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { graph, actions } = useErd();
  const iconOf = useFieldIcon();
  const field = graph.fieldMap[fieldId];
  const table = graph.tableMap[field.tableId];
  const deep = graph.deepOf(fieldId);
  const kind = getFieldKind(field);
  const Icon = iconOf(field);
  const fieldName = (id: string) => graph.fieldMap[id]?.name ?? '';
  const tableName = (id?: string) => (id ? (graph.tableMap[id]?.name ?? '') : '');
  const kindName = (k: ErdFieldKind) => t(`table:erd.kind.${k}`);

  let source: { label: string; value: string } | null = null;
  if (field.isLookup || kind === ErdFieldKind.Rollup) {
    const group = graph.groupsOf(table.id).groups.find((g) => g.via.some((f) => f.id === fieldId));
    const from = graph.lookupSource(fieldId);
    source = {
      label: t('table:erd.panel.source'),
      value: t(field.isLookup ? 'table:erd.panel.sourceLookup' : 'table:erd.panel.sourceRollup', {
        via: group ? t('table:erd.panel.sourceVia', { field: group.field.name }) : '',
        table: tableName(from?.tableId),
        field: from ? fieldName(from.fieldId) : '',
      }),
    };
  } else if (kind === ErdFieldKind.Link) {
    const link = graph.linkOf(fieldId);
    if (link) {
      source = {
        label: t('table:erd.panel.linksTo'),
        value: `${tableName(graph.otherTable(table.id, link))} · ${t(
          RELATIONSHIP_LABEL[graph.relationshipFrom(table.id, link, fieldId)]
        )}${link.fieldB ? '' : ` (${t('table:erd.panel.oneWay')})`}`,
      };
    }
  }

  const head = (direction: ErdDirection) => {
    const w = deep[direction];
    const n = w.levels.size;
    const direct = [...w.levels.values()].filter((v) => v.depth === 1).length;
    if (!n) {
      return (
        <div className="text-sm text-muted-foreground">
          {direction === ErdDirection.Up ? t('table:erd.panel.noUp') : t('table:erd.panel.noDown')}
        </div>
      );
    }
    return (
      <div className="text-sm">
        <b>
          {direction === ErdDirection.Up
            ? t('table:erd.panel.dependsOn')
            : t('table:erd.panel.affects')}
        </b>{' '}
        {t('table:erd.panel.directTotal', {
          direct,
          count: n,
          tables: Object.keys(w.byTable).length,
        })}
        {w.depth > 1 && ` · ${t('table:erd.panel.maxDepth', { depth: w.depth })}`}
      </div>
    );
  };

  const directs = graph.upOf(fieldId);

  const affected = useMemo(() => {
    const rows: Record<
      string,
      { tableId: string; ids: [string, number][]; min: number; max: number }
    > = {};
    graph.deepOf(fieldId)[ErdDirection.Down].levels.forEach((level, id) => {
      const tid = graph.tableOf(id)!;
      const r = (rows[tid] ??= { tableId: tid, ids: [], min: 99, max: 0 });
      r.ids.push([id, level.depth]);
      r.min = Math.min(r.min, level.depth);
      r.max = Math.max(r.max, level.depth);
    });
    return Object.values(rows).sort((a, b) => b.ids.length - a.ids.length || a.min - b.min);
  }, [graph, fieldId]);
  const affectedMax = affected.length ? affected[0].ids.length : 1;
  const total = deep[ErdDirection.Up].levels.size + deep[ErdDirection.Down].levels.size;
  const layerText = (min: number, max: number) =>
    t('table:erd.panel.layer', { layer: min === max ? `${min}` : `${min}–${max}` });

  const crumb = (id: string | null, i: number) =>
    id ? (
      <button
        key={id}
        type="button"
        className="max-w-[8em] truncate text-primary hover:underline"
        title={`${tableName(graph.tableOf(id))} · ${fieldName(id)}`}
        onClick={() => actions.jumpToField(id)}
      >
        {fieldName(id)}
      </button>
    ) : (
      <span key={`gap${i}`} className="text-muted-foreground">
        …
      </span>
    );

  return (
    <div className="flex flex-col gap-3 p-4" data-panel="field">
      <button
        type="button"
        // leaves room for the panel's close button
        className="flex min-w-0 max-w-[calc(100%-2rem)] items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
        title={table.name}
        onClick={onBack}
      >
        <ArrowLeft className="size-4 shrink-0" />
        <span className="truncate">{table.name}</span>
      </button>
      <div className="flex items-start gap-2">
        <Icon className="mt-1 size-4 shrink-0" />
        <h3 className="min-w-0 flex-1 truncate text-base font-semibold" title={field.name}>
          {field.name}
        </h3>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <span className="text-muted-foreground">{t('table:erd.panel.type')}</span>
        <span>
          {kindName(kind)}
          {field.isPrimary && ` · ${t('table:erd.panel.primary')}`}
        </span>
        {source && (
          <>
            <span className="text-muted-foreground">{source.label}</span>
            <span className="min-w-0 truncate" title={source.value}>
              {source.value}
            </span>
          </>
        )}
      </div>
      {total > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 p-2.5">
          <span className="text-xs text-muted-foreground">
            {t('table:erd.panel.lineageSummary', { count: total })}
          </span>
          <Button
            size="sm"
            variant="outline"
            aria-pressed={lineageOpen}
            onClick={onLineage}
            data-lineage-entry
          >
            {lineageOpen ? t('table:erd.lineage.close') : t('table:erd.lineage.open')}
          </Button>
        </div>
      )}
      {head(ErdDirection.Up)}
      {directs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {directs.map((ref) => {
            const path = graph.sourcePath(ref.id);
            const crumbs =
              path.length > 4
                ? [path[0], null, path[path.length - 2], path[path.length - 1]]
                : path;
            return (
              <div
                key={ref.id}
                className="rounded-md border bg-muted/40 p-2 text-sm"
                onMouseEnter={() =>
                  props.onRouteHover({ direction: ErdDirection.Up, fieldId: ref.id })
                }
                onMouseLeave={() => props.onRouteHover(null)}
                data-dependency={ref.id}
              >
                <div className="flex items-baseline gap-2">
                  <button
                    type="button"
                    className="truncate font-medium hover:underline"
                    title={fieldName(ref.id)}
                    onClick={() => actions.jumpToField(ref.id)}
                  >
                    {fieldName(ref.id)}
                  </button>
                  <span
                    className="min-w-0 truncate text-xs text-muted-foreground"
                    title={tableName(graph.tableOf(ref.id))}
                  >
                    {tableName(graph.tableOf(ref.id))} · {kindName(ref.kind)}
                  </span>
                </div>
                {path.length > 1 ? (
                  <>
                    <div
                      className="mt-1 flex flex-wrap items-center gap-1 text-xs"
                      title={path
                        .map((id) => `${tableName(graph.tableOf(id))}·${fieldName(id)}`)
                        .join(' → ')}
                    >
                      {crumbs.map((id, i) => (
                        <span key={id ?? `g${i}`} className="flex items-center gap-1">
                          {i > 0 && <span className="text-muted-foreground">→</span>}
                          {crumb(id, i)}
                        </span>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('table:erd.panel.sourceChain', {
                        hops: path.length - 1,
                        count: graph.fieldStat(ref.id)[ErdDirection.Up].count,
                      })}
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    {t('table:erd.panel.sourceField')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="rounded-md border-2 border-primary px-3 py-2">
        <div className="truncate font-semibold" title={field.name}>
          {field.name}
        </div>
        <div className="truncate text-xs text-muted-foreground" title={table.name}>
          {table.name} · {kindName(kind)}
        </div>
      </div>
      {head(ErdDirection.Down)}
      {affected.length > 0 && (
        <div className="flex flex-col">
          {affected.map((r) => {
            const open = openTableRoute === r.tableId;
            return (
              <div key={r.tableId} className={cn('rounded', open && 'bg-muted/50')}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded p-1.5 text-start text-sm hover:bg-accent"
                  data-affected-table={r.tableId}
                  onMouseEnter={() =>
                    props.onRouteHover({ direction: ErdDirection.Down, tableId: r.tableId })
                  }
                  onMouseLeave={() => props.onRouteHover(null)}
                  onClick={() => props.onToggleTableRoute(r.tableId)}
                >
                  <span className="min-w-0 flex-1 truncate" title={tableName(r.tableId)}>
                    {tableName(r.tableId)}
                    {r.tableId === table.id && (
                      <i className="ms-1 text-xs not-italic text-muted-foreground">
                        {t('table:erd.panel.thisTable')}
                      </i>
                    )}
                  </span>
                  <Bar ratio={r.ids.length / affectedMax} />
                  <span className="w-8 shrink-0 text-end font-semibold">{r.ids.length}</span>
                  <span className="w-16 shrink-0 text-end text-xs text-muted-foreground">
                    {layerText(r.min, r.max)}
                  </span>
                </button>
                {open && (
                  <div className="flex flex-wrap gap-1 px-1.5 pb-2">
                    {r.ids
                      .sort((a, b) => a[1] - b[1])
                      .map(([id, depth]) => (
                        <button
                          key={id}
                          type="button"
                          className="flex max-w-full items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-xs hover:bg-accent"
                          title={t('table:erd.panel.jumpLayer', { layer: depth })}
                          onClick={() => actions.jumpToField(id)}
                        >
                          <span className="truncate">{fieldName(id)}</span>
                          <i className="shrink-0 not-italic text-muted-foreground">
                            {layerText(depth, depth)}
                          </i>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {total > 0 && (
        <p className="text-xs text-muted-foreground">{t('table:erd.panel.routeHint')}</p>
      )}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => actions.openTable(table.id)}
      >
        {t('table:erd.panel.openTable')}
        <ArrowUpRight className="size-4" />
      </Button>
    </div>
  );
};
