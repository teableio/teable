import { Injectable, Scope } from '@nestjs/common';
import { FieldKeyType } from '@teable-group/core';
import type { Almanac, Event, RuleResult } from 'json-rules-engine';
import type { CreateRecordsRo } from '../../../../record/create-records.ro';
import { RecordOpenApiService } from '../../../../record/open-api/record-open-api.service';
import { JsonSchemaParser } from '../../../engine/json-schema-parser.class';
import type { IActionResponse, ITypeValueSchema, ITypePropertiesSchema } from '../../action-core';
import { actionConst, ActionCore, ActionResponseStatus } from '../../action-core';

export interface ICreateRecordSchema extends Record<string, unknown> {
  tableId: ITypeValueSchema;
  fields: ITypePropertiesSchema;
}

@Injectable({ scope: Scope.REQUEST })
export class CreateRecord extends ActionCore {
  constructor(private readonly recordOpenApiService: RecordOpenApiService) {
    super();
  }

  bindParams(id: string, params: ICreateRecordSchema, priority?: number): this {
    return this.setName(id)
      .setEvent({ type: id, params: params })
      .setPriority(priority ? priority : 1);
  }

  onSuccess = async (event: Event, almanac: Almanac, _ruleResult: RuleResult): Promise<void> => {
    const jsonSchemaParser = new JsonSchemaParser(event.params as ICreateRecordSchema, {
      pathResolver: async (_, path) => {
        const [id, p] = path;
        return await almanac.factValue(id, undefined, p);
      },
    });
    const { tableId, fields } = (await jsonSchemaParser.parse()) as {
      tableId: string;
      fields: { [fieldIdOrName: string]: unknown };
    };

    const createData: CreateRecordsRo = {
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields }],
    };

    let outPut: IActionResponse<unknown>;

    await this.recordOpenApiService
      .multipleCreateRecords(tableId, createData)
      .then(() => {
        outPut = { msg: 'ok', data: undefined, code: ActionResponseStatus.Success };
      })
      .catch((error) => {
        outPut = { msg: 'error', data: undefined, code: ActionResponseStatus.ServerError };
      })
      .finally(() => {
        almanac.addRuntimeFact(`${this.name}${actionConst.OutPutFlag}`, outPut);
      });
  };
}
