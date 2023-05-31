import { Injectable, Logger, Scope } from '@nestjs/common';
import { FieldKeyType } from '@teable-group/core';
import type { Almanac, Event, RuleResult } from 'json-rules-engine';
import type { CreateRecordsRo } from '../../../../record/create-records.ro';
import { RecordOpenApiService } from '../../../../record/open-api/record-open-api.service';
import type { IActionResponse, IConstSchema, IObjectSchema } from '../../action-core';
import { actionConst, ActionCore, ActionResponseStatus } from '../../action-core';

export interface ICreateRecordSchema extends Record<string, unknown> {
  tableId: IConstSchema;
  fields: IObjectSchema;
}

export interface ICreateRecordOptions {
  tableId: string;
  fields: { [fieldIdOrName: string]: unknown };
}

@Injectable({ scope: Scope.REQUEST })
export class CreateRecord extends ActionCore {
  private logger = new Logger(CreateRecord.name);

  constructor(private readonly recordOpenApiService: RecordOpenApiService) {
    super();
  }

  bindParams(id: string, params: ICreateRecordSchema, priority?: number): this {
    return this.setName(id).setEvent({ type: id, params: params }).setPriority(priority);
  }

  onSuccess = async (event: Event, almanac: Almanac, _ruleResult: RuleResult): Promise<void> => {
    const { tableId, fields } = await this.parseInputSchema<ICreateRecordOptions>(
      event.params as ICreateRecordSchema,
      almanac
    );

    const createData: CreateRecordsRo = {
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields }],
    };

    let outPut: IActionResponse<unknown>;

    await this.recordOpenApiService
      .multipleCreateRecords(tableId, createData)
      .then((records) => {
        const [record] = records;
        outPut = { msg: 'ok', data: record, code: ActionResponseStatus.Success };
      })
      .catch((error) => {
        this.logger.error(error);
        outPut = { msg: 'error', data: undefined, code: ActionResponseStatus.ServerError };
      })
      .finally(() => {
        almanac.addRuntimeFact(`${actionConst.OutPutFlag}${this.name}`, outPut);
      });
  };
}
