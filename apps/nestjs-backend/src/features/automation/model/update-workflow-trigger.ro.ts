import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateWorkflowTriggerRo {
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
