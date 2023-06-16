/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable prettier/prettier */

import type { DateFormatting } from "@teable-group/core";

export interface paths {
  "/api/file-tree/*": {
    get: operations["FileTreeController_getFileTree"];
  };
  "/api/teable/schema/{tableId}": {
    get: operations["FileTreeController_getTableMeta"];
  };
  "/api/file-content/*": {
    get: operations["FileTreeController_getFileContent"];
  };
  "/api/table/ssr/{tableId}/view-id": {
    get: operations["TableController_getDefaultViewId"];
  };
  "/api/table/ssr/{tableId}/{viewId}": {
    get: operations["TableController_getFullSSRSnapshot"];
  };
  "/api/table/ssr": {
    get: operations["TableController_getTableSSRSnapshot"];
  };
  "/api/table": {
    /** Create table */
    post: operations["TableController_createTable"];
  };
  "/api/table/{tableId}": {
    /** Delete table */
    delete: operations["TableController_archiveTable"];
  };
  "/api/table/arbitrary/{tableId}": {
    delete: operations["TableController_deleteTableArbitrary"];
  };
  "/api/chart/completions": {
    /** Chat completions */
    post: operations["ChatController_completions"];
  };
  "/api/attachments/upload/{token}": {
    post: operations["AttachmentsController_uploadFile"];
  };
  "/api/attachments/{token}": {
    /** Get file stream */
    get: operations["AttachmentsController_read"];
  };
  "/api/attachments/signature": {
    post: operations["AttachmentsController_signature"];
  };
  "/api/attachments/notify/{secret}": {
    post: operations["AttachmentsController_notify"];
  };
  "/api/table/{tableId}/field/{fieldId}": {
    /** Get a specific field */
    get: operations["FieldOpenApiController_getField"];
    /** Update field by id */
    put: operations["FieldOpenApiController_updateFieldById"];
  };
  "/api/table/{tableId}/field": {
    /** Batch fetch fields */
    get: operations["FieldOpenApiController_getFields"];
    /** Create Field */
    post: operations["FieldOpenApiController_createField"];
  };
  "/api/table/{tableId}/record": {
    get: operations["RecordOpenApiController_getRecords"];
    /** Update records by row index */
    put: operations["RecordOpenApiController_updateRecordByIndex"];
    /** Create records */
    post: operations["RecordOpenApiController_createRecords"];
  };
  "/api/table/{tableId}/record/{recordId}": {
    get: operations["RecordOpenApiController_getRecord"];
    /** Update records by id. */
    put: operations["RecordOpenApiController_updateRecordById"];
  };
  "/api/table/{tableId}/view/{viewId}": {
    /** Get a specific view */
    get: operations["ViewOpenApiController_getView"];
  };
  "/api/table/{tableId}/view": {
    /** Batch fetch views */
    get: operations["ViewOpenApiController_getViews"];
    /** Create view */
    post: operations["ViewOpenApiController_createView"];
  };
}

export type webhooks = Record<string, never>;

export interface components {
  schemas: {
    DefaultViewVo: {
      /** @description default view id in table */
      id: string;
    };
    TableSSRDefaultViewIdVo: {
      /**
       * @description If success. 
       * @example true
       */
      success: boolean;
      /** @description response data */
      data: components["schemas"]["DefaultViewVo"];
    };
    Record: {
      /** @description The record id. */
      id: string;
      /** @description Objects with a fields key mapping fieldId or field name to value for that field. */
      fields: Record<string, never>;
      /** @description Created time, milliseconds timestamp. */
      createdTime?: number;
      /** @description Last modified time, milliseconds timestamp. */
      lastModifiedTime?: number;
      /** @description Created by, user name */
      createdBy?: string;
      /** @description Last modified by, user name */
      lastModifiedBy?: string;
    };
    RecordsVo: {
      /**
       * @description Array of objects with a fields key mapping fieldId or field name to value for that field. 
       * @example [
       *   {
       *     "id": "recXXXXXXX",
       *     "fields": {
       *       "fldXXXXXXXXXXXXXXX": "text value"
       *     }
       *   }
       * ]
       */
      records: (components["schemas"]["Record"])[];
      /** @description Total number of records in this query. */
      total: number;
    };
    NumberOptionsDto: {
      /**
       * @description the display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record 
       * @example 2
       */
      precision: number;
    };
    DateOptionsDto: {
      /**
       * @description the display formatting of the date, caveat: the formatting is just a formatter, it dose not effect the storing value of the record 
       * @example "YYYY/MM/DD"
       */
      formatting: DateFormatting;
      autoFill: boolean;
    };
    SingleSelectOption: {
      /**
       * @description Name of the option. 
       * @example light
       */
      name: string;
      /**
       * @description The color of the option. 
       * @example yellow 
       * @enum {string}
       */
      color: "blueBright" | "blueDark1" | "blueLight1" | "blueLight2" | "blue" | "cyanBright" | "cyanDark1" | "cyanLight1" | "cyanLight2" | "cyan" | "grayBright" | "grayDark1" | "grayLight1" | "grayLight2" | "gray" | "greenBright" | "greenDark1" | "greenLight1" | "greenLight2" | "green" | "orangeBright" | "orangeDark1" | "orangeLight1" | "orangeLight2" | "orange" | "pinkBright" | "pinkDark1" | "pinkLight1" | "pinkLight2" | "pink" | "purpleBright" | "purpleDark1" | "purpleLight1" | "purpleLight2" | "purple" | "redBright" | "redDark1" | "redLight1" | "redLight2" | "red" | "tealBright" | "tealDark1" | "tealLight1" | "tealLight2" | "teal" | "yellowBright" | "yellowDark1" | "yellowLight1" | "yellowLight2" | "yellow";
    };
    SingleSelectOptionsDto: {
      /** @description The display precision of the number, caveat: the precision is just a formatter, it dose not effect the storing value of the record */
      choices: (components["schemas"]["SingleSelectOption"])[];
    };
    LinkOptionsDto: {
      /**
       * @description describe the relationship from this table to the foreign table 
       * @enum {string}
       */
      relationship: "manyMany" | "oneMany" | "manyOne";
      /** @description the table this field is linked to */
      foreignTableId: string;
      /** @description The value of the lookup Field in the associated table will be displayed as the current field. */
      lookupFieldId: string;
      /** @description The foreign key field name used to store values in the db table. */
      dbForeignKeyName: string;
      /** @description the symmetric field in the foreign table. */
      symmetricFieldId: string;
    };
    CreateFieldRo: {
      /**
       * @description The name of the field. 
       * @example Single Select
       */
      name: string;
      /**
       * @description The description of the field. 
       * @example this is a summary
       */
      description: string;
      /**
       * @description The types supported by teable. 
       * @example singleSelect 
       * @enum {string}
       */
      type: "singleLineText" | "longText" | "user" | "attachment" | "checkbox" | "multipleSelect" | "singleSelect" | "date" | "phoneNumber" | "email" | "url" | "number" | "currency" | "percent" | "duration" | "rating" | "formula" | "rollup" | "count" | "link" | "multipleLookupValues" | "createdTime" | "lastModifiedTime" | "createdBy" | "lastModifiedBy" | "autoNumber" | "button";
      /** @description The configuration options of the field. The structure of the field's options depend on the field's type. */
      options?: components["schemas"]["LinkOptionsDto"] | components["schemas"]["SingleSelectOptionsDto"] | components["schemas"]["NumberOptionsDto"];
      /**
       * @description 
       * The defaultValue of the field. The datatype of the value depends on the field type.
       * singleLineText, longText, singleSelect, date, phoneNumber, email, url: string, example: "hello".
       * number, currency, percent, duration, rating: number, example: 1.
       * checkbox: boolean, example: true.
       * multipleSelect: string[], example: ["red", "blue"].
       * other fields do not support defaultValue.
       *  
       * @example {
       *   "name": "light",
       *   "color": "yellow"
       * }
       */
      defaultValue?: Record<string, never>;
      /** @description Set if it is a primary field */
      isPrimary?: boolean;
      /**
       * @description Set if value are not allowed to be null, not all fields support this option. 
       * @example false
       */
      notNull?: boolean;
      /**
       * @description Set if value are not allowed to be duplicated, not all fields support this option. 
       * @example false
       */
      unique?: boolean;
    };
    KanbanViewOptionsDto: {
      /**
       * @description The field id of the board group. 
       * @example fldXXXXXXX
       */
      groupingFieldId?: string;
    };
    GridViewOptionsDto: {
      /**
       * @description The row height level of row in view 
       * @default short 
       * @example short
       */
      rowHeight: string;
    };
    CreateViewRo: {
      /**
       * @description The name of the view. 
       * @example Grid view
       */
      name: string;
      /**
       * @description The description of the view. 
       * @example this view show all records
       */
      description: string;
      /**
       * @description The view type supported by teable. 
       * @example grid
       */
      type: string;
      /** @description The filter config of the view. */
      filter?: Record<string, never>;
      /** @description The sort config of the view. */
      sort?: Record<string, never>;
      /** @description The group config of the view. */
      group?: Record<string, never>;
      /** @description The configuration options of the View. The structure of the View's options depend on the View's type. */
      options?: components["schemas"]["GridViewOptionsDto"] | components["schemas"]["KanbanViewOptionsDto"];
      /** @description The order config of the view. */
      order?: number;
    };
    CreateRecordsRo: {
      /**
       * @description Define the field key type when create and return records 
       * @default name 
       * @example name 
       * @enum {string}
       */
      fieldKeyType?: "id" | "name";
      /**
       * @description 
       * Array of objects with a fields key mapping fieldId or field name to value for that field.
       * 
       * singleLineText, type: string, example: "bieber"
       * longText, type: string, example: "line1
       * line2"
       * singleLineText, type: string, example: "bieber"
       * attachment, type: string, example: "bieber"
       * checkbox, type: string, example: "true"
       * multipleSelect, type: string[], example: ["red", "green"]
       * singleSelect, type: string, example: "In Progress"
       * date, type: string, example: "2012/12/12"
       * phoneNumber, type: string, example: "1234567890"
       * email, type: string, example: "address@teable.io"
       * url, type: string, example: "https://teable.io"
       * number, type: number, example: 1
       * currency, type: number, example: 1
       * percent, type: number, example: 1
       * duration, type: number, example: 1
       * rating, type: number, example: 1
       * formula,type: string, example: "bieber"
       * rollup, type: string, example: "bieber"
       * count, type: number, example: 1
       * multipleRecordLinks, type: string, example: "bieber"
       * multipleLookupValues, type: string, example: "bieber"
       * createdTime, type: string, example: "2012/12/12 03:03"
       * lastModifiedTime, type: string, example: "2012/12/12 03:03"
       * createdBy, type: string, example: "bieber"
       * lastModifiedBy, type: string, example: "bieber"
       * autoNumber, type: number, example: 1
       * button, type: string, example: "click"
       * 
       *  
       * @example [
       *   {
       *     "fields": {
       *       "name": "Bieber"
       *     }
       *   }
       * ]
       */
      records: (string)[];
    };
    TableVo: {
      /**
       * @description The name of the table. 
       * @example table1
       */
      name: string;
      /**
       * @description The description of the table. 
       * @example my favorite songs
       */
      description?: string;
      /** @description The icon of the table. */
      icon?: string;
      /** @description The fields of the table. If it is empty, 3 fields include SingleLineText, Number, SingleSelect will be generated by default. */
      fields?: (components["schemas"]["CreateFieldRo"])[];
      /** @description The views of the table. If it is empty, a grid view will be generated by default. */
      views?: (components["schemas"]["CreateViewRo"])[];
      /** @description The record data of the table. If it is empty, 3 empty records will be generated by default. */
      data?: components["schemas"]["CreateRecordsRo"];
      /** @description The order of the table. */
      order?: number;
      /**
       * @description The id of table. 
       * @example tblxxxxxxx
       */
      id: string;
    };
    ViewVo: {
      /**
       * @description The name of the view. 
       * @example Grid view
       */
      name: string;
      /**
       * @description The description of the view. 
       * @example this view show all records
       */
      description: string;
      /**
       * @description The view type supported by teable. 
       * @example grid
       */
      type: string;
      /** @description The filter config of the view. */
      filter?: Record<string, never>;
      /** @description The sort config of the view. */
      sort?: Record<string, never>;
      /** @description The group config of the view. */
      group?: Record<string, never>;
      /** @description The configuration options of the View. The structure of the View's options depend on the View's type. */
      options?: components["schemas"]["GridViewOptionsDto"] | components["schemas"]["KanbanViewOptionsDto"];
      /** @description The order config of the view. */
      order?: number;
      /**
       * @description The id of the view. 
       * @example viwXXXXXXXX
       */
      id: string;
    };
    FieldVo: {
      /**
       * @description The name of the field. 
       * @example Single Select
       */
      name: string;
      /**
       * @description The description of the field. 
       * @example this is a summary
       */
      description: string;
      /**
       * @description The types supported by teable. 
       * @example singleSelect 
       * @enum {string}
       */
      type: "singleLineText" | "longText" | "user" | "attachment" | "checkbox" | "multipleSelect" | "singleSelect" | "date" | "phoneNumber" | "email" | "url" | "number" | "currency" | "percent" | "duration" | "rating" | "formula" | "rollup" | "count" | "link" | "multipleLookupValues" | "createdTime" | "lastModifiedTime" | "createdBy" | "lastModifiedBy" | "autoNumber" | "button";
      /** @description The configuration options of the field. The structure of the field's options depend on the field's type. */
      options?: components["schemas"]["LinkOptionsDto"] | components["schemas"]["SingleSelectOptionsDto"] | components["schemas"]["NumberOptionsDto"];
      /**
       * @description 
       * The defaultValue of the field. The datatype of the value depends on the field type.
       * singleLineText, longText, singleSelect, date, phoneNumber, email, url: string, example: "hello".
       * number, currency, percent, duration, rating: number, example: 1.
       * checkbox: boolean, example: true.
       * multipleSelect: string[], example: ["red", "blue"].
       * other fields do not support defaultValue.
       *  
       * @example {
       *   "name": "light",
       *   "color": "yellow"
       * }
       */
      defaultValue?: Record<string, never>;
      /** @description Set if it is a primary field */
      isPrimary?: boolean;
      /**
       * @description Set if value are not allowed to be null, not all fields support this option. 
       * @example false
       */
      notNull?: boolean;
      /**
       * @description Set if value are not allowed to be duplicated, not all fields support this option. 
       * @example false
       */
      unique?: boolean;
      /**
       * @description The id of the field. 
       * @example fldXXXXXXXX
       */
      id: string;
      /**
       * @description The field type after calculated. 
       * @example singleLineText 
       * @enum {string}
       */
      calculatedType: "singleLineText" | "longText" | "user" | "attachment" | "checkbox" | "multipleSelect" | "singleSelect" | "date" | "phoneNumber" | "email" | "url" | "number" | "currency" | "percent" | "duration" | "rating" | "formula" | "rollup" | "count" | "link" | "multipleLookupValues" | "createdTime" | "lastModifiedTime" | "createdBy" | "lastModifiedBy" | "autoNumber" | "button";
      /**
       * @description The basic data type of cellValue. 
       * @example string 
       * @enum {string}
       */
      cellValueType: "string" | "number" | "boolean" | "dateTime";
      /**
       * @description The inner element data type of a array type cellValue. 
       * @example string 
       * @enum {string}
       */
      isMultipleCellValue?: "boolean";
      /**
       * @description true if this field is computed, false otherwise. A field is "computed" if it's value is not set by user input (e.g. autoNumber, formula, etc.). 
       * @example false
       */
      isComputed?: boolean;
      /**
       * @description The real field type in database. 
       * @enum {string}
       */
      dbFieldType: "TEXT" | "INTEGER" | "REAL" | "BLOB" | "JSON";
      /**
       * @description The field meta include width, statistics, hidden, order property for every view. 
       * @example false
       */
      columnMeta: Record<string, never>;
    };
    FullSnapshotVo: {
      rows: components["schemas"]["RecordsVo"];
      tables: (components["schemas"]["TableVo"])[];
      views: (components["schemas"]["ViewVo"])[];
      fields: (components["schemas"]["FieldVo"])[];
    };
    FullSSRSnapshotVo: {
      /**
       * @description If success. 
       * @example true
       */
      success: boolean;
      /** @description response data */
      data: components["schemas"]["FullSnapshotVo"];
    };
    TableSnapshotVo: {
      tables: (components["schemas"]["TableVo"])[];
    };
    TableSSRSnapshotVo: {
      /**
       * @description If success. 
       * @example true
       */
      success: boolean;
      /** @description response data */
      data: components["schemas"]["TableSnapshotVo"];
    };
    CreateTableRo: {
      /**
       * @description The name of the table. 
       * @example table1
       */
      name: string;
      /**
       * @description The description of the table. 
       * @example my favorite songs
       */
      description?: string;
      /** @description The icon of the table. */
      icon?: string;
      /** @description The fields of the table. If it is empty, 3 fields include SingleLineText, Number, SingleSelect will be generated by default. */
      fields?: (components["schemas"]["CreateFieldRo"])[];
      /** @description The views of the table. If it is empty, a grid view will be generated by default. */
      views?: (components["schemas"]["CreateViewRo"])[];
      /** @description The record data of the table. If it is empty, 3 empty records will be generated by default. */
      data?: components["schemas"]["CreateRecordsRo"];
      /** @description The order of the table. If it is empty, table will be put to the last one. */
      order?: number;
    };
    CompletionRo: {
      /**
       * @description The prompt message. 
       * @example List table
       */
      message: string;
    };
    AttachmentUploadVo: {
      /** Format: binary */
      file: string;
    };
    AttachmentSignatureRo: {
      /**
       * @description Upload url 
       * @example https://example.com/attachment/upload
       */
      url: string;
      /**
       * @description Secret key 
       * @example xxxxxxxx
       */
      secret: string;
    };
    AttachmentNotifyRo: {
      /**
       * @description Token for the uploaded file 
       * @example xxxxxxxxxxx
       */
      token: string;
      /**
       * @description File size in bytes 
       * @example 1024
       */
      size: number;
      /**
       * @description MIME type of the uploaded file 
       * @example video/mp4
       */
      mimetype: string;
      /**
       * @description URL of the uploaded file 
       * @example /attachments
       */
      path: string;
      /**
       * @description Image width of the uploaded file 
       * @example 11
       */
      width: number;
      /**
       * @description Image height of the uploaded file 
       * @example /attachments
       */
      height: number;
    };
    FieldResponseVo: {
      /**
       * @description If success. 
       * @example true
       */
      success: boolean;
      /** @description response data */
      data: components["schemas"]["FieldVo"];
    };
    FieldsResponseVo: {
      /**
       * @description If success. 
       * @example true
       */
      success: boolean;
      /** @description response data */
      data: (components["schemas"]["FieldVo"])[];
    };
    ApiResponse: {
      /**
       * @description If success. 
       * @example true
       */
      success: boolean;
      /** @description response data */
      data: Record<string, never>;
    };
    UpdateFieldRo: {
      /**
       * @description The name of the field. 
       * @example Single Select
       */
      name: string;
      /**
       * @description The description of the field. 
       * @example this is a summary
       */
      description: string;
      /**
       * @description The types supported by teable. 
       * @example singleSelect 
       * @enum {string}
       */
      type: "singleLineText" | "longText" | "user" | "attachment" | "checkbox" | "multipleSelect" | "singleSelect" | "date" | "phoneNumber" | "email" | "url" | "number" | "currency" | "percent" | "duration" | "rating" | "formula" | "rollup" | "count" | "link" | "multipleLookupValues" | "createdTime" | "lastModifiedTime" | "createdBy" | "lastModifiedBy" | "autoNumber" | "button";
      /** @description The configuration options of the field. The structure of the field's options depend on the field's type. */
      options?: components["schemas"]["SingleSelectOptionsDto"] | components["schemas"]["NumberOptionsDto"];
      /**
       * @description 
       * The defaultValue of the field. The datatype of the value depends on the field type.
       * singleLineText, longText, singleSelect, date, phoneNumber, email, url: string, example: "hello".
       * number, currency, percent, duration, rating: number, example: 1.
       * checkbox: boolean, example: true.
       * multipleSelect: string[], example: ["red", "blue"].
       * other fields do not support defaultValue.
       *  
       * @example light
       */
      defaultValue?: Record<string, never>;
    };
    UpdateRecordRo: {
      /**
       * @description Define the field key type when create and return records 
       * @default name 
       * @example name 
       * @enum {string}
       */
      fieldKeyType?: "id" | "name";
      /**
       * @description 
       * object with a fields key mapping fieldId or field name to value for that field.
       * 
       * singleLineText, type: string, example: "bieber"
       * longText, type: string, example: "line1
       * line2"
       * singleLineText, type: string, example: "bieber"
       * attachment, type: string, example: "bieber"
       * checkbox, type: string, example: "true"
       * multipleSelect, type: string[], example: ["red", "green"]
       * singleSelect, type: string, example: "In Progress"
       * date, type: string, example: "2012/12/12"
       * phoneNumber, type: string, example: "1234567890"
       * email, type: string, example: "address@teable.io"
       * url, type: string, example: "https://teable.io"
       * number, type: number, example: 1
       * currency, type: number, example: 1
       * percent, type: number, example: 1
       * duration, type: number, example: 1
       * rating, type: number, example: 1
       * formula,type: string, example: "bieber"
       * rollup, type: string, example: "bieber"
       * count, type: number, example: 1
       * multipleRecordLinks, type: string, example: "bieber"
       * multipleLookupValues, type: string, example: "bieber"
       * createdTime, type: string, example: "2012/12/12 03:03"
       * lastModifiedTime, type: string, example: "2012/12/12 03:03"
       * createdBy, type: string, example: "bieber"
       * lastModifiedBy, type: string, example: "bieber"
       * autoNumber, type: number, example: 1
       * button, type: string, example: "click"
       * 
       *  
       * @example {
       *   "fields": {
       *     "name": "Bieber"
       *   }
       * }
       */
      record: Record<string, never>;
    };
    UpdateRecordRoByIndexRo: {
      /**
       * @description Define the field key type when create and return records 
       * @default name 
       * @example name 
       * @enum {string}
       */
      fieldKeyType?: "id" | "name";
      /**
       * @description 
       * object with a fields key mapping fieldId or field name to value for that field.
       * 
       * singleLineText, type: string, example: "bieber"
       * longText, type: string, example: "line1
       * line2"
       * singleLineText, type: string, example: "bieber"
       * attachment, type: string, example: "bieber"
       * checkbox, type: string, example: "true"
       * multipleSelect, type: string[], example: ["red", "green"]
       * singleSelect, type: string, example: "In Progress"
       * date, type: string, example: "2012/12/12"
       * phoneNumber, type: string, example: "1234567890"
       * email, type: string, example: "address@teable.io"
       * url, type: string, example: "https://teable.io"
       * number, type: number, example: 1
       * currency, type: number, example: 1
       * percent, type: number, example: 1
       * duration, type: number, example: 1
       * rating, type: number, example: 1
       * formula,type: string, example: "bieber"
       * rollup, type: string, example: "bieber"
       * count, type: number, example: 1
       * multipleRecordLinks, type: string, example: "bieber"
       * multipleLookupValues, type: string, example: "bieber"
       * createdTime, type: string, example: "2012/12/12 03:03"
       * lastModifiedTime, type: string, example: "2012/12/12 03:03"
       * createdBy, type: string, example: "bieber"
       * lastModifiedBy, type: string, example: "bieber"
       * autoNumber, type: number, example: 1
       * button, type: string, example: "click"
       * 
       *  
       * @example {
       *   "fields": {
       *     "name": "Bieber"
       *   }
       * }
       */
      record: Record<string, never>;
      /** @description The view where the row is located. */
      viewId: string;
      /** @description The row index in the view. */
      index: number;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}

export type external = Record<string, never>;

export interface operations {

  FileTreeController_getFileTree: {
    responses: {
      200: never;
    };
  };
  FileTreeController_getTableMeta: {
    responses: {
      200: never;
    };
  };
  FileTreeController_getFileContent: {
    responses: {
      200: never;
    };
  };
  TableController_getDefaultViewId: {
    parameters: {
      path: {
        tableId: string;
      };
    };
    responses: {
      /** @description default id in table */
      200: {
        content: {
          "application/json": components["schemas"]["TableSSRDefaultViewIdVo"];
        };
      };
    };
  };
  TableController_getFullSSRSnapshot: {
    parameters: {
      path: {
        tableId: string;
        viewId: string;
      };
    };
    responses: {
      /** @description ssr snapshot */
      200: {
        content: {
          "application/json": components["schemas"]["FullSSRSnapshotVo"];
        };
      };
    };
  };
  TableController_getTableSSRSnapshot: {
    responses: {
      /** @description ssr snapshot */
      200: {
        content: {
          "application/json": components["schemas"]["TableSSRSnapshotVo"];
        };
      };
    };
  };
  /** Create table */
  TableController_createTable: {
    requestBody: {
      content: {
        "application/json": components["schemas"]["CreateTableRo"];
      };
    };
    responses: {
      /** @description The table has been successfully created. */
      201: {
        content: {
          "application/json": components["schemas"]["TableVo"];
        };
      };
      /** @description Forbidden. */
      403: never;
    };
  };
  /** Delete table */
  TableController_archiveTable: {
    parameters: {
      path: {
        tableId: string;
      };
    };
    responses: {
      /** @description The table has been removed to trash. */
      200: never;
      /** @description Forbidden. */
      403: never;
    };
  };
  TableController_deleteTableArbitrary: {
    parameters: {
      path: {
        tableId: string;
      };
    };
    responses: {
      200: never;
    };
  };
  /** Chat completions */
  ChatController_completions: {
    requestBody: {
      content: {
        "application/json": components["schemas"]["CompletionRo"];
      };
    };
    responses: {
      /** @description Forbidden. */
      403: never;
    };
  };
  AttachmentsController_uploadFile: {
    parameters: {
      path: {
        token: string;
      };
    };
    /** @description upload attachment */
    requestBody: {
      content: {
        "multipart/form-data": components["schemas"]["AttachmentUploadVo"];
      };
    };
    responses: {
      201: never;
    };
  };
  /** Get file stream */
  AttachmentsController_read: {
    parameters: {
      query: {
        /** @description File name for download */
        filename?: string;
      };
      path: {
        token: string;
      };
    };
    responses: {
      200: never;
    };
  };
  AttachmentsController_signature: {
    responses: {
      /** @description I need to retrieve the upload URL and the key. */
      200: {
        content: {
          "application/json": components["schemas"]["AttachmentSignatureRo"];
        };
      };
    };
  };
  AttachmentsController_notify: {
    parameters: {
      path: {
        secret: string;
      };
    };
    responses: {
      /** @description Attachment information */
      200: {
        content: {
          "application/json": components["schemas"]["AttachmentNotifyRo"];
        };
      };
    };
  };
  /** Get a specific field */
  FieldOpenApiController_getField: {
    parameters: {
      path: {
        tableId: string;
        fieldId: string;
      };
    };
    responses: {
      /** @description Field */
      200: {
        content: {
          "application/json": components["schemas"]["FieldResponseVo"];
        };
      };
    };
  };
  /** Update field by id */
  FieldOpenApiController_updateFieldById: {
    parameters: {
      path: {
        tableId: string;
        fieldId: string;
      };
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["UpdateFieldRo"];
      };
    };
    responses: {
      /** @description The field has been successfully updated. */
      200: never;
      /** @description Forbidden. */
      403: never;
    };
  };
  /** Batch fetch fields */
  FieldOpenApiController_getFields: {
    parameters: {
      query: {
        /**
         * @description Set the view you want to fetch, default is first view. result will influent by view options. 
         * @example viwXXXXXXX
         */
        viewId?: string;
      };
      path: {
        tableId: string;
      };
    };
    responses: {
      /** @description Field */
      200: {
        content: {
          "application/json": components["schemas"]["FieldsResponseVo"];
        };
      };
      /** @description Forbidden. */
      403: never;
    };
  };
  /** Create Field */
  FieldOpenApiController_createField: {
    parameters: {
      path: {
        tableId: string;
      };
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["CreateFieldRo"];
      };
    };
    responses: {
      /** @description Field */
      200: {
        content: {
          "application/json": (components["schemas"]["ApiResponse"])[];
        };
      };
      /** @description The field has been successfully created. */
      201: never;
      /** @description Forbidden. */
      403: never;
    };
  };
  RecordOpenApiController_getRecords: {
    parameters: {
      query: {
        /**
         * @description The record count you want to take 
         * @example 100
         */
        take?: number;
        /**
         * @description The records count you want to skip 
         * @example 0
         */
        skip?: number;
        /**
         * @description Specify the records you want to fetch 
         * @example recXXXXXXX
         */
        recordIds?: (string)[];
        /**
         * @description Set the view you want to fetch, default is first view. result will influent by view options. 
         * @example viwXXXXXXX
         */
        viewId?: string;
        /** @description Project the fields you want to fetch, default is all fields in view. */
        projection?: (string)[];
        /** @description value formate, you can set it to text if you only need simple string value */
        cellFormat?: "json" | "text";
        /** @description Set the key of record.fields[key], default is "name" */
        fieldKey?: "id" | "name";
      };
      path: {
        tableId: string;
      };
    };
    responses: {
      /** @description list of records */
      200: {
        content: {
          "application/json": components["schemas"]["ApiResponse"];
        };
      };
    };
  };
  /** Update records by row index */
  RecordOpenApiController_updateRecordByIndex: {
    parameters: {
      path: {
        /**
         * @description The id for table. 
         * @example tbla63d4543eb5eded6
         */
        tableId: string;
      };
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["UpdateRecordRoByIndexRo"];
      };
    };
    responses: {
      /** @description The record has been successfully updated. */
      200: {
        content: {
          "application/json": components["schemas"]["ApiResponse"];
        };
      };
      /** @description Forbidden. */
      403: never;
    };
  };
  /** Create records */
  RecordOpenApiController_createRecords: {
    parameters: {
      path: {
        /**
         * @description The id for table. 
         * @example tbla63d4543eb5eded6
         */
        tableId: string;
      };
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["CreateRecordsRo"];
      };
    };
    responses: {
      /** @description The record has been successfully created. */
      201: {
        content: {
          "application/json": components["schemas"]["ApiResponse"];
        };
      };
      /** @description Forbidden. */
      403: never;
    };
  };
  RecordOpenApiController_getRecord: {
    parameters: {
      path: {
        tableId: string;
        recordId: string;
      };
    };
    responses: {
      /** @description Get record by id. */
      200: {
        content: {
          "application/json": components["schemas"]["ApiResponse"];
        };
      };
    };
  };
  /** Update records by id. */
  RecordOpenApiController_updateRecordById: {
    parameters: {
      path: {
        /**
         * @description The id for table. 
         * @example tbla63d4543eb5eded6
         */
        tableId: string;
        recordId: string;
      };
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["UpdateRecordRo"];
      };
    };
    responses: {
      /** @description The record has been successfully updated. */
      200: {
        content: {
          "application/json": components["schemas"]["ApiResponse"];
        };
      };
      /** @description Forbidden. */
      403: never;
    };
  };
  /** Get a specific view */
  ViewOpenApiController_getView: {
    parameters: {
      path: {
        tableId: string;
        viewId: string;
      };
    };
    responses: {
      /** @description View */
      200: {
        content: {
          "application/json": components["schemas"]["ViewVo"];
        };
      };
    };
  };
  /** Batch fetch views */
  ViewOpenApiController_getViews: {
    parameters: {
      path: {
        tableId: string;
      };
    };
    responses: {
      /** @description View */
      200: {
        content: {
          "application/json": (components["schemas"]["ViewVo"])[];
        };
      };
      /** @description Forbidden. */
      403: never;
    };
  };
  /** Create view */
  ViewOpenApiController_createView: {
    parameters: {
      path: {
        tableId: string;
      };
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["CreateViewRo"];
      };
    };
    responses: {
      /** @description The view has been successfully created. */
      201: {
        content: {
          "application/json": components["schemas"]["ViewVo"];
        };
      };
      /** @description Forbidden. */
      403: never;
    };
  };
}
