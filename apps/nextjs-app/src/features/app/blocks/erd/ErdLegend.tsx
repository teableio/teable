import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { Panel } from 'reactflow';
import { tableConfig } from '@/features/i18n/table.config';
import { ErdFieldKind } from './erd-graph';
import type { IErdArrow } from './erd-scene';
import { ErdCardinality } from './erd-scene';
import { KIND_STROKE, LINK_DASH } from './ErdContext';
import { FlowArrow, erdMarker } from './ErdPathEdge';

interface ISample {
  kind: ErdFieldKind;
  dash?: boolean;
  arrows?: IErdArrow[];
  start?: string;
  end?: string;
}

const SAMPLE_WIDTH = 32;

const Sample = ({ kind, dash, arrows, start, end }: ISample) => (
  <svg width={SAMPLE_WIDTH} height="12" aria-hidden="true" className="shrink-0">
    <path
      d={`M2,6 L${SAMPLE_WIDTH - 2},6`}
      fill="none"
      stroke={KIND_STROKE[kind]}
      strokeWidth={2}
      strokeDasharray={dash ? LINK_DASH : undefined}
      markerStart={start}
      markerEnd={end}
    />
    {arrows?.map((arrow, i) => (
      <FlowArrow key={i} arrow={arrow} color={KIND_STROKE[kind]} />
    ))}
  </svg>
);

const Item = ({
  sample,
  tip,
  children,
}: {
  sample: ReactNode;
  tip?: string;
  children: ReactNode;
}) => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap" title={tip}>
    {sample}
    {children}
  </span>
);

// items are cells of the legend grid itself, so both columns line up across every row
const Row = ({
  label,
  lines = 1,
  children,
}: {
  label: string;
  lines?: 1 | 2;
  children: ReactNode;
}) => (
  <>
    <span className={cn('self-start text-foreground/70', lines === 2 && 'row-span-2')}>
      {label}
    </span>
    {children}
  </>
);

/** what the lines mean; the same in every view, so it reads as a key and not as content */
export const ErdLegend = ({ baseId }: { baseId: string }) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const kindLabel = (kind: ErdFieldKind) => t(`table:erd.kind.${kind}`);
  const other = ErdFieldKind.Other;
  return (
    <Panel
      position="bottom-right"
      className="grid grid-cols-[auto_auto_auto] items-center gap-x-3 gap-y-1 rounded-md border bg-background/95 px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm"
      title={t('table:erd.legend.hover')}
      data-erd-legend
    >
      <Row label={t('table:erd.legend.color')} lines={2}>
        <Item sample={<Sample kind={ErdFieldKind.Link} dash />} tip={t('table:erd.legend.linkTip')}>
          {kindLabel(ErdFieldKind.Link)}
        </Item>
        {[ErdFieldKind.Lookup, ErdFieldKind.Rollup, ErdFieldKind.Formula].map((kind) => (
          <Item key={kind} sample={<Sample kind={kind} />}>
            {kindLabel(kind)}
          </Item>
        ))}
      </Row>
      <Row label={t('table:erd.legend.arrow')}>
        <Item
          sample={<Sample kind={other} arrows={[{ x: 16, y: 6, angle: 0 }]} />}
          tip={t('table:erd.legend.oneWayTip')}
        >
          {t('table:erd.legend.oneWay')}
        </Item>
        <Item
          sample={
            <Sample
              kind={other}
              arrows={[
                // as far apart as on a short line, so they read as two arrows
                { x: 7, y: 6, angle: 180 },
                { x: 25, y: 6, angle: 0 },
              ]}
            />
          }
          tip={t('table:erd.legend.bothWaysTip')}
        >
          {t('table:erd.legend.bothWays')}
        </Item>
      </Row>
      <Row label={t('table:erd.legend.ends')}>
        <Item sample={<Sample kind={other} />} tip={t('table:erd.legend.oneTip')}>
          {t('table:erd.legend.one')}
        </Item>
        <Item
          sample={<Sample kind={other} end={erdMarker(baseId, ErdCardinality.Many, other)} />}
          tip={t('table:erd.legend.manyTip')}
        >
          {t('table:erd.legend.many')}
        </Item>
      </Row>
    </Panel>
  );
};
