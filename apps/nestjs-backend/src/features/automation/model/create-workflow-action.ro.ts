import { ApiPropertyOptional } from '@nestjs/swagger';
import { ActionTypeEnums } from '../enums/action-type.enum';

export class CreateWorkflowActionRo {
  @ApiPropertyOptional({
    description: 'Id of the workflow to be associated',
    example: 'wflRKLYPWS1Hrp0MD',
  })
  workflowId!: string;

  @ApiPropertyOptional({
    description: 'description of the action',
    enum: ActionTypeEnums,
    example: 'action description',
  })
  description?: string;

  @ApiPropertyOptional({
    description: 'type of action',
    enum: ActionTypeEnums,
    example: ActionTypeEnums.Webhook,
  })
  actionType?: ActionTypeEnums;

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

  @ApiPropertyOptional({
    description: `  
Use the object to create each action step used to start the workflow.

inputExpressions, type: object, example: "{url:'https://teable.io/api/table/tblwEp45tdvwTxiUl/record',...}"
inputExpressions.url, type: stringArray, example: "https://teable.io/api/table/tblwEp45tdvwTxiUl/record"
inputExpressions.body, type: stringArray, example: "['{', '"records":[', ']', '}']", rule: "Stored as an array result, each special character adds an array element, Default is Null"
inputExpressions.method, type: string, example: "POST", rule: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
inputExpressions.headers, type: objectArray, example: "[{key:'Content-Type', value: ['application/json']}]", rule: "key: string, value: array type that requires a reference to a context variable in the form '$. *' expression to insert a new element, Default is Null"
inputExpressions.responseParams, type: objectArray, example: "[{name: 'data', path: 'data.records[0].fields.singleLineText'}]", rule: "Customize the action execution result structure to attach to the engine context for subsequent action references, Default is Null"
inputExpressions.responseParams.name, type: string, example: "data"
inputExpressions.responseParams.path, type: string, example: "data.records[0].fields.singleLineText"
`,
    example: {
      url: ['https://teable.io/api/table/tblwEp45tdvwTxiUl/record'],
      body: [
        '{\n',
        '  "records": [\n',
        '  {\n',
        '    "fields": {\n',
        '      "singleLineText": "New Record"\n',
        '    }\n',
        '  }\n',
        ']\n',
        '}',
      ],
      method: 'POST',
      headers: [
        {
          key: 'Content-Type',
          value: ['application/json'],
        },
      ],
      responseParams: [],
    },
  })
  inputExpressions?: { [key: string]: unknown };
}
