export const CREATE_TABLE_PROMPT = `
openapi: 3.0.0
info:
  title: Teable App
  description: Manage Data as easy as drink a cup of tea
  version: 1.0.0
  contact: {}
tags: []
servers: []
paths:
  /api/table:
    post:
      operationId: TableController_createTable
      summary: Create table
      parameters: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateTableRo'
      responses:
        '201':
          description: The Table has been successfully created.
        '403':
          description: Forbidden.
      tags:
        - table
  /api/table/{tableId}/record:
    get:
      operationId: RecordOpenApiController_getRecords
      parameters:
        - name: tableId
          required: true
          in: path
          schema:
            type: string
        - name: take
          required: false
          in: query
          example: 100
          description: The record count you want to take
          schema:
            minimum: 1
            maximum: 10000
            default: 100
            type: number
        - name: skip
          required: false
          in: query
          example: 0
          description: The records count you want to skip
          schema:
            minimum: 0
            default: 0
            type: number
        - name: recordIds
          required: false
          in: query
          example: recXXXXXXX
          description: Specify the records you want to fetch
          schema:
            type: array
            items:
              type: string
        - name: viewId
          required: false
          in: query
          example: viwXXXXXXX
          description: Set the view you want to fetch, default is first view. result will influent by view options.
          schema:
            type: string
        - name: projection
          required: false
          in: query
          description: Project the fields you want to fetch, default is all fields in view.
          schema:
            type: array
            items:
              type: string
        - name: cellFormat
          required: false
          in: query
          description: value formate, you can set it to text if you only need simple string value
          schema:
            default: json
            enum:
              - json
              - text
            type: string
        - name: fieldKeyType
          required: false
          in: query
          description: Set the key of record.fields[key], default is 'id'
          schema:
            default: id
            enum:
              - id
              - name
            type: string
      responses:
        '200':
          description: list of records
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/RecordsVo'
      tags:
        - record
      security:
        - bearer: []
    post:
      operationId: RecordOpenApiController_createRecords
      summary: Create records
      parameters:
        - name: tableId
          required: true
          in: path
          description: The id for table.
          example: tbla63d4543eb5eded6
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateRecordsDto'
      responses:
        '201':
          description: The record has been successfully created.
        '403':
          description: Forbidden.
      tags:
        - record
      security:
        - bearer: []
components:
  schemas:
    SingleSelectOption:
      type: object
      properties:
        name:
          type: string
          example: light
          description: Name of the option.
        color:
          type: string
          enum:
            - blueBright
            - blueDark1
            - blueLight1
            - blueLight2
            - blue
            - cyanBright
            - cyanDark1
            - cyanLight1
            - cyanLight2
            - cyan
            - grayBright
            - grayDark1
            - grayLight1
            - grayLight2
            - gray
            - greenBright
            - greenDark1
            - greenLight1
            - greenLight2
            - green
            - orangeBright
            - orangeDark1
            - orangeLight1
            - orangeLight2
            - orange
            - pinkBright
            - pinkDark1
            - pinkLight1
            - pinkLight2
            - pink
            - purpleBright
            - purpleDark1
            - purpleLight1
            - purpleLight2
            - purple
            - redBright
            - redDark1
            - redLight1
            - redLight2
            - red
            - tealBright
            - tealDark1
            - tealLight1
            - tealLight2
            - teal
            - yellowBright
            - yellowDark1
            - yellowLight1
            - yellowLight2
            - yellow
          example: yellow
          description: The color of the option.
      required:
        - name
        - color
    SingleSelectOptionsDto:
      type: object
      properties:
        choices:
          description: 'The display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record'
          type: array
          items:
            $ref: '#/components/schemas/SingleSelectOption'
      required:
        - choices
    NumberOptionsDto:
      type: object
      properties:
        precision:
          type: number
          example: 2
          description: 'the display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record'
      required:
        - precision
    IFieldRo:
      type: object
      properties:
        name:
          type: string
          description: The name of the field.
          example: Single Select
        description:
          type: string
          description: The description of the field.
          example: this is a summary
        type:
          type: string
          description: The types supported by teable.
          example: singleSelect
          enum:
            - singleLineText
            - longText
            - user
            - attachment
            - checkbox
            - multipleSelect
            - singleSelect
            - date
            - phoneNumber
            - email
            - url
            - number
            - currency
            - percent
            - duration
            - rating
            - formula
            - rollup
            - count
            - multipleRecordLinks
            - multipleLookupValues
            - createdTime
            - lastModifiedTime
            - createdBy
            - lastModifiedBy
            - autoNumber
            - button
        options:
          description: The configuration options of the field. The structure of the field's options depend on the field's type.
          oneOf:
            - $ref: '#/components/schemas/SingleSelectOptionsDto'
            - $ref: '#/components/schemas/NumberOptionsDto'
        defaultValue:
          type: string
          description: The defaultValue of the field. The datatype of the value depends on the field type.
          example:
            name: light
            color: yellow
        isPrimary:
          type: boolean
          description: Set if it is a primary field
        notNull:
          type: boolean
          description: Set if value are not allowed to be null, not all fields support this option.
          example: false
        unique:
          type: boolean
          description: Set if value are not allowed to be duplicated, not all fields support this option.
          example: false
      required:
        - name
        - description
        - type
    GridViewOptionsDto:
      type: object
      properties:
        rowHeight:
          type: string
          example: short
          default: short
          description: The row height level of row in view
      required:
        - rowHeight
    KanbanViewOptionsDto:
      type: object
      properties:
        stackFieldId:
          type: string
          example: fldXXXXXXX
          description: The field id of the board group.
    IViewRo:
      type: object
      properties:
        name:
          type: string
          description: The name of the view.
          example: Grid view
        description:
          type: string
          description: The description of the view.
          example: this view show all records
        type:
          type: string
          description: The view type supported by teable.
          example: grid
        filter:
          type: object
          description: The filter config of the view.
        sort:
          type: object
          description: The sort config of the view.
        group:
          type: object
          description: The group config of the view.
        options:
          description: The configuration options of the View. The structure of the View's options depend on the View's type.
          oneOf:
            - $ref: '#/components/schemas/GridViewOptionsDto'
            - $ref: '#/components/schemas/KanbanViewOptionsDto'
      required:
        - name
        - description
        - type
    CreateRecordsDto:
      type: object
      properties:
        fieldKeyType:
          type: string
          description: Define the field key type when create and return records
          example: name
          default: name
          enum:
            - id
            - name
        records:
          description: |

            Array of objects with a fields key mapping fieldId or field name to value for that field.
            singleLineText, type: string, example: "bieber"
            longText, type: string, example: "line1
            line2"
            singleLineText, type: string, example: "bieber"
            attachment, type: string, example: "bieber"
            checkbox, type: string, example: "true"
            multipleSelect, type: string[], example: ["red", "green"]
            singleSelect, type: string, example: "In Progress"
            date, type: string, example: "2012/12/12"
            phoneNumber, type: string, example: "1234567890"
            email, type: string, example: "address@teable.io"
            url, type: string, example: "https://teable.io"
            number, type: number, example: 1
            currency, type: number, example: 1
            percent, type: number, example: 1
            duration, type: number, example: 1
            rating, type: number, example: 1
            formula,type: string, example: "bieber"
            rollup, type: string, example: "bieber"
            count, type: number, example: 1
            multipleRecordLinks, type: string, example: "bieber"
            multipleLookupValues, type: string, example: "bieber"
            createdTime, type: string, example: "2012/12/12 03:03"
            lastModifiedTime, type: string, example: "2012/12/12 03:03"
            createdBy, type: string, example: "bieber"
            lastModifiedBy, type: string, example: "bieber"
            autoNumber, type: number, example: 1
            button, type: string, example: "click"
          example:
            - fields:
                name: Bieber
          type: array
          items:
            type: string
      required:
        - records
    CreateTableRo:
      type: object
      properties:
        name:
          type: string
          description: The name of the table.
          example: table1
        description:
          type: string
          description: The description of the table.
          example: my favorite songs
        icon:
          type: string
          description: The icon of the table.
        fields:
          description: The fields of the table. If it is empty, 3 fields include SingleLineText, Number, SingleSelect will be generated by default.
          type: array
          items:
            $ref: '#/components/schemas/IFieldRo'
        views:
          description: The views of the table. If it is empty, a grid view will be generated by default.
          type: array
          items:
            $ref: '#/components/schemas/IViewRo'
        rows:
          description: The record data of the table. If it is empty, 3 empty records will be generated by default.
          allOf:
            - $ref: '#/components/schemas/CreateRecordsDto'
      required:
        - name
    RecordsVo:
      type: object
      properties:
        records:
          description: Array of objects with a fields key mapping fieldId or field name to value for that field.
          example:
            - id: recXXXXXXX
              fields:
                fldXXXXXXXXXXXXXXX: text value
          type: array
          items:
            type: string
        total:
          type: number
          description: Total number of records in this query.
      required:
        - records
        - total
`;
