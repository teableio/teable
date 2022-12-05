export interface IColumn {
  width: number;
  id: string;
  title: string;
}

export function useColumns(tableId: string, viewId: string): IColumn[] {
  console.log(`request from ${tableId}, ${viewId}`);
  return [
    {
      width: 100,
      id: 'field1',
      title: 'field1',
    },
    {
      width: 200,
      id: 'field2',
      title: 'field2',
    },
    {
      width: 140,
      id: 'field3',
      title: 'field3',
    },
    {
      width: 150,
      id: 'field4',
      title: 'field4',
    },
    {
      width: 160,
      id: 'field5',
      title: 'field5',
    },
  ];
}
