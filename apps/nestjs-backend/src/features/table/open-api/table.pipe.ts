import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { ICreateTableRo, IFieldRo } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { FieldSupplementService } from '../../field/field-supplement.service';
import { DEFAULT_FIELDS, DEFAULT_RECORD_DATA, DEFAULT_VIEWS } from '../constant';

@Injectable()
export class TablePipe implements PipeTransform {
  constructor(private readonly fieldSupplementService: FieldSupplementService) {}
  async transform(value: ICreateTableRo, _metadata: ArgumentMetadata) {
    return this.prepareDefaultRo(value);
  }

  async prepareDefaultRo(tableRo: ICreateTableRo): Promise<ICreateTableRo> {
    const fieldRos = tableRo.fields ? tableRo.fields : DEFAULT_FIELDS;
    // make sure first field to be the primary field;
    fieldRos[0].isPrimary = true;
    const fields: IFieldRo[] = [];
    const simpleFields: IFieldRo[] = [];
    const computeFields: IFieldRo[] = [];
    fieldRos.forEach((field) => {
      if (field.type === FieldType.Link || field.type === FieldType.Formula || field.isLookup) {
        computeFields.push(field);
      } else {
        simpleFields.push(field);
      }
    });

    for (const fieldRo of simpleFields) {
      fields.push(await this.fieldSupplementService.prepareField(fieldRo));
    }

    const allFieldRos = simpleFields.concat(computeFields);
    for (const fieldRo of computeFields) {
      fields.push(
        await this.fieldSupplementService.prepareField(
          fieldRo,
          allFieldRos.filter((ro) => ro !== fieldRo)
        )
      );
    }

    return {
      ...tableRo,
      fields,
      views: tableRo.views && tableRo.views.length ? tableRo.views : DEFAULT_VIEWS,
      records: tableRo.records ? tableRo.records : DEFAULT_RECORD_DATA,
    };
  }
}
