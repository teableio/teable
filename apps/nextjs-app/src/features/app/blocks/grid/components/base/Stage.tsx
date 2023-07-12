import type Konva from 'konva';
import type { MutableRefObject } from 'react';
import { Stage as KonvaStage } from 'react-konva';
import type { StageProps } from 'react-konva';

const Stage = (props: StageProps & { stageRef: MutableRefObject<Konva.Stage | undefined> }) => {
  const { children, stageRef, ...rest } = props;

  return (
    <KonvaStage ref={stageRef as MutableRefObject<Konva.Stage>} {...rest}>
      {children}
    </KonvaStage>
  );
};

export default Stage;
