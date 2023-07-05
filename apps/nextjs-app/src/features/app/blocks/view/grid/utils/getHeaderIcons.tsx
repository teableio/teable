import type { SpriteMap } from '@glideapps/glide-data-grid';
import { renderToString } from 'react-dom/server';

export const getHeaderIcons = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fieldTypeOrder: { type: string; IconComponent: React.JSXElementConstructor<any> }[]
) => {
  const map: SpriteMap = {};
  fieldTypeOrder.forEach(({ type, IconComponent }) => {
    map[type] = (props: { fgColor: string; bgColor: string }) => {
      const { bgColor } = props;
      return renderToString(<IconComponent style={{ fill: bgColor }} />);
    };
  });
  return map;
};
