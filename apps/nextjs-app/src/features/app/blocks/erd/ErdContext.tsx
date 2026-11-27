import { FieldType, Relationship } from '@teable/core';
import type { useFieldStaticGetter } from '@teable/sdk/hooks';
import type { KeyboardEvent, SyntheticEvent } from 'react';
import { createContext, useContext } from 'react';
import type { ErdGraph, IErdField, IErdRelation } from './erd-graph';
import { ErdFieldKind } from './erd-graph';

export interface IErdActions {
  focusTable: (tableId: string) => void;
  selectField: (fieldId: string) => void;
  jumpToField: (fieldId: string) => void;
  toggleGroup: (linkFieldId: string) => void;
  toggleRest: () => void;
  openTable: (tableId: string) => void;
  hoverTable: (tableId: string | null) => void;
}

export interface IErdContext {
  graph: ErdGraph;
  selected: string | null;
  openGroups: ReadonlySet<string>;
  restOpen: boolean;
  related: ReadonlyMap<string, IErdRelation>;
  actions: IErdActions;
  fieldStaticGetter: ReturnType<typeof useFieldStaticGetter>;
}

export const ErdContext = createContext<IErdContext | null>(null);

export const useErd = () => {
  const ctx = useContext(ErdContext);
  if (!ctx) throw new Error('useErd must be used inside ErdContext');
  return ctx;
};

// the same labels as the link field settings
export const RELATIONSHIP_LABEL = {
  [Relationship.OneOne]: 'table:field.editor.oneToOne',
  [Relationship.OneMany]: 'table:field.editor.oneToMany',
  [Relationship.ManyOne]: 'table:field.editor.manyToOne',
  [Relationship.ManyMany]: 'table:field.editor.manyToMany',
} as const;

export const RELATIONSHIP_SHORT: Record<Relationship, string> = {
  [Relationship.OneOne]: '1:1',
  [Relationship.OneMany]: '1:N',
  [Relationship.ManyOne]: 'N:1',
  [Relationship.ManyMany]: 'N:N',
};

/**
 * colour in the ERD means the kind of relation; validated for colour-vision deficiency on the
 * canvas in both themes (dataviz validator), every use also has an icon or a label
 */
export const KIND_PALETTE =
  '[--erd-link:#c98500] [--erd-lookup:#2a78d6] [--erd-rollup:#008300] [--erd-formula:#d55181] dark:[--erd-lookup:#3987e5]';

export const KIND_STROKE: Record<ErdFieldKind, string> = {
  [ErdFieldKind.Link]: 'var(--erd-link)',
  [ErdFieldKind.Lookup]: 'var(--erd-lookup)',
  [ErdFieldKind.Rollup]: 'var(--erd-rollup)',
  [ErdFieldKind.Formula]: 'var(--erd-formula)',
  [ErdFieldKind.Other]: 'hsl(var(--muted-foreground))',
};

/** a link only joins tables, so its lines are dashed; solid lines are the ones that carry data */
export const LINK_DASH = '4 3';

export const KIND_BG: Record<ErdFieldKind, string> = {
  [ErdFieldKind.Link]: 'bg-[var(--erd-link)]',
  [ErdFieldKind.Lookup]: 'bg-[var(--erd-lookup)]',
  [ErdFieldKind.Rollup]: 'bg-[var(--erd-rollup)]',
  [ErdFieldKind.Formula]: 'bg-[var(--erd-formula)]',
  [ErdFieldKind.Other]: 'bg-muted-foreground/40',
};

const KIND_FIELD: Partial<Record<ErdFieldKind, Pick<IErdField, 'type' | 'isLookup'>>> = {
  [ErdFieldKind.Link]: { type: FieldType.Link },
  [ErdFieldKind.Lookup]: { type: FieldType.SingleLineText, isLookup: true },
  [ErdFieldKind.Rollup]: { type: FieldType.Rollup },
  [ErdFieldKind.Formula]: { type: FieldType.Formula },
};

/** props for a non-button element that acts as one: click, Enter or Space */
export const pressable = (onPress: (e: SyntheticEvent) => void) => ({
  role: 'button' as const,
  tabIndex: 0,
  onClick: onPress,
  onKeyDown: (e: KeyboardEvent) => {
    // keys on a button inside the element belong to that button
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    onPress(e);
  },
});

export const useKindIcon = () => {
  const { fieldStaticGetter } = useErd();
  return (kind: ErdFieldKind) => {
    const field = KIND_FIELD[kind];
    return field
      ? fieldStaticGetter(field.type, {
          isLookup: field.isLookup,
          hasAiConfig: false,
          deniedReadRecord: false,
        }).Icon
      : null;
  };
};

export const useFieldIcon = () => {
  const { fieldStaticGetter } = useErd();
  return (field: IErdField) =>
    fieldStaticGetter(field.type, {
      isLookup: field.isLookup,
      isConditionalLookup: field.isConditionalLookup,
      hasAiConfig: false,
      deniedReadRecord: false,
    }).Icon;
};
