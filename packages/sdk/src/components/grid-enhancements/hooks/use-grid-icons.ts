/* eslint-disable @typescript-eslint/naming-convention */
import type { RatingIcon } from '@teable/core';
import { Check, DraggableHandle, Globe, Loader2, MagicAi, Maximize2 } from '@teable/icons';
import { createElement, useMemo } from 'react';
import { useFieldStaticGetter } from '../../../hooks/use-field-static-getter';
import { FIELD_TYPE_ORDER, getSpriteMap } from '../../../utils';
import { RATING_ICON_MAP } from '../../cell-value';
import { RowControlType } from '../../grid/interface';

/** Header icon of an attachment field with public links on, in place of its type icon. */
export const PUBLIC_ATTACHMENT_ICON = 'attachment_public';
/** The same field while its space's links do not open (paused, or the plan lapsed). */
export const PUBLIC_ATTACHMENT_OFF_ICON = 'attachment_public_off';

/** Amber in both themes, like the warnings in the field settings. */
const PUBLIC_ATTACHMENT_OFF_COLOR = '#d97706';

const OffGlobe = ({ style }: { style: React.CSSProperties }) =>
  createElement(Globe, { style: { ...style, color: PUBLIC_ATTACHMENT_OFF_COLOR } });

export const useGridIcons = () => {
  const getFieldStatic = useFieldStaticGetter();

  return useMemo(() => {
    const columnHeaderIcons = getSpriteMap(
      FIELD_TYPE_ORDER.reduce<
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { type: string; IconComponent: React.JSXElementConstructor<any> }[]
      >((pre, type) => {
        const IconComponent = getFieldStatic(type, {
          isLookup: false,
          hasAiConfig: false,
        })?.Icon;
        const LookupIconComponent = getFieldStatic(type, {
          isLookup: true,
          isConditionalLookup: false,
          hasAiConfig: false,
        })?.Icon;
        const ConditionalLookupIconComponent = getFieldStatic(type, {
          isLookup: true,
          isConditionalLookup: true,
          hasAiConfig: false,
        })?.Icon;
        pre.push({ type: type, IconComponent });
        if (LookupIconComponent) {
          pre.push({ type: `${type}_lookup`, IconComponent: LookupIconComponent });
        }
        if (ConditionalLookupIconComponent) {
          pre.push({
            type: `${type}_conditional_lookup`,
            IconComponent: ConditionalLookupIconComponent,
          });
        }
        return pre;
      }, [])
    );
    const rowHeaderIcons = getSpriteMap([
      {
        type: RowControlType.Drag,
        IconComponent: DraggableHandle,
      },
      {
        type: RowControlType.Expand,
        IconComponent: Maximize2,
      },
      {
        type: RowControlType.Checkbox,
        IconComponent: Check,
      },
    ]);
    const ratingIcons = getSpriteMap(
      (Object.keys(RATING_ICON_MAP) as RatingIcon[]).map((iconKey) => ({
        type: iconKey,
        IconComponent: RATING_ICON_MAP[iconKey],
      }))
    );
    const aiIcons = getSpriteMap([
      {
        type: 'ai',
        IconComponent: MagicAi,
      },
    ]);
    const activityIcons = getSpriteMap([
      {
        type: 'calculating',
        IconComponent: Loader2,
      },
    ]);
    const publicFileIcons = getSpriteMap([
      {
        type: PUBLIC_ATTACHMENT_ICON,
        IconComponent: Globe,
      },
      {
        type: PUBLIC_ATTACHMENT_OFF_ICON,
        IconComponent: OffGlobe,
      },
    ]);
    return {
      ...columnHeaderIcons,
      ...rowHeaderIcons,
      ...ratingIcons,
      ...aiIcons,
      ...activityIcons,
      ...publicFileIcons,
    };
  }, [getFieldStatic]);
};
