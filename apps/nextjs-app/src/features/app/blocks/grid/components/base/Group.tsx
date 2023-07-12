import type Konva from 'konva';
import { Group as KonvaGroup } from 'react-konva';

const Group = (props: Konva.GroupConfig) => {
  return <KonvaGroup {...props} />;
};

export default Group;
