import {
  AlertCircle,
  DraggableHandle,
  Maximize2,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  Lock,
  EyeOff,
} from '@teable/icons';
import { renderToString } from 'react-dom/server';

export interface ISpriteProps {
  fgColor: string;
  bgColor: string;
}

const drag = (props: ISpriteProps) => {
  const { fgColor } = props;
  return renderToString(<DraggableHandle style={{ color: fgColor }} />);
};

const detail = (props: ISpriteProps) => {
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

const expand = (props: ISpriteProps) => {
  const { fgColor } = props;
  return renderToString(<ChevronDown style={{ color: fgColor }} />);
};

const collapse = (props: ISpriteProps) => {
  const { fgColor } = props;
  return renderToString(<ChevronRight style={{ color: fgColor }} />);
};

const lock = (props: ISpriteProps) => {
  const { fgColor } = props;
  return renderToString(<Lock style={{ color: fgColor }} />);
};

export const eyeOff = (props: ISpriteProps) => {
  const { fgColor } = props;
  return renderToString(<EyeOff style={{ color: fgColor }} />);
};

export const sprites = {
  add,
  drag,
  detail,
  description,
  close,
  expand,
  collapse,
  lock,
  eyeOff,
};

export enum GridInnerIcon {
  Add = 'add',
  Drag = 'drag',
  Detail = 'detail',
  Description = 'description',
  Close = 'close',
  Expand = 'expand',
  Collapse = 'collapse',
  Lock = 'lock',
  EyeOff = 'eyeOff',
}
