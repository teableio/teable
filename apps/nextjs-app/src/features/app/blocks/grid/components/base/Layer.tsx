import type Konva from 'konva';
import { Layer as KonvaLayer } from 'react-konva';

const Layer = (props: Konva.LayerConfig) => {
  return <KonvaLayer {...props} />;
};

export default Layer;
