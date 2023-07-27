import { renderToString } from 'react-dom/server';
import type { ISpriteMap, ISpriteProps } from '../../../grid/managers';

export const getHeaderIcons = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fieldTypeOrder: { type: string; IconComponent: React.JSXElementConstructor<any> }[]
) => {
  const map: ISpriteMap = {};
  fieldTypeOrder.forEach(({ type, IconComponent }) => {
    map[type] = (props: ISpriteProps) => {
      const { bgColor } = props;
      return renderToString(<IconComponent style={{ color: bgColor }} />);
    };
  });
  return map;
};
