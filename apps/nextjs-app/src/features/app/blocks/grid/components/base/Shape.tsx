import type Konva from 'konva';
import { Shape as KonvaShape } from 'react-konva';

const Shape = (props: Konva.ShapeConfig) => {
  return <KonvaShape {...props} />;
};

export default Shape;
