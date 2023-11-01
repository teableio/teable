import type { ISpriteMap, ISpriteProps } from '@teable-group/sdk/components';
import { renderToString } from 'react-dom/server';

export const getSpriteMap = (
  iconItems: {
    type: string;
    IconComponent: React.JSXElementConstructor<{ style: React.CSSProperties }>;
  }[]
) => {
  const map: ISpriteMap = {};
  iconItems.forEach(({ type, IconComponent }) => {
    map[type] = (props: ISpriteProps) => {
      const { bgColor, fgColor } = props;
      return renderToString(<IconComponent style={{ color: fgColor, fill: bgColor }} />);
    };
  });
  return map;
};
