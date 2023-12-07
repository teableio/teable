import { AlertCircle, DraggableHandle, Maximize2, Plus, X } from '@teable-group/icons';
import { renderToString } from 'react-dom/server';

export interface ISpriteProps {
  fgColor: string;
  bgColor: string;
}

const drag = (props: ISpriteProps) => {
  const { fgColor } = props;
  return renderToString(<DraggableHandle style={{ color: fgColor }} />);
};

const expand = (props: ISpriteProps) => {
  const { fgColor } = props;
  return renderToString(<Maximize2 style={{ color: fgColor }} />);
};

const add = (props: ISpriteProps) => {
  const { fgColor } = props;
  return renderToString(<Plus style={{ color: fgColor }} />);
};

const description = (props: ISpriteProps) => {
  const { fgColor } = props;
  return renderToString(<AlertCircle style={{ color: fgColor }} />);
};

const close = (props: ISpriteProps) => {
  const { fgColor } = props;
  return renderToString(<X style={{ color: fgColor }} />);
};

export const sprites = {
  add,
  drag,
  expand,
  description,
  close,
};

export enum GridInnerIcon {
  Add = 'add',
  Drag = 'drag',
  Expand = 'expand',
  Description = 'description',
  Close = 'close',
}
