/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */

import type { INestApplication } from '@nestjs/common';
import type { LinkFieldCore } from '@teable/core';
import { FieldType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  convertField,
  createField,
  createTable,
  deleteTable,
  getRecord,
  initApp,
  updateRecordByApi,
} from './utils/init-app';

describe('Nested rollup regression (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  let customerTable: ITableFullVo | undefined;
  let opportunityTable: ITableFullVo | undefined;
  let contractTable: ITableFullVo | undefined;

  const toFieldMap = (table: ITableFullVo) =>
    table.fields.reduce<Record<string, string>>((acc, field) => {
      acc[field.name] = field.id;
      return acc;
    }, {});

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    if (contractTable) {
      await deleteTable(baseId, contractTable.id);
      contractTable = undefined;
    }
    if (opportunityTable) {
      await deleteTable(baseId, opportunityTable.id);
      opportunityTable = undefined;
    }
    if (customerTable) {
      await deleteTable(baseId, customerTable.id);
      customerTable = undefined;
    }
  });

  it(
    'updates customer aliases even when contracts roll up opportunity rollups',
    { timeout: 60000 },
    async () => {
      customerTable = await createTable(baseId, {
        name: 'customers_rollup_regression',
        fields: [
          { name: 'Customer Alias', type: FieldType.SingleLineText },
          { name: 'Customer Legal Name', type: FieldType.SingleLineText },
        ],
        records: [
          {
            fields: {
              'Customer Alias': 'Acme',
              'Customer Legal Name': 'Acme Holdings Ltd.',
            },
          },
        ],
      });

      opportunityTable = await createTable(baseId, {
        name: 'opportunities_rollup_regression',
        fields: [{ name: 'Opportunity Title', type: FieldType.SingleLineText }],
        records: [
          {
            fields: {
              'Opportunity Title': 'Placeholder Title',
            },
          },
        ],
      });

      contractTable = await createTable(baseId, {
        name: 'contracts_rollup_regression',
        fields: [{ name: 'Contract Name', type: FieldType.SingleLineText }],
        records: [
          {
            fields: {
              'Contract Name': 'Primary Contract',
            },
          },
        ],
      });

      const customerFields = toFieldMap(customerTable);
      const opportunityFields = toFieldMap(opportunityTable);
      const contractFields = toFieldMap(contractTable);

      const opportunityCustomerLink = (await createField(opportunityTable.id, {
        name: 'Customer Link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: customerTable.id,
        },
      })) as LinkFieldCore;
      opportunityFields[opportunityCustomerLink.name] = opportunityCustomerLink.id;

      await updateRecordByApi(
        opportunityTable.id,
        opportunityTable.records[0].id,
        opportunityCustomerLink.id,
        { id: customerTable.records[0].id }
      );

      const opportunityTitleField = await convertField(
        opportunityTable.id,
        opportunityFields['Opportunity Title'],
        {
          name: 'Opportunity Title',
          type: FieldType.Formula,
          options: {
            expression: `ARRAYJOIN({${opportunityCustomerLink.id}}, ', ')`,
          },
        }
      );
      opportunityFields[opportunityTitleField.name] = opportunityTitleField.id;

      const subjectRollup = await createField(opportunityTable.id, {
        name: 'Subject Name',
        type: FieldType.Rollup,
        options: {
          expression: 'array_join({values})',
        },
        lookupOptions: {
          foreignTableId: customerTable.id,
          linkFieldId: opportunityCustomerLink.id,
          lookupFieldId: customerFields['Customer Legal Name'],
        },
      });
      opportunityFields[subjectRollup.name] = subjectRollup.id;

      const contractOpportunityLink = (await createField(contractTable.id, {
        name: 'Opportunity Link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: opportunityTable.id,
        },
      })) as LinkFieldCore;
      contractFields[contractOpportunityLink.name] = contractOpportunityLink.id;

      await updateRecordByApi(
        contractTable.id,
        contractTable.records[0].id,
        contractOpportunityLink.id,
        { id: opportunityTable.records[0].id }
      );

      const signingSubjectField = await createField(contractTable.id, {
        name: 'Signing Subject',
        type: FieldType.Rollup,
        options: {
          expression: 'array_join({values})',
        },
        lookupOptions: {
          foreignTableId: opportunityTable.id,
          linkFieldId: contractOpportunityLink.id,
          lookupFieldId: subjectRollup.id,
        },
      });
      contractFields[signingSubjectField.name] = signingSubjectField.id;

      await expect(
        updateRecordByApi(
          customerTable.id,
          customerTable.records[0].id,
          customerFields['Customer Alias'],
          'Acme Updated'
        )
      ).resolves.toBeDefined();

      const updatedCustomer = await getRecord(customerTable.id, customerTable.records[0].id);
      const updatedOpportunity = await getRecord(
        opportunityTable.id,
        opportunityTable.records[0].id
      );
      const updatedContract = await getRecord(contractTable.id, contractTable.records[0].id);

      expect(updatedCustomer.fields[customerFields['Customer Alias']]).toBe('Acme Updated');
      expect(updatedOpportunity.fields[opportunityTitleField.id]).toBe('Acme Updated');
      expect(updatedOpportunity.fields[subjectRollup.id]).toBe('Acme Holdings Ltd.');
      expect(updatedContract.fields[contractFields['Signing Subject']]).toBe('Acme Holdings Ltd.');
    }
  );
});
