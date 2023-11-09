/* eslint-disable @typescript-eslint/naming-convention */
import { renderToString } from 'react-dom/server';
import type { ISpriteMap, ISpriteProps } from '../components';

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
