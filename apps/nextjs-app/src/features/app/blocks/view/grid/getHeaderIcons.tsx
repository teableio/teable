import type { SpriteMap } from '@glideapps/glide-data-grid';
import { renderToString } from 'react-dom/server';
import { FIELD_CONSTANT } from '@/features/app/utils/field';

export const getHeaderIcons = () => {
  const map: SpriteMap = {};
  FIELD_CONSTANT.forEach(({ type, IconComponent }) => {
    map[type] = (props: { fgColor: string; bgColor: string }) => {
      const { bgColor } = props;
      return renderToString(<IconComponent style={{ fill: bgColor }} />);
    };
  });
  return map;
};
