import { DraggableHandle, Maximize2, Plus } from '@teable-group/icons';
import { renderToString } from 'react-dom/server';

export interface ISpriteProps {
  fgColor: string;
  bgColor: string;
}

const dragIcon = (props: ISpriteProps) => {
  const { fgColor } = props;
  return renderToString(<DraggableHandle style={{ color: fgColor }} />);
};

const expandIcon = (props: ISpriteProps) => {
  const { fgColor } = props;
  return renderToString(<Maximize2 style={{ color: fgColor }} />);
};

const addIcon = (props: ISpriteProps) => {
  const { fgColor } = props;
  return renderToString(<Plus style={{ color: fgColor }} />);
};

export const sprites = {
  addIcon,
  dragIcon,
  expandIcon,
};

export type ISpriteIconMap = Readonly<typeof sprites>;
