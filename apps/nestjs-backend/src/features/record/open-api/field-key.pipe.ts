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
import { PrismaService } from '@teable/db-main-prisma';
import type { IGetRecordsRo } from '@teable/openapi';
import { Request } from 'express';
import { keyBy } from 'lodash';

@Injectable({ scope: Scope.REQUEST })
export class FieldKeyPipe<T extends IGetRecordsRo> implements PipeTransform {
  constructor(
    private readonly prismaService: PrismaService,
    @Inject(REQUEST) private readonly request: Request
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

    const fields = await this.prismaService.field.findMany({
      where: { tableId, deletedTime: null },
      select: { id: true, name: true, dbFieldName: true },
    });
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
