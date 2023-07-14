import { Field, PrismaClient, View } from '@prisma/client';
import { FieldType, generateRecordId } from "@teable-group/core";
import { faker } from '@faker-js/faker';
import { chunk, flatten, groupBy } from 'lodash';

const prisma = new PrismaClient();

async function rectifyField(fields: Field[], selectOptions: any) {
  const fieldByType = groupBy(fields, 'type');

  const rectifySelectField = [...fieldByType['singleSelect'], ...fieldByType['multipleSelect']]
    .filter(value => value)
    .map(value => value.id);

  if (rectifySelectField) {
    await prisma.field.updateMany({
      where: { id: { in: rectifySelectField } },
      data: {
        options: JSON.stringify(selectOptions)
      }
    })
  }
}

async function generateFieldData(params: { mockDataNum: number, fields: Field[], selectOptions: any }) {
  const { fields, selectOptions, mockDataNum } = params;

  return fields.reduce((pre: any, cur: any) => {
    const selectArray = selectOptions.choices.map(value => value.name);

    let fieldData;
    switch (cur.type as FieldType) {
      case FieldType.SingleLineText:
      case FieldType.LongText: {
        fieldData = faker.internet.userName();
        break;
      }
      case FieldType.Number: {
        fieldData = faker.number.int({ min: 1, max: mockDataNum });
        break;
      }
      case FieldType.SingleSelect: {
        fieldData = faker.helpers.arrayElement(selectArray);
        break;
      }
      case FieldType.MultipleSelect: {
        fieldData = JSON.stringify(faker.helpers.arrayElements(selectArray, { min: 2, max: 9 }));
        break;
      }
    }

    fieldData && (pre[cur.dbFieldName] = fieldData);
    return pre;
  }, {});
}

async function generateViewRowIndex(params: { views: View[], rowCount: number, i: number }) {
  const { views, rowCount, i } = params;

  return views.reduce((pre: any, cur: any) => {
    pre[`__row_${cur.id}`] = Number(rowCount) + i;
    return pre;
  }, {});
}

async function main() {
  const mockDataNum = 500000;
  const tableId = 'tblSkjxbqV1fGd0dui5';

  console.log(`Start seeding ...`);

  const selectOptions = {
    "choices": [
      { "name": "bird", "color": "greenDark1" },
      { "name": "fish", "color": "purpleLight2" },
      { "name": "lion", "color": "orangeLight1" },
      { "name": "elephant", "color": "cyanLight2" },
      { "name": "tiger", "color": "yellow" },
      { "name": "rabbit", "color": "red" },
      { "name": "bear", "color": "yellowLight1" },
      { "name": "horse", "color": "redBright" },
      { "name": "snake", "color": "redLight2" },
      { "name": "monkey", "color": "gray" }]
  }

  const fields = await prisma.field.findMany({
    where: {
      tableId
    }
  });

  await rectifyField(fields, selectOptions);

  const { dbTableName, name: tableName } = await prisma.tableMeta.findUniqueOrThrow({
    select: { dbTableName: true, name: true },
    where: { id: tableId }
  });
  console.log(`Table: ${tableName}, mockDataNum: ${mockDataNum}`)

  const views = await prisma.view.findMany({ where: { tableId } });
  const [{ count: rowCount }] = await prisma.$queryRawUnsafe<{ count: number }[]>(`select count(*) as count from ${dbTableName}`);

  console.time(`Table: ${tableName}, Ready Install Data`)
  const data = [];
  for (let i = 1; i <= mockDataNum; i++) {
    const fieldData = await generateFieldData({ mockDataNum, fields, selectOptions });
    const viewRowIndex = await generateViewRowIndex({ views, rowCount, i });

    data.push(
      {
        __id: generateRecordId(),
        __row_default: Number(rowCount) + i,
        __created_time: new Date().toISOString(),
        __created_by: 'admin',
        __last_modified_by: 'admin',
        __version: 1,
        ...viewRowIndex,
        ...fieldData
      }
    )
  }
  console.timeEnd(`Table: ${tableName}, Ready Install Data`)

  console.time(`Table: ${tableName}, Install Data Num: ${mockDataNum}`);
  const pages = chunk(data, 50000);
  const promises = pages.map((page, index) => {
    const sql = `
        REPLACE INTO ${dbTableName}
        (${Object.keys(page[0]).join(',')})
        VALUES
        ${page.map(d => `('${Object.values(d).join(`', '`)}')`).join(', ')}
      `;

    const sql_op = `
        REPLACE INTO ops
        ("collection", "doc_id", "version", "operation")
        VALUES
        ${page.map(d => {
          return { collection:tableId, doc_id:d.__id, version:1, operation:'{}' }
        })
        .map(d => `('${Object.values(d).join(`', '`)}')`).join(', ')}
      `;

    return [prisma.$executeRawUnsafe(sql), prisma.$executeRawUnsafe(sql_op)];
  });

  const result = await prisma.$transaction(flatten(promises));
  console.log(result);
  console.time(`Table: ${tableName}, Install Data Num: ${mockDataNum}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
