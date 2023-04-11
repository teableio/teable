# 如何模型属性修改

为了实现实时协同以及冲突处理，Teable 中的协同数据模型是基于 Jot 构建的数据结构，同时，包括他们在数据库中的映射。

## 模型

在 Teable 中，数据模型分为以下几种

- Table
- View
- Field
- Record

他们到有自己的独立 Snapshot 和数据库存储结构，同事，在业务逻辑、编辑方法都封装在同名的对应 Class 中。
如果是通用的属性，则在 package/core 中对应的 Class 进行定义，如果是前端 or 后端的属性，则在 app/nestjs-backend 或者 SDK 中进行定义

## 修改 column width

### SDK 增加方法

SDK 是针对 Teable 通用业务方法的封装，用于给 nextjs-app 以及 extends 提供封装好的业务调用方法，适用于前端环境。
我们给 SDK 增加一个 updateColumnWidth 方法，用于修改 column width
找到 packages/sdk/src/model/field/field.ts 中的 FieldExtended 方法
（因为 Field 类最终需要根据不同的 FieldType 实例化不同的类，而 column width 是每一个 Field 都有的，所以我们需要在 FieldExtended 上面去增加通用方法

```typescript
updateColumnSize(
  doc: Doc<IFieldSnapshot>,
  viewId: string,
  oldSize: number,
  newSize: number
) {
  // 因为 width 实在 column meta 属性上保存，并且每个视图都有一份，所以我们需要指定 viewId 以及 具体的 metaKey
  const fieldOperation = OpBuilder.editor.setColumnMeta.build({
    viewId, // 因为
    metaKey: 'width',
    oldMetaValue: oldSize,
    newMetaValue: newSize,
  });

  // 通过 doc.submitOp 提交操作，这个方法是 ShareDB 提供的，用于提交操作
  return new Promise<void>((resolve, reject) => {
    doc.submitOp([fieldOperation], undefined, (error) => {
      error ? reject(error) : resolve(undefined);
    });
  });
}
```

接下来我们修改 `abstract class Field` 以确保我们会在每种 field class 上面都增加这个方法
与上面不同的是，这里的 `updateColumnSize` 只需要两个参数，因为 doc 和 oldSize 是会在具体 field class 的成员方法上，所以我们不需要在这里传入

```typescript
export abstract class Field extends FieldCore {
  ...
  abstract updateColumnSize(viewId: string, size: number): Promise<void>;
  ...
}
```

然后我们再去到具体的 field class 实现这个方法，这里以 number.field.ts 为例

```typescript


export class NumberField extends NumberFieldCore implements Field {
  doc!: Doc<IFieldSnapshot>;
  ...
  async updateColumnWidth(viewId: string, width: number): Promise<void> {
    const oldWidth = this.columnMeta[viewId].width;
    return FieldExtended.updateColumnWidth(this.doc, viewId, width, oldWidth);
  }
  ...
}
```

因为我们在 abstract Field 定义了这个方法，所以我们可以安全的保证每个不同类型的 Field 都会实现这个方法。copy paste 之后，我们就可以在业务代码中实现对其的调用

可以看到，Grid 组件 DataEditor 中，使用 onColumnResize 来处理 resize 事件，我们定义一个 useColumnResize 的 hook，用于处理 resize 事件, 它将会返回一个 onColumnResize 方法，同时，接受参数 columns 和 setColumns，用于更新 columns 的 width

```typescript
import type { GridColumn } from "@glideapps/glide-data-grid";
import { useFields, useViewId } from "@teable-group/sdk/hooks";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useState } from "react";
import { useDebounce } from "react-use";

// 定义参数，将 columns 和 setColumns 方法传入，以便可以进行更新
export function useColumnResize<T extends { id: string }>(
  columns: T[],
  setColumns: Dispatch<SetStateAction<T[]>>
) {
  const { fields } = useFields();
  const viewId = useViewId();
  const [newSize, setNewSize] = useState<number>();
  const [index, setIndex] = useState<number>();

  // 为了避免频繁的更新，我们使用 useDebounce 来包裹我们的更新方法
  useDebounce(
    () => {
      if (!viewId) {
        throw new Error("Can't find view id");
      }
      if (index == null || newSize == null) {
        return;
      }
      // 这里找到对应拖动的 field，我们就可以调用 updateColumnWidth 实现数据的协作和持久化啦
      fields[index].updateColumnWidth(viewId, newSize);
    },
    200,
    [index, fields, newSize]
  );

  return useCallback(
    (column: GridColumn, newSize: number, colIndex: number, _newSizeWithGrow: number) => {
      const fieldId = column.id;
      const field = fields[colIndex];
      if (!field) {
        throw new Error("Can not find field by id: " + fieldId);
      }

      if (field.id !== column.id) {
        throw new Error("field id not match column id");
      }

      if (!viewId) {
        throw new Error("Can not find view id");
      }

      // 找到对应的 column 并更新它
      const index = columns.findIndex((ci) => ci.id === column.id);
      const newColumns = [...columns];
      const newColumn = {
        ...columns[index],
        width: newSize,
      };
      newColumns.splice(index, 1, newColumn);

      setColumns(newColumns);
      setNewSize(newSize);
      setIndex(colIndex);
    },
    [columns, fields, setColumns, viewId]
  );
}
```

## opBuilder 和 dbAdapter

因为 opBuilder 和 dbAdapter 中已经提前实现了 columnMeta 的数据修改和存储逻辑，所以这个章节我们并不算从头实现了一个支持协作的数据编辑能力。下一章节我们会具体介绍 opBuilder 和 dbAdapter
