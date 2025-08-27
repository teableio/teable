import { BezierEdge, BaseEdge, type EdgeProps } from 'reactflow';

export const SelfConnectingEdge = (props: EdgeProps) => {
  if (props.source !== props.target) {
    return <BezierEdge {...props} />;
  }

  const { sourceX, sourceY, targetX, targetY } = props;
  const x = Math.max(sourceX, targetX);
  const part = (targetY - sourceY) / 3;
  const point1 = { x: x + 50, y: sourceY + part };
  const point2 = { x: x + 50, y: sourceY + part * 2 };
  const labelX = (point1.x + point2.x) / 2;
  const labelY = (point1.y + point2.y) / 2;

  const edgePath = `M ${x} ${sourceY} C ${point1.x} ${point1.y} ${point2.x} ${point2.y} ${x} ${targetY}`;
  return <BaseEdge {...props} path={edgePath} labelX={labelX} labelY={labelY} />;
};
