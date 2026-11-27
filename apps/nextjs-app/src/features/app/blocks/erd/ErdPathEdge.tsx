import { memo } from 'react';
import type { EdgeProps } from 'reactflow';
import { ERD_FIELD_KINDS, ErdFieldKind } from './erd-graph';
import type { IErdPoint } from './erd-layout';
import type { IErdArrow, IErdSceneEdge } from './erd-scene';
import { ErdCardinality, ErdEdgeKind } from './erd-scene';
import { KIND_STROKE, LINK_DASH } from './ErdContext';

const erdMarkerId = (baseId: string, name: string) => `${baseId}-erd-${name}`;

/** a marker takes its colour where it is defined, so each line colour has its own set */
enum ErdMarkerTone {
  Primary = 'primary',
}
type ITone = ErdFieldKind | ErdMarkerTone;
const TONES: ITone[] = [...ERD_FIELD_KINDS, ErdMarkerTone.Primary];
const toneStroke = (tone: ITone) =>
  tone === ErdMarkerTone.Primary ? 'hsl(var(--primary))' : KIND_STROKE[tone];

enum ErdMarkerShape {
  Arrow = 'arrow',
  Dot = 'dot',
}
type IShape = ErdCardinality | ErdMarkerShape;

export const erdMarker = (baseId: string, shape: IShape, tone: ITone) =>
  `url(#${erdMarkerId(baseId, `${shape}-${tone}`)})`;

const MarkerSet = ({ baseId, tone }: { baseId: string; tone: ITone }) => {
  const stroke = toneStroke(tone);
  const id = (shape: IShape) => erdMarkerId(baseId, `${shape}-${tone}`);
  const box = {
    viewBox: '0 0 12 12',
    markerWidth: 12,
    markerHeight: 12,
    markerUnits: 'userSpaceOnUse',
    refY: 6,
  } as const;
  const line = { fill: 'none', stroke, strokeWidth: 1.8, strokeLinecap: 'round' } as const;
  return (
    <>
      {/* crow's foot notation at the ends */}
      <marker id={id(ErdCardinality.Many)} {...box} refX={12} orient="auto-start-reverse">
        <path d="M2,6 L12,1 M2,6 L12,6 M2,6 L12,11" {...line} />
      </marker>
      <marker
        id={id(ErdMarkerShape.Arrow)}
        viewBox="0 0 8 8"
        refX="7"
        refY="4"
        markerWidth="6"
        markerHeight="6"
        orient="auto"
      >
        <path d="M0,0 L8,4 L0,8 z" fill={stroke} />
      </marker>
      <marker
        id={id(ErdMarkerShape.Dot)}
        viewBox="0 0 8 8"
        refX="4"
        refY="4"
        markerWidth="5"
        markerHeight="5"
      >
        <circle cx="4" cy="4" r="3" fill={stroke} />
      </marker>
    </>
  );
};

export const ErdMarkers = ({ baseId }: { baseId: string }) => (
  <svg className="absolute size-0" aria-hidden="true">
    <defs>
      {TONES.map((tone) => (
        <MarkerSet key={tone} baseId={baseId} tone={tone} />
      ))}
    </defs>
  </svg>
);

/** a solid arrow on a line, pointing the way data flows */
export const FlowArrow = ({ arrow, color }: { arrow: IErdArrow; color: string }) => (
  <path
    d="M-4.5,-4 L4.5,0 L-4.5,4 z"
    fill={color}
    stroke={color}
    strokeLinejoin="round"
    transform={`translate(${arrow.x},${arrow.y}) rotate(${arrow.angle})`}
    className="pointer-events-none"
    data-flow-arrow
  />
);

export interface IErdEdgeData extends IErdSceneEdge {
  baseId: string;
  /** the line belongs to the hovered table */
  hot?: boolean;
  /** zoomed in far enough to read the line ends */
  detail?: boolean;
  /** shift that keeps the anchor of the last change in place */
  offset: IErdPoint;
}

// eslint-disable-next-line sonarjs/cognitive-complexity
export const ErdPathEdge = memo(({ data }: EdgeProps<IErdEdgeData>) => {
  if (!data) return null;
  const { kind, path, dim, action, baseId, ends, hot, detail, offset } = data;
  const tone: ITone = data.fieldKind ?? ErdFieldKind.Other;
  let stroke = toneStroke(tone);
  let strokeWidth = data.strokeWidth;
  let opacity = dim ? 0.12 : 1;
  let markerStart: string | undefined;
  let markerEnd: string | undefined;
  let dash: string | undefined;
  if (kind === ErdEdgeKind.Table) {
    opacity = dim ? 0.1 : hot ? 1 : 0.7;
    if (hot) strokeWidth += 0.8;
    // only the "many" end is marked; an unmarked end is one record
    if (ends && (hot || detail)) {
      const many = (end: ErdCardinality) =>
        end === ErdCardinality.Many ? erdMarker(baseId, end, tone) : undefined;
      markerStart = many(ends[0]);
      markerEnd = many(ends[1]);
    }
  } else if (kind === ErdEdgeKind.Field) {
    opacity = dim ? 0.12 : 0.9;
    markerStart = erdMarker(baseId, ErdMarkerShape.Dot, tone);
  } else if (kind === ErdEdgeKind.Relation) {
    markerEnd = erdMarker(baseId, ErdMarkerShape.Arrow, tone);
  } else if (kind === ErdEdgeKind.Route) {
    // a route runs through fields of every kind
    stroke = toneStroke(ErdMarkerTone.Primary);
    opacity = 0.85;
    markerEnd = erdMarker(baseId, ErdMarkerShape.Arrow, ErdMarkerTone.Primary);
  }
  if (tone === ErdFieldKind.Link && kind !== ErdEdgeKind.Route) dash = LINK_DASH;
  return (
    <g
      className={`erd-edge erd-edge-${kind}`}
      data-kind={kind}
      opacity={opacity}
      transform={offset.x || offset.y ? `translate(${offset.x},${offset.y})` : undefined}
    >
      {/* a wider invisible stroke to click, or to hover a table line for its details */}
      {(action || kind === ErdEdgeKind.Table) && (
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={12}
          className={action ? 'cursor-pointer' : undefined}
        />
      )}
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
        markerStart={markerStart}
        markerEnd={markerEnd}
        className="pointer-events-none"
      />
      {data.arrows?.map((arrow, i) => (
        <FlowArrow key={i} arrow={arrow} color={stroke} />
      ))}
    </g>
  );
});

ErdPathEdge.displayName = 'ErdPathEdge';
