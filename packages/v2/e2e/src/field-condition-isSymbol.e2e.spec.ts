/* eslint-disable @typescript-eslint/naming-convention */
import { describe, beforeAll, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

/**
 * This test specifically tracks isSymbol preservation through the entire lifecycle:
 * 1. Field creation request (HTTP)
 * 2. Field persistence (DB)
 * 3. Field retrieval (HTTP response)
 * 4. Field rehydration (when computing records)
 */
describe('v2 isSymbol preservation (e2e)', () => {
  let ctx: SharedTestContext;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createFieldRaw = async (tableId: string, field: Record<string, unknown>) => {
    const response = await fetch(`${ctx.baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseId: ctx.baseId, tableId, field }),
    });
    const rawBody = await response.json();
    return { status: response.status, body: rawBody };
  };

  const getTableRaw = async (tableId: string) => {
    const response = await fetch(
      `${ctx.baseUrl}/tables/get?baseId=${ctx.baseId}&tableId=${tableId}`,
      {
        method: 'GET',
      }
    );
    const rawBody = await response.json();
    return { status: response.status, body: rawBody };
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('should preserve isSymbol through field creation and retrieval', async () => {
    // Step 1: Create foreign table
    const foreignTitleFieldId = createFieldId();
    const foreignStatusFieldId = createFieldId();

    const foreignTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'ForeignTable',
      fields: [
        { type: 'singleLineText', id: foreignTitleFieldId, name: 'Title' },
        { type: 'singleLineText', id: foreignStatusFieldId, name: 'Status' },
      ],
    });

    // Step 2: Create host table
    const hostStatusFilterFieldId = createFieldId();

    const hostTable = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'HostTable',
      fields: [{ type: 'singleLineText', id: hostStatusFilterFieldId, name: 'StatusFilter' }],
    });

    // Step 3: Create conditional lookup field WITH isSymbol
    const lookupFieldId = createFieldId();
    const createFieldPayload = {
      type: 'conditionalLookup',
      id: lookupFieldId,
      name: 'FilteredTitles',
      options: {
        foreignTableId: foreignTable.id,
        lookupFieldId: foreignTitleFieldId,
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: foreignStatusFieldId,
                operator: 'is',
                value: hostStatusFilterFieldId,
                isSymbol: true, // <-- KEY: This should be preserved
              },
            ],
          },
        },
      },
    };

    console.log('\n=== STEP 3: Creating field ===');
    console.log('Request payload:', JSON.stringify(createFieldPayload, null, 2));

    const createResponse = await createFieldRaw(hostTable.id, createFieldPayload);

    console.log('\n=== STEP 4: Field creation response ===');
    console.log('Status:', createResponse.status);
    console.log('Response body:', JSON.stringify(createResponse.body, null, 2));

    // Verify field was created successfully
    expect(createResponse.status).toBe(200);
    expect(createResponse.body.ok).toBe(true);

    // Step 5: Check if isSymbol is in the immediate response
    const createdField = createResponse.body.data.field;
    const createdCondition = createdField?.conditionalLookupOptions?.condition;
    const createdFilterSet = createdCondition?.filter?.filterSet;

    console.log('\n=== STEP 5: Checking immediate response ===');
    console.log('Created filter condition:', JSON.stringify(createdCondition, null, 2));

    if (createdFilterSet && createdFilterSet[0]) {
      const filterItem = createdFilterSet[0];
      console.log('Filter item:', JSON.stringify(filterItem, null, 2));
      console.log('Has isSymbol:', 'isSymbol' in filterItem);
      console.log('isSymbol value:', filterItem.isSymbol);

      if (!filterItem.isSymbol) {
        console.error('FAILED: isSymbol is missing or false in immediate response!');
      } else {
        console.log('PASSED: isSymbol is present in immediate response');
      }
    }

    // Step 6: Re-fetch the table to see if isSymbol persisted
    console.log('\n=== STEP 6: Re-fetching table from DB ===');
    const getResponse = await getTableRaw(hostTable.id);

    console.log('Status:', getResponse.status);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.ok).toBe(true);

    const refetchedTable = getResponse.body.data.table;
    const refetchedField = refetchedTable.fields.find((f: any) => f.id === lookupFieldId);
    const refetchedCondition = refetchedField?.conditionalLookupOptions?.condition;
    const refetchedFilterSet = refetchedCondition?.filter?.filterSet;

    console.log('Refetched filter condition:', JSON.stringify(refetchedCondition, null, 2));

    if (refetchedFilterSet && refetchedFilterSet[0]) {
      const filterItem = refetchedFilterSet[0];
      console.log('Refetched filter item:', JSON.stringify(filterItem, null, 2));
      console.log('Has isSymbol:', 'isSymbol' in filterItem);
      console.log('isSymbol value:', filterItem.isSymbol);

      if (!filterItem.isSymbol) {
        console.error('FAILED: isSymbol is missing or false after DB round-trip!');
        console.error('This means isSymbol was lost during persistence or rehydration.');
      } else {
        console.log('PASSED: isSymbol survived DB round-trip!');
      }

      // ASSERT: isSymbol must be preserved
      expect(filterItem.isSymbol).toBe(true);
    } else {
      throw new Error('Failed to find filter item in refetched field');
    }
  });

  it('should handle isSymbol in the domain layer (FieldCondition)', async () => {
    // This test verifies the FieldCondition domain object preserves isSymbol
    const { FieldCondition } = await import('@teable/v2-core');

    const dto = {
      filter: {
        conjunction: 'and' as const,
        filterSet: [
          {
            fieldId: 'fld0000000000000001',
            operator: 'is',
            value: 'fld0000000000000002',
            isSymbol: true,
          },
        ],
      },
    };

    console.log('\n=== Testing FieldCondition domain object ===');
    console.log('Input DTO:', JSON.stringify(dto, null, 2));

    const result = FieldCondition.create(dto);
    if (result.isErr()) {
      console.error('FieldCondition.create() failed:', result.error);
    }
    expect(result.isOk()).toBe(true);

    if (result.isOk()) {
      const fieldCondition = result.value;
      const outputDto = fieldCondition.toDto();

      console.log('Output DTO:', JSON.stringify(outputDto, null, 2));

      const outputFilterSet = outputDto.filter?.filterSet;
      if (outputFilterSet && outputFilterSet[0]) {
        const filterItem = outputFilterSet[0];
        console.log('Output filter item:', JSON.stringify(filterItem, null, 2));
        console.log('Has isSymbol:', 'isSymbol' in filterItem);
        console.log('isSymbol value:', filterItem.isSymbol);

        if (filterItem.isSymbol === true) {
          console.log('PASSED: FieldCondition.toDto() preserves isSymbol');
        } else {
          console.error('FAILED: FieldCondition.toDto() does not preserve isSymbol');
        }

        expect(filterItem.isSymbol).toBe(true);
      }
    }
  });
});
