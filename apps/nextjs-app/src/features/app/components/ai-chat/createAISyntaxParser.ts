import { Table, View } from '@teable-group/sdk/model';
import { Space } from '@teable-group/sdk/model/space';
import router from 'next/router';
import type { IParsedLine } from './parser/parseLine';
import { AISyntaxParser } from './parser/parseLine';

export function createAISyntaxParser() {
  let tableId: string | undefined;
  let viewId: string | undefined;

  const executeCommand = async (parsedLine: IParsedLine) => {
    switch (parsedLine.operation) {
      case 'create-table': {
        const { name, description, emojiIcon } = parsedLine.value;
        const tableData = await Space.createTable({
          name,
          description,
          icon: emojiIcon,
          fields: [],
          rows: { records: [] },
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
        const { fieldName, recordValue } = parsedLine.value;
        await Table.createRecords({
          tableId,
          records: [{ fields: { [fieldName]: recordValue } }],
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
        const { fieldName, recordValue } = parsedLine.value;
        await Table.updateRecord({ tableId, fieldName, viewId, index, value: recordValue });
        return;
      }
      default: {
        console.error('unknown command:', parsedLine);
      }
    }
  };

  const parser = new AISyntaxParser(executeCommand);

  return (input: string) => {
    parser.processMultilineSyntax(input);
  };
}
