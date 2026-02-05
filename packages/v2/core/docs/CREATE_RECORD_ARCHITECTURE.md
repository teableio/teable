# 创建行（Create Record）架构设计

## 整体流程图

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                     HTTP 层 (Interface)                                  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  POST /tables/createRecord                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │ Request Body: { tableId: string, fields: Record<fieldId, rawValue> }            │    │
│  └─────────────────────────────────────────────────────────────────────────────────┘    │
│                                          │                                               │
│                                          ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │ contract-http-implementation/router.ts                                          │    │
│  │ - 解析 JSON body                                                                 │
│  │ - 调用 CreateRecordCommand.create(raw)                                          │
│  │ - 通过 CommandBus 执行                                                           │
│  └─────────────────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                  Application 层 (Commands)                               │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  ┌──────────────────────────────────┐    ┌────────────────────────────────────────┐     │
│  │     CreateRecordCommand          │    │      CreateRecordHandler               │     │
│  │  ─────────────────────────────   │    │  ────────────────────────────────────  │     │
│  │  - tableId: TableId              │───▶│  1. 通过 TableRepository 加载 Table    │     │
│  │  - fieldValues: Map<id, value>   │    │  2. 调用 table.createRecord()         │     │
│  │                                  │    │  3. 调用 repository.insert()          │     │
│  │  static create(raw) → Result     │    │  4. 发布领域事件                        │     │
│  │    - Zod 校验输入                 │    │                                        │     │
│  │    - 转换为 Value Objects         │    │  依赖注入:                              │     │
│  └──────────────────────────────────┘    │  - ITableRepository                    │     │
│                                          │  - ITableRecordRepository              │     │
│                                          │  - IEventBus                           │     │
│                                          └────────────────────────────────────────┘     │
│                                                         │                                │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    Domain 层 (Core)                                      │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │                        Table.createRecord(fieldValues)                          │    │
│  │  ─────────────────────────────────────────────────────────────────────────────  │    │
│  │                                                                                 │    │
│  │  1. RecordId.generate()                    ← 生成唯一 ID                         │    │
│  │         │                                                                       │    │
│  │         ▼                                                                       │    │
│  │  2. RecordMutationSpecBuilder.create()     ← 创建变更规范构建器                   │    │
│  │         │                                                                       │    │
│  │         ▼                                                                       │    │
│  │  3. 遍历 getEditableFields()               ← 获取可编辑字段（排除计算字段）        │    │
│  │         │                                                                       │    │
│  │         ├──▶ 如果提供了值 → builder.set(field, providedValue)                    │    │
│  │         │                                                                       │    │
│  │         └──▶ 如果没有提供 → FieldDefaultValueVisitor 获取默认值                  │    │
│  │                              └──▶ builder.set(field, defaultValue)              │    │
│  │                                                                                 │    │
│  │  4. builder.hasErrors() ?                  ← 检查校验错误                         │    │
│  │         │                                                                       │    │
│  │         ▼                                                                       │    │
│  │  5. TableRecord.create({ id, tableId, fieldValues: [] })  ← 创建空记录           │    │
│  │         │                                                                       │    │
│  │         ▼                                                                       │    │
│  │  6. builder.buildAndMutate(emptyRecord)    ← 应用所有 Spec 变更                   │    │
│  │                                                                                 │    │
│  └─────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │                    RecordMutationSpecBuilder                                    │    │
│  │  ─────────────────────────────────────────────────────────────────────────────  │    │
│  │                                                                                 │    │
│  │  set(field, value):                                                             │    │
│  │    │                                                                            │    │
│  │    └──▶ SetFieldValueSpecFactory.create(field, value)                           │    │
│  │              │                                                                  │    │
│  │              ├──▶ FieldCellValueSchemaVisitor 生成 Zod Schema                   │    │
│  │              │                                                                  │    │
│  │              ├──▶ schema.safeParse(value) 校验值                                 │    │
│  │              │                                                                  │    │
│  │              └──▶ 返回对应类型的 Spec (SetSingleLineTextValueSpec, etc.)         │    │
│  │                                                                                 │    │
│  │  buildAndMutate(record):                                                        │    │
│  │    │                                                                            │    │
│  │    ├──▶ build() → 组合所有 Spec 为 AndSpec                                       │    │
│  │    │                                                                            │    │
│  │    └──▶ spec.mutate(record) → 在内存中应用变更                                    │    │
│  │                                                                                 │    │
│  └─────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │                         Visitors (领域内)                                        │    │
│  │  ─────────────────────────────────────────────────────────────────────────────  │    │
│  │                                                                                 │    │
│  │  FieldCellValueSchemaVisitor                                                    │    │
│  │  ├── visitSingleLineTextField() → z.string()                                    │    │
│  │  ├── visitNumberField() → z.number().min().max()                                │    │
│  │  ├── visitCheckboxField() → z.boolean()                                         │    │
│  │  ├── visitDateField() → z.string().datetime()                                   │    │
│  │  ├── visitLinkField() → z.array(z.object({ id, title }))                        │    │
│  │  └── visitFormulaField() → z.null() (计算字段)                                   │    │
│  │                                                                                 │    │
│  │  FieldDefaultValueVisitor                                                       │    │
│  │  ├── visitSingleLineTextField() → TextDefaultValue.value()                      │    │
│  │  ├── visitNumberField() → NumberDefaultValue.value()                            │    │
│  │  ├── visitCheckboxField() → CheckboxDefaultValue.value()                        │    │
│  │  ├── visitDateField() → 'now' ? new Date().toISOString() : undefined            │    │
│  │  └── visitFormulaField() → undefined (计算字段无默认值)                           │    │
│  │                                                                                 │    │
│  └─────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              Infrastructure 层 (Adapters)                                │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │                    PostgresTableRecordRepository.insert()                       │    │
│  │  ─────────────────────────────────────────────────────────────────────────────  │    │
│  │                                                                                 │    │
│  │  1. 获取 dbTableName                       ← table.dbTableName()                 │    │
│  │         │                                                                       │    │
│  │         ▼                                                                       │    │
│  │  2. 构建系统列值                                                                 │    │
│  │     {                                                                           │    │
│  │       __id: recordId,                                                           │    │
│  │       __created_time: now,                                                      │    │
│  │       __created_by: context.actorId,                                            │    │
│  │       __last_modified_time: now,                                                │    │
│  │       __last_modified_by: context.actorId,                                      │    │
│  │       __version: 1                                                              │    │
│  │     }                                                                           │    │
│  │         │                                                                       │    │
│  │         ▼                                                                       │    │
│  │  3. 遍历所有字段，使用 FieldInsertValueVisitor                                    │    │
│  │         │                                                                       │    │
│  │         ├──▶ 跳过计算字段 (field.computed())                                     │    │
│  │         │                                                                       │    │
│  │         └──▶ visitor.visit(field) → { columnValues, queryExecutors }            │    │
│  │                                                                                 │    │
│  │  4. db.insertInto(tableName).values(values).execute()                           │    │
│  │         │                                                                       │    │
│  │         ▼                                                                       │    │
│  │  5. 执行额外的 queryExecutors (Link 字段的 Junction/FK 更新)                      │    │
│  │                                                                                 │    │
│  └─────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │                     FieldInsertValueVisitor (基础设施层)                         │    │
│  │  ─────────────────────────────────────────────────────────────────────────────  │    │
│  │                                                                                 │    │
│  │  普通字段:                                                                       │    │
│  │  ├── visitSingleLineTextField() → { columnValues: { col: value } }              │    │
│  │  ├── visitNumberField() → { columnValues: { col: value } }                      │    │
│  │  └── visitMultipleSelectField() → { columnValues: { col: JSON.stringify() } }   │    │
│  │                                                                                 │    │
│  │  Link 字段 (复杂):                                                               │    │
│  │  ├── manyMany / oneMany(oneWay):                                                │    │
│  │  │     → queryExecutors: INSERT INTO junction_table ON CONFLICT UPDATE order    │    │
│  │  │                                                                              │    │
│  │  ├── manyOne / oneOne:                                                          │    │
│  │  │     → columnValues: { __fk_xxx: linkItem.id }                                │    │
│  │  │                                                                              │    │
│  │  └── oneMany (twoWay):                                                          │    │
│  │        → queryExecutors: UPDATE foreign_table SET __fk_xxx = recordId           │    │
│  │                                                                                 │    │
│  └─────────────────────────────────────────────────────────────────────────────────┘    │
│                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## DDD 层级职责

| 层级               | 包位置                               | 职责                                   | 关键类/文件                                                   |
| ------------------ | ------------------------------------ | -------------------------------------- | ------------------------------------------------------------- |
| **Interface**      | `contract-http-implementation`       | HTTP 路由、请求解析、响应映射          | `router.ts`, `createRecord.ts`                                |
| **Application**    | `core/commands`                      | 用例编排、事务管理、事件发布           | `CreateRecordCommand`, `CreateRecordHandler`                  |
| **Domain**         | `core/domain`                        | 业务规则、值校验、默认值处理、实体变更 | `Table.createRecord()`, `RecordMutationSpecBuilder`, Visitors |
| **Infrastructure** | `adapter-record-repository-postgres` | 数据库持久化、SQL 生成                 | `PostgresTableRecordRepository`, `FieldInsertValueVisitor`    |

## 详细流程说明

### 1. HTTP 层 (Interface)

```typescript
// contract-http-implementation/handlers/tables/createRecord.ts
export const createRecord = async (input, context) => {
  const command = CreateRecordCommand.create(input);
  const result = await commandBus.execute(context, command);
  return mapCreateRecordResultToDto(result);
};
```

**职责**：

- 接收 HTTP 请求
- 调用 `CreateRecordCommand.create()` 解析和校验输入
- 通过 `CommandBus` 执行命令
- 映射结果为 HTTP 响应 DTO

### 2. Application 层 (Commands)

```typescript
// core/commands/CreateRecordHandler.ts
@CommandHandler(CreateRecordCommand)
export class CreateRecordHandler {
  async handle(context, command) {
    // 1. 加载 Table 聚合根
    const table = await this.tableRepository.findOne(context, tableSpec);

    // 2. 调用领域方法创建记录 ⭐ 业务逻辑在这里
    const record = table.createRecord(command.fieldValues);

    // 3. 持久化
    await this.tableRecordRepository.insert(context, table, record);

    // 4. 发布事件
    await this.eventBus.publishMany(context, events);
  }
}
```

**职责**：

- 协调领域对象
- 管理事务（通过 UnitOfWork）
- 调用仓储持久化
- 发布领域事件

### 3. Domain 层 (核心业务逻辑) ⭐

#### 3.1 Table.createRecord() - 记录创建入口

```typescript
// core/domain/table/Table.ts
createRecord(fieldValues: ReadonlyMap<string, unknown>): Result<TableRecord, DomainError> {
  return safeTry(function* () {
    // 1. 生成唯一 ID
    const recordId = yield* RecordId.generate();

    // 2. 创建变更规范构建器
    const builder = RecordMutationSpecBuilder.create();
    const fields = table.getEditableFields();  // ⭐ 排除计算字段
    const defaultValueVisitor = FieldDefaultValueVisitor.create();

    // 3. 处理每个字段的值
    for (const field of fields) {
      if (fieldValues.has(fieldIdStr) && providedValue != null) {
        // ⭐ 用户提供了值 → 校验并设置
        builder.set(field, providedValue);
      } else {
        // ⭐ 没有提供 → 获取默认值
        const defaultValue = field.accept(defaultValueVisitor);
        if (defaultValue !== undefined) {
          builder.set(field, defaultValue);
        }
      }
    }

    // 4. 检查校验错误
    if (builder.hasErrors()) {
      return err(builder.getErrors()[0]);
    }

    // 5. 创建空记录并应用变更
    const emptyRecord = yield* TableRecord.create({ id: recordId, ... });
    return ok(yield* builder.buildAndMutate(emptyRecord));
  });
}
```

#### 3.2 RecordMutationSpecBuilder - 变更规范构建

```typescript
// core/domain/table/records/RecordMutationSpecBuilder.ts
export class RecordMutationSpecBuilder {
  private readonly specs: ICellValueSpec[] = [];
  private readonly errors: DomainError[] = [];

  set(field: Field, value: unknown): this {
    // ⭐ 通过工厂创建对应类型的 Spec
    const result = SetFieldValueSpecFactory.create(field, value);
    result.match(
      (spec) => this.specs.push(spec),
      (error) => this.errors.push(error) // 收集校验错误
    );
    return this;
  }

  buildAndMutate(record: TableRecord): Result<TableRecord, DomainError> {
    // 组合所有 Spec 为 AndSpec，然后在内存中 mutate
    return this.build().andThen((spec) => spec.mutate(record));
  }
}
```

#### 3.3 SetFieldValueSpecFactory - 值校验与 Spec 创建

```typescript
// core/domain/table/records/specs/values/SetFieldValueSpecFactory.ts
export const SetFieldValueSpecFactory = {
  create(field: Field, rawValue: unknown): Result<ICellValueSpec, DomainError> {
    // 1. 使用 Visitor 生成该字段类型的 Zod Schema
    const schemaVisitor = FieldCellValueSchemaVisitor.create();
    const schemaResult = field.accept(schemaVisitor);

    // 2. 用 Zod 校验值
    const parsed = schema.safeParse(rawValue);
    if (!parsed.success) {
      return err(domainError.validation({ ... }));
    }

    // 3. 使用另一个 Visitor 创建对应的 Spec
    const specVisitor = SetFieldValueSpecFactoryVisitor.create(parsed.data);
    return field.accept(specVisitor);
  }
};
```

#### 3.4 FieldCellValueSchemaVisitor - Zod Schema 生成

```typescript
// core/domain/table/fields/visitors/FieldCellValueSchemaVisitor.ts
export class FieldCellValueSchemaVisitor implements IFieldVisitor<z.ZodSchema> {
  visitSingleLineTextField(field): z.ZodSchema {
    let schema = z.string();
    // 根据字段配置调整 schema
    return this.applyNullable(field, schema);
  }

  visitNumberField(field): z.ZodSchema {
    let schema = z.number();
    const formatting = field.formatting();
    if (formatting) {
      if (formatting.min !== undefined) schema = schema.min(formatting.min);
      if (formatting.max !== undefined) schema = schema.max(formatting.max);
    }
    return this.applyNullable(field, schema);
  }

  visitLinkField(field): z.ZodSchema {
    const linkItemSchema = z.object({ id: z.string(), title: z.string().optional() });
    const relationship = field.relationship().toString();

    if (relationship === "manyOne" || relationship === "oneOne") {
      return linkItemSchema.nullable(); // 单个对象
    }
    return z.array(linkItemSchema).nullable(); // 数组
  }

  // ⭐ 计算字段返回 null schema
  visitFormulaField(): z.ZodSchema {
    return z.null().optional();
  }

  private applyNullable(field, schema) {
    return field.notNull().toBoolean() ? schema : schema.nullable();
  }
}
```

#### 3.5 FieldDefaultValueVisitor - 默认值获取

```typescript
// core/domain/table/fields/visitors/FieldDefaultValueVisitor.ts
export class FieldDefaultValueVisitor implements IFieldVisitor<unknown> {
  visitSingleLineTextField(field): unknown {
    const defaultValue = field.defaultValue();
    return defaultValue?.value() ?? undefined;
  }

  visitCheckboxField(field): unknown {
    const defaultValue = field.defaultValue();
    return defaultValue?.toBoolean() ?? false; // checkbox 默认 false
  }

  visitDateField(field): unknown {
    const defaultValue = field.defaultValue();
    if (defaultValue?.isNow()) {
      return new Date().toISOString(); // ⭐ 'now' 返回当前时间
    }
    return defaultValue?.value() ?? undefined;
  }

  // ⭐ 计算字段无默认值
  visitFormulaField(): unknown {
    return undefined;
  }
}
```

### 4. Infrastructure 层 (持久化)

#### 4.1 PostgresTableRecordRepository.insert()

```typescript
// adapter-record-repository-postgres/repository/PostgresTableRecordRepository.ts
async insert(context, table, record): Promise<Result<void, DomainError>> {
  // 1. 系统列
  const values = {
    __id: recordId,
    __created_time: now,
    __created_by: context.actorId,
    __version: 1,
    // ...
  };

  // 2. 收集额外的查询执行器（Link 字段用）
  const queryExecutors: QueryExecutor[] = [];

  // 3. 遍历字段，使用 Visitor 处理
  for (const field of table.getFields()) {
    if (field.computed().toBoolean()) continue;  // ⭐ 跳过计算字段

    const cellValue = record.fields().get(field.id());
    const rawValue = cellValue?.toValue() ?? null;

    // ⭐ 使用 Visitor 转换为数据库格式
    const insertVisitor = FieldInsertValueVisitor.create(rawValue, { recordId, dbFieldName });
    const { columnValues, queryExecutors: executors } = field.accept(insertVisitor);

    Object.assign(values, columnValues);
    queryExecutors.push(...executors);
  }

  // 4. 执行主表 INSERT
  await db.insertInto(tableName).values(values).execute();

  // 5. 执行 Link 字段的额外操作
  for (const executor of queryExecutors) {
    await executor(db);
  }
}
```

#### 4.2 FieldInsertValueVisitor - 字段值到数据库映射

```typescript
// adapter-record-repository-postgres/visitors/FieldInsertValueVisitor.ts
export class FieldInsertValueVisitor implements IFieldVisitor<FieldInsertResult> {
  // 简单字段 → 直接映射
  visitSingleLineTextField(): FieldInsertResult {
    return { columnValues: { [dbFieldName]: rawValue }, queryExecutors: [] };
  }

  // JSONB 字段 → JSON.stringify
  visitMultipleSelectField(): FieldInsertResult {
    const value = rawValue ? JSON.stringify(rawValue) : null;
    return { columnValues: { [dbFieldName]: value }, queryExecutors: [] };
  }

  // ⭐ Link 字段 → 复杂处理
  visitLinkField(field): FieldInsertResult {
    const relationship = field.relationship().toString();

    if (relationship === "manyMany" || (relationship === "oneMany" && field.isOneWay())) {
      // Junction 表插入
      return {
        columnValues: {},
        queryExecutors: linkItems.map(
          (item, i) => (db) =>
            db
              .insertInto(junctionTable)
              .values({ selfKey: recordId, foreignKey: item.id, order: i + 1 })
              .onConflict((oc) => oc.columns([selfKey, foreignKey]).doUpdateSet({ order: i + 1 }))
              .execute()
        ),
      };
    }

    if (relationship === "manyOne" || relationship === "oneOne") {
      // FK 列直接设置
      return {
        columnValues: { [fkColumnName]: linkItems[0].id },
        queryExecutors: [],
      };
    }

    if (relationship === "oneMany") {
      // 更新外表的 FK
      return {
        columnValues: {},
        queryExecutors: linkItems.map(
          (item) => (db) =>
            db
              .updateTable(foreignTable)
              .set({ [fkColumn]: recordId })
              .where("__id", "=", item.id)
              .execute()
        ),
      };
    }
  }

  // ⭐ 计算字段 → 不插入
  visitFormulaField(): FieldInsertResult {
    return { columnValues: {}, queryExecutors: [] };
  }
}
```

## 数据流向图

```
┌─────────────────┐
│   HTTP Request  │
│ {tableId,fields}│
└────────┬────────┘
         │
         ▼
┌─────────────────┐     Zod 校验
│CreateRecordCmd  │────────────────▶ Result<Command, Error>
│  .create(raw)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ CreateRecord    │
│   Handler       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     FieldDefaultValueVisitor
│ Table.create    │────────────────▶ 默认值
│   Record()      │
│                 │     FieldCellValueSchemaVisitor
│                 │────────────────▶ Zod Schema → 校验
│                 │
│                 │     RecordMutationSpecBuilder
│                 │────────────────▶ ICellValueSpec[]
│                 │
│                 │     spec.mutate(record)
│                 │────────────────▶ TableRecord (内存)
└────────┬────────┘
         │
         ▼
┌─────────────────┐     FieldInsertValueVisitor
│ PostgresTable   │────────────────▶ { columnValues, queryExecutors }
│ RecordRepo      │
│  .insert()      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   PostgreSQL    │
│   Database      │
└─────────────────┘
```

## 关键设计决策

### 1. 默认值在哪里处理？

**答：Domain 层 (`Table.createRecord()`)**

```typescript
// ⭐ 在领域模型中处理默认值，而不是在数据库层
const defaultValueVisitor = FieldDefaultValueVisitor.create();
for (const field of fields) {
  if (!fieldValues.has(fieldIdStr)) {
    const defaultValue = field.accept(defaultValueVisitor);
    builder.set(field, defaultValue);
  }
}
```

**原因**：

- 默认值是业务规则，应该在领域层处理
- 允许复杂的默认值逻辑（如 `now` 动态计算）
- 便于测试

### 2. 值校验在哪里进行？

**答：Domain 层 (`SetFieldValueSpecFactory`)**

```typescript
// ⭐ 通过 Visitor 生成 Zod Schema，在领域层校验
const schema = field.accept(FieldCellValueSchemaVisitor.create());
const parsed = schema.safeParse(rawValue);
```

**原因**：

- 校验规则来自字段配置，是领域知识
- 统一的校验入口
- 返回详细的校验错误

### 3. 计算字段如何处理？

**答：多层过滤**

```typescript
// Domain 层：getEditableFields() 排除计算字段
const fields = table.getEditableFields();

// Infrastructure 层：再次检查
if (field.computed().toBoolean()) continue;

// Visitor：返回空结果
visitFormulaField(): FieldInsertResult {
  return { columnValues: {}, queryExecutors: [] };
}
```

### 4. Link 字段的复杂性如何处理？

**答：FieldInsertValueVisitor 封装**

```typescript
// ⭐ Visitor 根据 relationship 类型返回不同的处理方式
visitLinkField(field) {
  switch (relationship) {
    case 'manyMany':     // → Junction INSERT
    case 'manyOne':      // → FK 列
    case 'oneMany':      // → 更新外表 FK
    case 'oneOne':       // → FK 列 + 唯一约束
  }
}
```

## 测试覆盖

| 层级           | 测试类型           | 测试文件                                                        |
| -------------- | ------------------ | --------------------------------------------------------------- |
| Domain         | Unit               | `Table.createRecordInputSchema.spec.ts`, `Table.spec.ts`        |
| Application    | Unit + Integration | `CreateRecordHandler.spec.ts`, `CreateRecordHandler.db.spec.ts` |
| Infrastructure | Integration        | `PostgresTableRecordRepository` (implicit in db tests)          |
| E2E            | HTTP               | `createRecord.e2e.spec.ts`, `createRecordLink.e2e.spec.ts`      |
