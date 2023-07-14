# op 驱动的实时协同数据编辑能力

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
  const fields = useFields();
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
    [index, newSize]
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

## opBuilder

我们在前面使用 `OpBuilder.editor.setColumnMeta.build` 来创建了一个 op。对于每个不同的 op，我们都需要通过创建一个独立的 opBuilder 来对其进行封装

```ts
export interface IOpBuilder {
  name: OpName;
  // Create an atomic operation
  build(...params: unknown[]): IOtOperation;
  // Detect an operation if it is belongs to a specific purpose
  detect(op: IOtOperation): IOpContextBase | null;
}
```

opBuilder 除了独立的 name 之外，要实现一对 build & detect 方法，和 decoder & encode 概念类似，build 通过参数生成 op, detect 通过 op 来解析出原始参数，用作后续的入库动作。
当我们实现一个 op 之后，需要在 `op-builder.ts` 文件中对其进行注册和导出。

```ts
import { SetColumnMetaBuilder } from './field/set-column-meta';
export type { ISetColumnMetaOpContext } from './field/set-column-meta';
export class OpBuilder {
  static editor = {
      ...
      setColumnMeta: new SetColumnMetaBuilder(),
      ...
  }
  ...
}
```

## DbAdapter

现在我们已经知道了 op 的生成、op 发送的过程，那么变更是如何入库的呢？
当 op 通过 `doc.submitOp` 协同到服务端之后，shareDb 会调用 `dbAdapter` 的 `commit` 方法，我们可以在这里对 op 进行解析，然后进行入库操作。

如果是编辑类的操作，opAdapter 会先调用 `const ops2Contexts = OpBuilder.ops2Contexts(ops);` 的到 opContexts，从 context 之中，我们就有了完整的入库信息上下文，接下来就是调用对应的 service 来进行入库操作了。

```ts
// share-db/sqlite.adapter.ts:144
async updateSnapshot(
  prisma: Prisma.TransactionClient,
  version: number,
  collection: string,
  docId: string,
  ops: IOtOperation[]
) {
  // 通过 collection 字符串，获取对应的 docType 和 collectionId
  const [docType, collectionId] = collection.split('_');
  const ops2Contexts = OpBuilder.ops2Contexts(ops);
  const service = this.getService(docType as IdPrefix);
  // group by op name execute faster
  const ops2ContextsGrouped = groupBy(ops2Contexts, 'name');
  for (const opName in ops2ContextsGrouped) {
    const opContexts = ops2ContextsGrouped[opName];
    // 调用对应的 Service
    await service.update(prisma, version, collectionId, docId, opContexts);
  }
}
```

可能这里你会产生一些疑问，collection 参数在这里被 split 之后，为什么可以得到 docType 和 collectionId。
这是因为，ShareDb 在设计 collection 的时候，目标是支持完全通用的数据结构，但我们将其分类为了不同的 docType， 也就是 table、view、field、record。 所以我们通过扩展 id 的形式，帮助我们实现了对不同的数据结构的区分。
这个不分，在后面的数据获取、订阅章节也会再次提到。

假设以后还会有新的业务数据需要协同，那么我们就会去扩展一个新的 docType 和对应的 Service

每一个具体的 Service 都要去实现以下的接口，实现完毕之后，就可以支持数据的完整增删改查。

```ts
export abstract class AdapterService {
  abstract create(
    prisma: Prisma.TransactionClient,
    collectionId: string,
    snapshot: unknown
  ): Promise<void>;

  abstract del(
    prisma: Prisma.TransactionClient,
    collectionId: string,
    docId: string
  ): Promise<void>;

  abstract update(
    prisma: Prisma.TransactionClient,
    version: number,
    collectionId: string,
    docId: string,
    opContexts: unknown[]
  ): Promise<void>;

  abstract getSnapshotBulk(
    prisma: Prisma.TransactionClient,
    collectionId: string,
    ids: string[],
    projection?: { [fieldNameOrId: string]: boolean },
    extra?: unknown
  ): Promise<ISnapshotBase<unknown>[]>;

  abstract getDocIdsByQuery(
    prisma: Prisma.TransactionClient,
    collectionId: string,
    query: unknown
  ): Promise<{ ids: string[]; extra?: unknown }>;
}
```

## 总结

回顾一下我们接触了哪些概念

### 协同数据模型

这是为了方便进行数据修改和计算的封装层。在这里我们可以定义数据的结构和计算逻辑。
模型分类：

- Table
- View
- Field
- Record

实现位置：

- core
  - sdk
  - nestjs-backend

* 在 core 中，我们会进行数据类型的定义，以及通用纯计算方法的实现
* 在 SDK 中，我们会封装方法方便进行数据的变更，方便 app 蹭调用。
* 在 nestjs-backend 中，我们会实现一些服务端特有数据的补全和计算。

### opBuilder

用来解析和生成 op 的工具类。每一个新的数据修改方式，都需要实现一个新的 opBuilder。

### dbAdapter

用来将 op 解析成为入库的数据（增删改）和实现查询能力。每一个新的 Collection（要支持协作的表），都需要实现一个新的 dbAdapter。
