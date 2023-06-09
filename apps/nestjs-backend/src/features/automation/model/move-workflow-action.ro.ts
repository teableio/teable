import { ApiPropertyOptional } from '@nestjs/swagger';

export class MoveWorkflowActionRo {
  @ApiPropertyOptional({
    description: 'Next Id, indicating the addition of data in the node header',
    example: null,
  })
  nextNodeId?: string | null;

  @ApiPropertyOptional({
    description: 'Parent Id, indicating new data at the end of the node',
    example: null,
  })
  parentNodeId?: string | null;

  @ApiPropertyOptional({
    description: '动作创建在逻辑组入口时需要指定的参数，用下标来寻找逻辑组',
    example: 0,
  })
  parentDecisionArrayIndex?: number | null;
}
