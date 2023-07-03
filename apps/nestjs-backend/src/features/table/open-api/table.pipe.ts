import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { FieldType } from '@teable-group/core';
import { FieldSupplementService } from '../../field/field-supplement.service';
import type { CreateFieldRo } from '../../field/model/create-field.ro';
import { DEFAULT_FIELDS, DEFAULT_RECORD_DATA, DEFAULT_VIEW } from '../constant';
import type { CreateTableRo } from '../create-table.ro';

@Injectable()
export class TablePipe implements PipeTransform {
  constructor(private readonly fieldSupplementService: FieldSupplementService) {}
  async transform(value: CreateTableRo, _metadata: ArgumentMetadata) {
    return this.prepareDefaultRo(value);
  }

  async prepareDefaultRo(tableRo: CreateTableRo): Promise<CreateTableRo> {
    const fieldRos = tableRo.fields ? tableRo.fields : DEFAULT_FIELDS;
    // make sure first field to be the primary field;
    fieldRos[0].isPrimary = true;
    const fields: CreateFieldRo[] = [];
    const simpleFields: CreateFieldRo[] = [];
    const computeFields: CreateFieldRo[] = [];
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
      views: tableRo.views && tableRo.views.length ? tableRo.views : [DEFAULT_VIEW],
      data: tableRo.data ? tableRo.data : DEFAULT_RECORD_DATA,
    };
  }
}
