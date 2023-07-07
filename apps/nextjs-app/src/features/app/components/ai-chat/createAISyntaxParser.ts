/* eslint-disable @typescript-eslint/naming-convention */
import { FieldKeyType } from '@teable-group/core';
import { Table, View } from '@teable-group/sdk/model';
import { Space } from '@teable-group/sdk/model/space';
import router from 'next/router';
import { createChart } from '../Chart/createChart';
import { ChartType } from '../Chart/type';
import type { IParsedLine } from './parser/parseLine';
import { AISyntaxParser } from './parser/parseLine';

export function createAISyntaxParser() {
  let tableId: string | undefined;
  let viewId: string | undefined;

  const executeCommand = async (parsedLine: IParsedLine) => {
    if (!tableId) {
      tableId = router.query.nodeId as string;
    }
    if (!viewId) {
      viewId = router.query.viewId as string;
    }
    console.log('execute: ', parsedLine);
    switch (parsedLine.operation) {
      case 'create-table': {
        const { name, description, icon } = parsedLine.value;
        const tableData = await Space.createTable({
          name,
          description,
          icon: icon,
          fields: [],
        });
        tableId = tableData.id;
        const views = await View.getViews(tableId);
        viewId = views[0].id;
        router.push({
          pathname: '/space/[tableId]/[viewId]',
          query: { tableId, viewId },
        });
        return;
      }
      case 'create-field': {
        if (!tableId) {
          throw new Error("Can't create field without tableId");
        }
        const { name, type, options } = parsedLine.value;
        await Table.createField({ tableId, name, type, options });
        return;
      }
      case 'create-record': {
        if (!tableId) {
          throw new Error("Can't create record without table");
        }
        await Table.createRecords({
          tableId,
          records: [{ fields: {} }],
        });
        return;
      }
      case 'set-record': {
        if (!tableId) {
          throw new Error("Can't create record without tableId");
        }
        if (!viewId) {
          throw new Error("Can't find viewId");
        }
        const index = parsedLine.index;
        const cell = parsedLine.value;
        try {
          await Table.updateRecordByIndex({
            tableId,
            viewId,
            index,
            record: { fields: { [cell.name]: cell.value } },
          });
        } catch (e) {
          console.error(e);
          console.log(parsedLine);
        }
        return;
      }
      case 'generate-chart': {
        const chartTypeArray = Object.values(ChartType);
        const { nodeId, viewId } = router.query;
        const result = await Table.getRecords({
          tableId: nodeId as string,
          viewId: viewId as string,
          fieldKeyType: FieldKeyType.Name,
        });
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
