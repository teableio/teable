import { ApiPropertyOptional } from '@nestjs/swagger';
import { TriggerTypeEnums } from 'src/features/automation/enums/trigger-type.enum';

export class CreateWorkflowTriggerRo {
  @ApiPropertyOptional({
    description: 'Id of the workflow to be associated',
    example: 'wflRKLYPWS1Hrp0MD',
  })
  workflowId!: string;

  @ApiPropertyOptional({
    description: 'trigger type',
    enum: TriggerTypeEnums,
    example: TriggerTypeEnums.RecordCreated,
  })
  triggerType!: TriggerTypeEnums;

  @ApiPropertyOptional({
    description: `
Use the object to create a trigger for starting a workflow.

inputExpressions, type: object, example: {tableId:"tblwEp45tdvwTxiUl"}
inputExpressions.tableId, type: string, example: "wtrdS3OIXzjyRyvnP", rule: "a string starting with 'wtr' and followed by 14 alphanumeric characters"
`,
    example: {
      tableId: 'tblwEp45tdvwTxiUl',
    },
  })
  inputExpressions?: { [key: string]: unknown };
}
