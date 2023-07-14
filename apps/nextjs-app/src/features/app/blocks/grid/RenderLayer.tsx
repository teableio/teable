import type Konva from 'konva';
import dynamic from 'next/dynamic';
import type { FC } from 'react';
import type { IInteractionLayerProps } from './InteractionLayer';
import type { IColumnResizeState, IDragState, IMouseState, ISelectionState } from './interface';
import {
  drawColumnHeadersRegion,
  drawOtherRegion,
  drawFreezeRegion,
} from './renderers/layout-renderer/layoutRenderer';

const Layer = dynamic(() => import('./components/base/Layer'), { ssr: false });
const Group = dynamic(() => import('./components/base/Group'), { ssr: false });
const Shape = dynamic(() => import('./components/base/Shape'), { ssr: false });

export interface IRenderLayerProps
  extends Omit<IInteractionLayerProps, 'scrollTo' | 'scrollBy' | 'setMouseState'> {
  isEditing: boolean;
  startRowIndex: number;
  stopRowIndex: number;
  startColumnIndex: number;
  stopColumnIndex: number;
  dragState: IDragState;
  mouseState: IMouseState;
  selectionState: ISelectionState;
  columnResizeState: IColumnResizeState;
}

const defaultShapeConfig = {
  listening: false,
  perfectDrawEnabled: false,
};

export const RenderLayer: FC<React.PropsWithChildren<IRenderLayerProps>> = (props) => {
  const { coordInstance, scrollState } = props;
  const { scrollLeft, scrollTop } = scrollState;
  const { containerWidth, containerHeight } = coordInstance;

  return (
    <Layer listening={false}>
      <Group clipX={0} clipY={0} clipWidth={containerWidth} clipHeight={containerHeight}>
        <Group offsetX={scrollLeft} offsetY={scrollTop}>
          <Shape
            {...defaultShapeConfig}
            sceneFunc={(ctx: Konva.Context) => drawOtherRegion(ctx, props)}
          />
        </Group>
        <Group offsetY={scrollTop}>
          <Shape
            {...defaultShapeConfig}
            sceneFunc={(ctx: Konva.Context) => drawFreezeRegion(ctx, props)}
          />
        </Group>
        <Group offsetX={scrollLeft}>
          <Shape
            {...defaultShapeConfig}
            sceneFunc={(ctx: Konva.Context) => drawColumnHeadersRegion(ctx, props)}
          />
        </Group>
      </Group>
    </Layer>
  );
};
