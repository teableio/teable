import type { PipeTransform } from '@nestjs/common';
import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import {
  FieldKeyType,
  replaceFilter,
  replaceGroupBy,
  replaceOrderBy,
  replaceSearch,
} from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { Request } from 'express';
import { keyBy } from 'lodash';
import { DataLoaderService } from '../../data-loader/data-loader.service';

@Injectable({ scope: Scope.REQUEST })
export class FieldKeyPipe<T extends IGetRecordsRo> implements PipeTransform {
  constructor(
    @Inject(REQUEST) private readonly request: Request,
    private readonly dataLoaderService: DataLoaderService
  ) {}

  async transform(value: T) {
    const tableId = (this.request as Request).params.tableId;
    if (!tableId) {
      return value;
    }

    return this.transformFieldKeyTql(value, tableId);
  }

  private async transformFieldKeyTql(value: T, tableId: string): Promise<T> {
    const fieldKeyType = value.fieldKeyType ?? FieldKeyType.Name;
    if (fieldKeyType === FieldKeyType.Id) {
      return value;
    }

    if (!value.filter && !value.search && !value.groupBy && !value.orderBy) {
      return value;
    }

    const fields = await this.dataLoaderService.field.load(tableId);
    const fieldMap = keyBy(fields, fieldKeyType);

    const transformedValue = { ...value };

    if (value.filter) {
      transformedValue.filter = replaceFilter(value.filter, fieldMap, FieldKeyType.Id);
    }

    if (value.search) {
      transformedValue.search = replaceSearch(value.search, fieldMap, FieldKeyType.Id);
    }

    if (value.groupBy) {
      transformedValue.groupBy = replaceGroupBy(value.groupBy, fieldMap, FieldKeyType.Id);
    }

    if (value.orderBy) {
      transformedValue.orderBy = replaceOrderBy(value.orderBy, fieldMap, FieldKeyType.Id);
    }

    return transformedValue;
  }
}
