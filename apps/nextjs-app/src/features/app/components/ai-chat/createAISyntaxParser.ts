import { FieldKeyType } from '@teable/core';
import { Field, Record, Table, View } from '@teable/sdk/model';
import router from 'next/router';
import { createChart } from '../Chart/createChart';
import { ChartType } from '../Chart/type';
import type { IParsedLine } from './parser/parseLine';
import { AISyntaxParser } from './parser/parseLine';

export function createAISyntaxParser() {
  let baseId: string | undefined;
  let tableId: string | undefined;
  let viewId: string | undefined;

  const executeCommand = async (parsedLine: IParsedLine) => {
    if (!baseId) {
      baseId = router.query.baseId as string;
    }
    if (!tableId) {
      tableId = router.query.tableId as string;
    }
    if (!viewId) {
      viewId = router.query.viewId as string;
    }
    console.log('execute: ', parsedLine);
    switch (parsedLine.operation) {
      case 'create-table': {
        const { name, description, icon } = parsedLine.value;
        const tableData = (
          await Table.createTable(baseId, {
            name,
            description,
            icon: icon,
            fields: [],
          })
        ).data;
        tableId = tableData.id;
        const views = (await View.getViews(tableId)).data;
        viewId = views[0].id;
        router.push({
          pathname: '/base/[baseId]/[tableId]/[viewId]',
          query: { baseId, tableId, viewId },
        });
        return;
      }
      case 'create-field': {
        if (!tableId) {
          throw new Error("Can't create field without tableId");
        }
        const { name, type, options } = parsedLine.value;
        await Field.createField(tableId, { name, type, options });
        return;
      }
      case 'create-record': {
        if (!tableId) {
          throw new Error("Can't create record without table");
        }
        await Record.createRecords(tableId, { records: [{ fields: {} }] });
        return;
      }
      case 'set-record': {
        if (!tableId) {
          throw new Error("Can't create record without tableId");
        }
        if (!viewId) {
          throw new Error("Can't find viewId");
        }
        return;
      }
      case 'generate-chart': {
        const chartTypeArray = Object.values(ChartType);
        const { tableId, viewId } = router.query;
        const result = (
          await Record.getRecords(tableId as string, {
            viewId: viewId as string,
            fieldKeyType: FieldKeyType.Name,
          })
        ).data;
        const chartInstance = createChart(chartTypeArray[parsedLine.index], {
          options: parsedLine.value,
          data: result.records.map((v) => v.fields),
        });
        console.log(
          'records',
          result.records.map((v) => v.fields),
          parsedLine.value
        );
        return chartInstance;
      }
      default: {
        console.error('unknown command:', parsedLine);
      }
    }
  };

  const parser = new AISyntaxParser(executeCommand);

  return async (input: string, callBack: (parsedResult: unknown) => void) => {
    await parser.processMultilineSyntax(input, callBack);
  };
}
