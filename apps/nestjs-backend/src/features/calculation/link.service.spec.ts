/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { FieldType, Relationship } from '@teable-group/core';
import type { ILinkCellContext, IRecordMapByTableId, ITinyFieldMapByTableId } from './link.service';
import { LinkService } from './link.service';
import { ReferenceService } from './reference.service';

describe('LinkService', () => {
  let service: LinkService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LinkService, ReferenceService],
    }).compile();

    service = module.get<LinkService>(LinkService);
  });

  describe('getCellMutation', () => {
    let fieldMapByTableId: ITinyFieldMapByTableId = {};
    beforeEach(() => {
      fieldMapByTableId = {
        tableA: {
          'ManyOne-LinkB': {
            id: 'ManyOne-LinkB',
            tableId: 'tableA',
            type: FieldType.Link,
            dbFieldName: 'ManyOne-LinkB',
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: 'tableB',
              lookupFieldId: 'fieldB',
              dbForeignKeyName: '__fk_ManyOne-LinkB',
              symmetricFieldId: 'OneMany-LinkA',
            },
          },
        },
        tableB: {
          'OneMany-LinkA': {
            id: 'OneMany-LinkA',
            tableId: 'tableB',
            type: FieldType.Link,
            dbFieldName: 'OneMany-LinkA',
            options: {
              relationship: Relationship.OneMany,
              foreignTableId: 'tableA',
              lookupFieldId: 'fieldA',
              dbForeignKeyName: '__fk_ManyOne-LinkB',
              symmetricFieldId: 'ManyOne-LinkB',
            },
          },
        },
      };
    });
  });
});
