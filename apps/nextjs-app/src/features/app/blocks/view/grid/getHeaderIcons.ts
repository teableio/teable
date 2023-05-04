import type { SpriteMap } from '@glideapps/glide-data-grid';
import { FIELD_CONSTANT } from '@/features/app/utils/field';

const iconHead = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">`;

export const getHeaderIcons = () => {
  const map: SpriteMap = {};
  // eslint-disable-next-line @typescript-eslint/naming-convention
  FIELD_CONSTANT.forEach(({ type, IconComponent }) => {
    map[type] = (props: { fgColor: string; bgColor: string }) => {
      const { fgColor, bgColor } = props;
      return `${iconHead}<rect x="2" y="2" width="1024" height="1024" rx="2" fill="${bgColor}"/><path d="${
        IconComponent().props.children.props.d
      }" fill="${fgColor}" /></svg>`;
    };
  });
  return map;
};
