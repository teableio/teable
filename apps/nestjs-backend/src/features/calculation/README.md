我有这样的一个数据结构定义，id 为 fieldId, dependency 是当前 field 所依赖的 field 的 id。
IFieldMap 包括了所有 field 对应的信息的 map

```ts
interface ITopologicalItem {
  id: string;
  dependencies: string[];
}

interface IField {
  type: "other" | "link";
}

type IFieldMap = { [id: string]: IField };
```

一个 record 中的某个 field 变化了之后，就会触发相关的依赖计算。也就是说，我们提供一个 recordId 然后按照拓扑排序中的顺序，依次计算每个 field 的值。

link 字段在这里会导致 一个 record 变化，引发其他多个 record 变化的情况，比如

recordA1 和 recordA2 的 fieldY 都引用 recordB1 的 fieldX 的值，其中 fieldY 为 type 为 link 的字段

```ts
recordA1[fieldBLinkB] = recordB1[fieldB];
recordA2[fieldBLinkB] = recordB1[fieldB];
```

那么，当 recordB1 的 fieldX 变化的时候，就会触发 recordA1 和 recordA2 的 fieldY 的变化。
也就是说，当传入 recordB1 的 id 进入拓扑排序遍历的时候，经过 fieldY 字段时，需要裂变成 recordA1、recordA2 两个 id，然后继续遍历计算

请问，我如何一次性查询出，从 recordB1 出发，最终会发生变化的 record, 以及他们与各自 field 之间的关系
简单场景
b1[fieldB] 变化
fieldB -> fieldLinkB

```ts
[
  { id: "fieldB", dependencies: [], recordId: ["b1"] },
  { id: "fieldLinkB", dependencies: ["fieldB"], recordId: ["b1"], targetRecordId: ["a1", "a2"] }, // formula({fieldB})
];
```

link 字段的计算，是带入关联表中的 recordId 以及对应的 recordData 计算的，而计算后的值，将存入当前表的 targetRecordId 中对应的 link 字段下。

```ts
[
  { id: "fieldB", dependencies: [], recordId: ["b1"] },
  { id: "fieldLinkB", dependencies: ["fieldB"], recordId: ["b1"], targetRecordId: ["a1", "a2"] },
  { id: "fieldA", dependencies: ["fieldLinkB"], recordId: ["a1", "a2"] },
  { id: "fieldLinkA", dependencies: ["fieldA"], recordId: ["a1", "a2"], targetRecordId: ["b1"] },
];
```

fieldA -> FieldLinkA -> formula。
拓扑排序只包含从变更入口开始的有向图

```ts
[
  { id: "fieldA", dependencies: [], recordId: ["a1"] },
  // { id: "fieldC", dependencies: [] },
  { id: "FieldLinkA", dependencies: ["fieldA"], recordId: ["a1", "a2"], targetRecordId: ["b1"] },
  // { id: "FieldLinkC", dependencies: ['fieldC'], recordId: ['c1', 'c2'], targetRecordId: ['b1'] },
  { id: "formula", dependencies: ["FieldLinkA", "FieldLinkC"] },
];
```

## 单次找出所有 recordId

我有以下数据结构, 这是一组拓扑排序后的数据结果。代表着 fieldA -> fieldLinkA -> fieldLinkB 这样的一张有向无环图关系。
tableName 代表表名称
fieldName 代表字段名称
targetLinkField 代表外键的字段名称，该字段存储了关联的 record
linkedTable 代表了这个 targetLinkField 关联的表名称
dependencies 代表关联后，他们需要查询 record 中哪个 field 的值

```ts
const topologicalOrder = [
  { tableName: "A", fieldName: "fieldA", dependencies: [] },
  {
    tableName: "B",
    fieldName: "fieldLinkA",
    targetLinkField: "__fk_fieldLinkA",
    linkedTable: "A",
    dependencies: ["fieldA"],
  },
  {
    tableName: "C",
    fieldName: "fieldLinkB",
    targetLinkField: "__fk_fieldLinkB",
    linkedTable: "B",
    dependencies: ["fieldLinkA"],
  },
];
```

table 中的 record 数据用 json 表达如下
A 表

```ts
[
  { id: "idA1", fieldA: "A1" },
  { id: "idA2", fieldA: "A2" },
];
```

B 表

```ts
[
  { id: "idB1", fieldB: "B1", fieldLinkA: "A1", __fk_fieldLinkA: "idA1" },
  { id: "idB2", fieldB: "B2", fieldLinkA: "A1", __fk_fieldLinkA: "idA1" },
];
```

C 表

```ts
[
  { id: "idC1", fieldC: "C1", fieldLinkB: "A1", __fk_fieldLinkB: "idB1" },
  { id: "idC2", fieldC: "C2", fieldLinkB: "A1", __fk_fieldLinkB: "idB1" },
  { id: "idC3", fieldC: "C3", fieldLinkB: "A1", __fk_fieldLinkB: "idB2" },
];
```

根据上述表述，如果 'idA1' 中的 fieldA 发生了变化，既可以推导出 ['idB1', 'idB2'] 和 ['idC1', 'idC2', 'idC3'] 都会受到关联关系的影响发生变化

我如何通过 SQL 一次性查找出这些 recordId 呢？ 为了实现动态的查询需求，我会将 idA1 和 topologicalOrder 作为参数传入
