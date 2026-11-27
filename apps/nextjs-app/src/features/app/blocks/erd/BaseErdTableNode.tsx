import { ChevronDown, ChevronRight, Link, Table2 } from '@teable/icons';
import { useContentDir } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { SyntheticEvent } from 'react';
import { memo } from 'react';
import type { NodeProps } from 'reactflow';
import { Handle, Position } from 'reactflow';
import { tableConfig } from '@/features/i18n/table.config';
import { Emoji } from '../../components/emoji/Emoji';
import { ERD_FIELD_KINDS, ErdDirection, countKinds, getFieldKind } from './erd-graph';
import { CARD_HEIGHT } from './erd-layout';
import type { IErdCard, IErdRow } from './erd-scene';
import { ErdRowKind, MINI_ROW_HEIGHT } from './erd-scene';
import { KIND_BG, RELATIONSHIP_SHORT, pressable, useErd, useFieldIcon } from './ErdContext';

export const TableIcon = ({ icon, className }: { icon?: string; className?: string }) =>
  icon ? (
    <Emoji className={cn('size-4 shrink-0', className)} emoji={icon} size={'1rem'} />
  ) : (
    <Table2 className={cn('size-4 shrink-0', className)} />
  );

/** share of each relation kind among the table's fields */
const KindMix = ({ tableId }: { tableId: string }) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { graph } = useErd();
  const { fields } = graph.tableMap[tableId];
  const counts = countKinds(fields);
  const total = fields.length || 1;
  const kinds = ERD_FIELD_KINDS.filter((kind) => counts[kind]);
  const mix = kinds.map((kind) => `${t(`table:erd.kind.${kind}`)} ${counts[kind]}`).join(' · ');
  return (
    // the bar is thin, so the hover target reaches above and below it
    <span className="-my-2 shrink-0 py-2" title={t('table:erd.card.kindMix', { mix })}>
      <span className="flex h-1.5 w-[38px] gap-px overflow-hidden rounded-sm">
        {kinds.map((kind) => (
          <i
            key={kind}
            className={KIND_BG[kind]}
            style={{ width: `${(counts[kind] / total) * 100}%` }}
          />
        ))}
      </span>
    </span>
  );
};

// eslint-disable-next-line sonarjs/cognitive-complexity
const Row = ({ row, tableId }: { row: IErdRow; tableId: string }) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { graph, selected, related, openGroups, restOpen, actions } = useErd();
  const iconOf = useFieldIcon();
  const field = row.field;
  const isSelected = Boolean(field && field.id === selected);
  const relation = field ? related.get(field.id) : undefined;
  const style = { top: row.y - CARD_HEIGHT, height: row.height };
  const base = cn(
    'absolute inset-x-px flex items-center gap-1.5 pe-3 text-[12.5px]',
    isSelected ? 'bg-accent' : relation ? 'bg-muted' : 'hover:bg-accent'
  );
  const bar = (isSelected || relation) && (
    <i
      className={cn(
        'absolute inset-y-0 start-0 w-[3px]',
        isSelected ? 'bg-primary' : relation && KIND_BG[relation.kind]
      )}
    />
  );
  const select = (id: string) => (e: SyntheticEvent) => {
    e.stopPropagation();
    actions.selectField(id);
  };

  if (row.kind === ErdRowKind.Link && row.group) {
    const { group } = row;
    const link = group.link;
    const other = link ? graph.otherTable(tableId, link) : undefined;
    const n = group.via.length;
    const open = openGroups.has(group.field.id);
    const Chevron = open ? ChevronDown : ChevronRight;
    return (
      <div
        className={cn(base, 'cursor-pointer')}
        style={style}
        title={other ? `${group.field.name} → ${graph.tableMap[other]?.name}` : group.field.name}
        {...pressable(select(group.field.id))}
        data-row={group.field.id}
      >
        {bar}
        <button
          type="button"
          className={cn(
            'flex h-full w-5 shrink-0 items-center justify-center text-muted-foreground',
            !n && 'invisible'
          )}
          title={open ? t('table:erd.card.collapse') : t('table:erd.card.expandVia', { count: n })}
          onClick={(e) => {
            e.stopPropagation();
            actions.toggleGroup(group.field.id);
          }}
        >
          <Chevron className="size-3.5" />
        </button>
        <Link className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-semibold">{group.field.name}</span>
        {n > 0 && (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {t('table:erd.card.viaCount', { count: n })}
          </span>
        )}
        {link && other && (
          <span className="max-w-[45%] shrink-0 truncate text-xs text-primary">
            {RELATIONSHIP_SHORT[graph.relationshipFrom(tableId, link, group.field.id)]}{' '}
            {graph.tableMap[other]?.name}
          </span>
        )}
      </div>
    );
  }
  if (row.kind === ErdRowKind.Incoming && row.link) {
    const { link } = row;
    return (
      <div
        className={cn(base, 'cursor-pointer ps-6 text-muted-foreground')}
        style={style}
        title={t('table:erd.card.incomingTitle', {
          table: graph.tableMap[link.tableA]?.name,
          field: graph.fieldMap[link.fieldA]?.name,
        })}
        {...pressable((e) => {
          e.stopPropagation();
          actions.focusTable(link.tableA);
        })}
      >
        <span className="min-w-0 flex-1 truncate">
          {t('table:erd.card.incoming', { table: graph.tableMap[link.tableA]?.name })}
        </span>
        <span className="shrink-0 text-xs text-primary">
          {RELATIONSHIP_SHORT[graph.relationshipFrom(tableId, link)]}
        </span>
      </div>
    );
  }
  if (row.kind === ErdRowKind.RestHead && row.rest) {
    const counts = countKinds(row.rest);
    const summary = ERD_FIELD_KINDS.filter((k) => counts[k])
      .map((k) => `${t(`table:erd.kind.${k}`)} ${counts[k]}`)
      .join(' · ');
    const Chevron = restOpen ? ChevronDown : ChevronRight;
    return (
      <div
        className={cn(base, 'cursor-pointer border-t border-dashed')}
        style={style}
        {...pressable((e) => {
          e.stopPropagation();
          actions.toggleRest();
        })}
        data-row="rest"
      >
        <span className="flex w-5 shrink-0 justify-center text-muted-foreground">
          <Chevron className="size-3.5" />
        </span>
        <span className="shrink-0 font-semibold">
          {t('table:erd.card.otherFields', { count: row.rest.length })}
        </span>
        <span className="min-w-0 flex-1 truncate text-end text-[11.5px] text-muted-foreground">
          {summary}
        </span>
      </div>
    );
  }
  if (!field) return null;
  const Icon = iconOf(field);
  return (
    <div
      className={cn(base, 'cursor-pointer text-xs', row.kind === ErdRowKind.Via ? 'ps-10' : 'ps-6')}
      style={style}
      title={field.name}
      {...pressable(select(field.id))}
      data-row={field.id}
    >
      {bar}
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{field.name}</span>
      <span className="shrink-0 text-[11.5px] text-muted-foreground">
        {t(`table:erd.kind.${getFieldKind(field)}`)}
      </span>
    </div>
  );
};

const MiniRows = ({ card }: { card: IErdCard }) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { graph, actions } = useErd();
  const iconOf = useFieldIcon();
  return (
    <div className="absolute inset-x-0 border-t border-dashed pt-1" style={{ top: CARD_HEIGHT }}>
      {card.mini.map((row) => {
        const field = graph.fieldMap[row.id];
        const Icon = iconOf(field);
        return (
          <div
            key={row.id}
            className={cn(
              'relative flex cursor-pointer items-center gap-1.5 pe-2 ps-2.5 text-xs hover:bg-accent'
            )}
            style={{ height: MINI_ROW_HEIGHT }}
            title={t(
              row.direction === ErdDirection.Up
                ? 'table:erd.card.miniUp'
                : 'table:erd.card.miniDown',
              { field: field.name, kind: t(`table:erd.kind.${row.kind}`) }
            )}
            {...pressable((e) => {
              e.stopPropagation();
              actions.jumpToField(row.id);
            })}
            data-row={row.id}
          >
            <i className={cn('absolute inset-y-0 start-0 w-[3px]', KIND_BG[row.kind])} />
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{field.name}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {t(`table:erd.kind.${row.kind}`)}
            </span>
          </div>
        );
      })}
      {card.miniMore > 0 && (
        <div className="px-2.5 text-[11.5px] leading-[22px] text-muted-foreground">
          {t('table:erd.card.miniMore', { count: card.miniMore })}
        </div>
      )}
    </div>
  );
};

// eslint-disable-next-line sonarjs/cognitive-complexity
export const BaseErdTableNode = memo(({ data }: NodeProps<IErdCard>) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { graph, actions } = useErd();
  const contentDir = useContentDir();
  const table = graph.tableMap[data.id];
  const linked = graph.linkedCount(data.id);
  const title = table.crossBaseName ? `${table.name} (${table.crossBaseName})` : table.name;
  const mark = data.down ? ErdDirection.Down : data.up ? ErdDirection.Up : null;

  return (
    <div
      className={cn(
        'erd-card relative cursor-pointer rounded-md border bg-background shadow-sm transition-opacity',
        data.expanded && 'border-primary ring-1 ring-primary',
        mark && 'border-foreground/60 bg-accent',
        data.dim && 'opacity-30'
      )}
      style={{ width: data.width, height: data.height }}
      onMouseEnter={() => actions.hoverTable(data.id)}
      onMouseLeave={() => actions.hoverTable(null)}
      onDoubleClick={() => actions.openTable(data.id)}
      data-table={data.id}
      data-marked={mark ?? undefined}
      title={
        mark
          ? t('table:erd.card.reachTitle', { table: table.name, down: data.down, up: data.up })
          : undefined
      }
    >
      <Handle type="source" position={Position.Right} isConnectable={false} className="opacity-0" />
      <Handle type="target" position={Position.Left} isConnectable={false} className="opacity-0" />
      <div className="flex flex-col justify-center gap-1 px-3" style={{ height: CARD_HEIGHT }}>
        <div className="flex items-center gap-1.5">
          <TableIcon icon={table.icon} />
          <span dir={contentDir} className="truncate text-sm font-semibold" title={title}>
            {title}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate font-medium">
            {mark ? (
              <>
                {data.down > 0 && <span>{t('table:erd.affects', { count: data.down })}</span>}
                {data.down > 0 && data.up > 0 && <span className="text-muted-foreground"> · </span>}
                {data.up > 0 && <span>{t('table:erd.dependsOn', { count: data.up })}</span>}
              </>
            ) : (
              <span className="font-normal text-muted-foreground">
                {t('table:erd.card.summary', { count: table.fields.length })}
                {linked > 0 && ` · ${t('table:erd.card.linkedTables', { count: linked })}`}
              </span>
            )}
          </span>
          <KindMix tableId={data.id} />
        </div>
      </div>
      {data.expanded && (
        <div className="absolute inset-x-0 border-t" style={{ top: CARD_HEIGHT }}>
          {data.rows.map((row, i) => (
            <Row
              key={`${row.kind}:${row.field?.id ?? row.link?.fieldA ?? i}`}
              row={row}
              tableId={data.id}
            />
          ))}
        </div>
      )}
      {data.mini.length > 0 && <MiniRows card={data} />}
    </div>
  );
});

BaseErdTableNode.displayName = 'BaseErdTableNode';
