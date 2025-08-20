import { faker } from '@faker-js/faker';
import type { Field } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import type { IRatingFieldOptions, ISelectFieldOptions } from '@teable/core';
import { parseDsn, Colors, FieldType, generateRecordId } from '@teable/core';
import * as dotenv from 'dotenv-flow';
import Knex from 'knex';
import { chunk, flatten, groupBy } from 'lodash';

dotenv.config({ path: '../../../nextjs-app', default_node_env: 'development' });

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion

async function rectifyField(
  prisma: PrismaClient,
  fields: Field[],
  selectOptions: ISelectFieldOptions
) {
  const fieldByType = groupBy(fields, 'type');

  const rectifySelectField = [
    ...(fieldByType?.['singleSelect'] || []),
    ...(fieldByType?.['multipleSelect'] || []),
  ]
    .filter((value) => value)
    .map((value) => value.id);

  if (rectifySelectField) {
    await prisma.field.updateMany({
      where: { id: { in: rectifySelectField } },
      data: {
        options: JSON.stringify(selectOptions),
      },
    });
  }
}

async function generateFieldData(params: {
  mockDataNum: number;
  fields: Field[];
  selectOptions: ISelectFieldOptions;
}) {
  const { fields, selectOptions, mockDataNum } = params;

  return fields.reduce<{ [dbFieldName: string]: unknown }>((pre, cur) => {
    const selectArray = selectOptions.choices.map((value) => value.name);

    let fieldData: unknown = undefined;
    switch (cur.type as FieldType) {
      case FieldType.SingleLineText:
      case FieldType.LongText: {
        fieldData = faker.internet.userName();
        break;
      }
      case FieldType.Number: {
        fieldData = faker.number.float({ min: 1, max: mockDataNum });
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
      case FieldType.Checkbox: {
        fieldData = faker.helpers.arrayElement([1, 'null']);
        break;
      }
      case FieldType.Date: {
        fieldData = faker.date.anytime().toISOString();
        break;
      }
      case FieldType.Rating: {
        const ratingFieldOptions = JSON.parse(cur.options!) as IRatingFieldOptions;
        fieldData = faker.number.int({ min: 0, max: ratingFieldOptions.max });
        break;
      }
    }

    (fieldData || fieldData === 0) && (pre[cur.dbFieldName] = fieldData);
    return pre;
  }, {});
}

export async function seeding(tableId: string, mockDataNum: number) {
  const databaseUrl = process.env.PRISMA_DATABASE_URL!;
  console.log('database-url: ', databaseUrl);
  const { driver } = parseDsn(databaseUrl);
  console.log('driver: ', driver);
  const prisma = new PrismaClient();

  console.log(`Start seeding ...`);

  const selectOptions: ISelectFieldOptions = {
    choices: [
      { id: 'chobird', name: 'bird', color: Colors.GreenDark1 },
      { id: 'chofish', name: 'fish', color: Colors.PurpleLight2 },
      { id: 'cholion', name: 'lion', color: Colors.OrangeLight1 },
      { id: 'choelephant', name: 'elephant', color: Colors.CyanLight2 },
      { id: 'chotiger', name: 'tiger', color: Colors.Yellow },
      { id: 'chorabbit', name: 'rabbit', color: Colors.Red },
      { id: 'chobear', name: 'bear', color: Colors.YellowLight1 },
      { id: 'chohorse', name: 'horse', color: Colors.RedBright },
      { id: 'chosnake', name: 'snake', color: Colors.RedLight2 },
      { id: 'chomonkey', name: 'monkey', color: Colors.Gray },
    ],
  };

  const fields = await prisma.field.findMany({
    where: {
      tableId,
      deletedTime: null,
    },
  });
  await rectifyField(prisma, fields, selectOptions);

  const { dbTableName, name: tableName } = await prisma.tableMeta.findUniqueOrThrow({
    select: { dbTableName: true, name: true },
    where: { id: tableId },
  });
  console.log(`Table: ${tableName}, mockDataNum: ${mockDataNum}`);

  const knex = Knex({
    client: driver,
  });

  console.time(`Table: ${tableName}, Ready Install Data`);
  const data: { [dbFieldName: string]: unknown }[] = [];
  for (let i = 0; i < mockDataNum; i++) {
    const fieldData = await generateFieldData({ mockDataNum, fields, selectOptions });

    data.push({
      __id: generateRecordId(),
      __created_time: new Date().toISOString(),
      __created_by: 'admin',
      __last_modified_by: 'admin',
      __version: 1,
      ...fieldData,
    });
  }
  console.timeEnd(`Table: ${tableName}, Ready Install Data`);

  console.time(`Table: ${tableName}, Install Data Num: ${mockDataNum}`);
  const pages = chunk(data, 50000);

  const promises = pages.map((page) => {
    const sql = `
        INSERT INTO ${knex.ref(dbTableName)}
        ("${Object.keys(page[0]).join('", "')}")
        VALUES
        ${page
          .map((d) => `('${Object.values(d).join(`', '`)}')`)
          .join(', ')
          .replace(/'null'/g, 'null')} 
      `;

    return [prisma.$executeRawUnsafe(sql)];
  });

  await prisma.$transaction(flatten(promises));
  console.timeEnd(`Table: ${tableName}, Install Data Num: ${mockDataNum}`);
  return tableId;
}
