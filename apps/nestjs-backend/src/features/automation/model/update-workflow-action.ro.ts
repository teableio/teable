import { ApiPropertyOptional } from '@nestjs/swagger';
import { MoveWorkflowActionRo } from './move-workflow-action.ro';

export class UpdateWorkflowActionRo extends MoveWorkflowActionRo {
  @ApiPropertyOptional({
    description: 'description of the action',
    example: 'action description',
  })
  description?: string;

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
