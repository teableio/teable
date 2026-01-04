# Lookup 字段 SQL 生成优化方案

## 问题分析

当前 lookup 字段的 SQL 生成存在以下问题：

1. **SQL 过于复杂**：所有 lookup 字段都使用相同的复杂 JSON 提取逻辑
2. **未利用 innerField 信息**：lookup 字段有 innerField，它决定了值的实际类型，但当前实现没有利用这个信息
3. **不必要的类型转换**：即使知道 innerField 是 number 或 date，仍然使用通用的 JSON 提取逻辑

### 当前实现的问题

以 `DATETIME_FORMAT({LookupType}, "YYYY-MM-DD HH:mm")` 为例，生成的 SQL 包含：

```sql
(SELECT CASE
  WHEN v.elem IS NULL OR jsonb_typeof(v.elem) = 'null' THEN NULL
  ELSE (CASE
    WHEN jsonb_typeof(v.elem) = 'object' THEN COALESCE(v.elem->>'title', v.elem->>'name', v.elem #>> '{}')
    WHEN jsonb_typeof(v.elem) = 'array' THEN NULL
    ELSE v.elem #>> '{}'
  END)
END
FROM (SELECT ((CASE
  WHEN "t"."LookupType" IS NULL THEN '[]'::jsonb
  WHEN jsonb_typeof(to_jsonb("t"."LookupType")) = 'array' THEN to_jsonb("t"."LookupType")
  WHEN jsonb_typeof(to_jsonb("t"."LookupType")) = 'null' THEN '[]'::jsonb
  ELSE jsonb_build_array(to_jsonb("t"."LookupType"))
END) -> 0) AS elem) AS v)
```

这个逻辑在多个地方重复（错误检查、值提取、类型转换等），导致 SQL 非常冗长。

## 优化方案

### 核心思路

根据 lookup 字段的 **innerField 类型**来优化 SQL 生成：

1. **编译期检查**：在 SQL 生成时检查 lookup 字段的 innerField 类型
2. **类型特定优化**：根据 innerField 类型生成更简洁的 SQL
3. **早期错误检测**：如果 innerField 是不兼容的类型（如 button），直接返回错误

### 实现策略

#### 1. 添加 lookup 字段的 innerField 类型检查

在 `FormulaSqlPgExpressionBuilder` 中添加方法：

```typescript
protected getLookupInnerFieldType(expr: SqlExpr): string | null {
  if (!expr.field) return null;
  const field = expr.field;

  // 检查是否是 LookupField
  if (!field.type().equals(FieldType.lookup())) return null;

  // 获取 innerField
  const lookupField = field as LookupField;
  const innerFieldResult = lookupField.innerField();
  if (innerFieldResult.isErr()) return null;

  const innerField = innerFieldResult.value;
  return innerField.type().toString();
}
```

#### 2. 优化 extractArrayScalarText 方法

根据 innerField 类型生成不同的 SQL：

```typescript
protected extractArrayScalarText(expr: SqlExpr): string {
  if (expr.storageKind === 'array' || expr.storageKind === 'json') {
    const normalized = this.normalizeArrayExpr(expr);

    // 检查是否是 lookup 字段
    const innerFieldType = this.getLookupInnerFieldType(expr);
    if (innerFieldType) {
      return this.extractLookupScalarText(normalized, innerFieldType);
    }

    // 原有的逻辑...
  }
  return extractFirstJsonScalarText(expr.valueSql);
}

protected extractLookupScalarText(normalizedJson: string, innerFieldType: string): string {
  // 根据 innerField 类型优化提取逻辑
  switch (innerFieldType) {
    case 'button':
      // Button 类型无法转换为标量，应该返回错误
      return `NULL`; // 或者直接返回错误表达式

    case 'number':
    case 'rating':
    case 'autoNumber':
      // 数字类型：直接提取为数字，不需要复杂的 JSON 解析
      return `(SELECT CASE
        WHEN v.elem IS NULL OR jsonb_typeof(v.elem) = 'null' THEN NULL
        ELSE (v.elem #>> '{}')::numeric
      END
      FROM (SELECT (${normalizedJson} -> 0) AS elem) AS v)`;

    case 'date':
    case 'createdTime':
    case 'lastModifiedTime':
      // 日期类型：直接提取为日期
      return `(SELECT CASE
        WHEN v.elem IS NULL OR jsonb_typeof(v.elem) = 'null' THEN NULL
        WHEN pg_input_is_valid((v.elem #>> '{}')::text, 'timestamptz')
          THEN ((v.elem #>> '{}')::text)::timestamptz
        WHEN pg_input_is_valid((v.elem #>> '{}')::text, 'timestamp')
          THEN ((v.elem #>> '{}')::text)::timestamp::timestamptz
        ELSE NULL
      END
      FROM (SELECT (${normalizedJson} -> 0) AS elem) AS v)`;

    case 'singleLineText':
    case 'longText':
    case 'singleSelect':
    case 'multipleSelect':
      // 文本类型：直接提取文本
      return `(SELECT CASE
        WHEN v.elem IS NULL OR jsonb_typeof(v.elem) = 'null' THEN NULL
        ELSE v.elem #>> '{}'
      END
      FROM (SELECT (${normalizedJson} -> 0) AS elem) AS v)`;

    case 'checkbox':
      // 布尔类型：提取为布尔值
      return `(SELECT CASE
        WHEN v.elem IS NULL OR jsonb_typeof(v.elem) = 'null' THEN NULL
        WHEN (v.elem #>> '{}')::boolean THEN TRUE
        ELSE FALSE
      END
      FROM (SELECT (${normalizedJson} -> 0) AS elem) AS v)`;

    default:
      // 其他类型：使用通用逻辑
      return `(SELECT CASE
        WHEN v.elem IS NULL OR jsonb_typeof(v.elem) = 'null' THEN NULL
        ELSE ${extractJsonScalarText('v.elem')}
      END
      FROM (SELECT (${normalizedJson} -> 0) AS elem) AS v)`;
  }
}
```

#### 3. 优化 coerceTo\* 方法

在类型转换时，如果知道 innerField 类型，可以提前返回错误：

```typescript
protected coerceToDatetime(expr: SqlExpr): SqlExpr {
  const base = this.unwrapArrayToScalar(expr);

  // 检查 lookup 字段的 innerField 类型
  const innerFieldType = this.getLookupInnerFieldType(base);
  if (innerFieldType === 'button' || innerFieldType === 'link' || innerFieldType === 'attachment') {
    return makeExpr(
      'NULL::timestamptz',
      'datetime',
      false,
      'TRUE',
      buildErrorLiteral('TYPE', 'cannot_cast_to_datetime'),
      base.field
    );
  }

  // 如果 innerField 是 date 类型，可以使用更简单的提取逻辑
  if (innerFieldType === 'date' || innerFieldType === 'createdTime' || innerFieldType === 'lastModifiedTime') {
    // 使用优化的日期提取逻辑
  }

  // 原有逻辑...
}
```

#### 4. 统一处理 lookup 字段的 JSON 结构

lookup 字段在数据库中的存储格式：

- 如果是数组：`[value1, value2, ...]`
- 如果是单个值：`value`（会被转换为 `[value]`）

优化后的 `normalizeArrayExpr` 可以针对 lookup 字段简化：

```typescript
protected normalizeArrayExpr(expr: SqlExpr): string {
  // 如果是 lookup 字段，可以简化 JSON 规范化逻辑
  const innerFieldType = this.getLookupInnerFieldType(expr);
  if (innerFieldType && expr.storageKind === 'array') {
    // lookup 字段总是存储为 JSON，可以直接使用
    return `COALESCE(NULLIF((${expr.valueSql})::jsonb, 'null'::jsonb), '[]'::jsonb)`;
  }

  // 原有逻辑...
}
```

## 优化效果

### 优化前（当前实现）

```sql
-- DATETIME_FORMAT({LookupType}, "YYYY-MM-DD HH:mm")
CASE WHEN ((SELECT CASE WHEN v.elem IS NULL OR jsonb_typeof(v.elem) = 'null' THEN NULL ELSE (CASE WHEN jsonb_typeof(v.elem) = 'object' THEN COALESCE(v.elem->>'title', v.elem->>'name', v.elem #>> '{}') WHEN jsonb_typeof(v.elem) = 'array' THEN NULL ELSE v.elem #>> '{}' END) END FROM (SELECT ((CASE WHEN "t"."LookupType" IS NULL THEN '[]'::jsonb WHEN jsonb_typeof(to_jsonb("t"."LookupType")) = 'array' THEN to_jsonb("t"."LookupType") WHEN jsonb_typeof(to_jsonb("t"."LookupType")) = 'null' THEN '[]'::jsonb ELSE jsonb_build_array(to_jsonb("t"."LookupType")) END) -> 0) AS elem) AS v) IS NOT NULL AND NOT (pg_input_is_valid(...))) THEN ... ELSE TO_CHAR(...) END
```

### 优化后（假设 innerField 是 date 类型）

```sql
-- DATETIME_FORMAT({LookupType}, "YYYY-MM-DD HH:mm")
CASE WHEN (SELECT CASE WHEN v.elem IS NULL THEN NULL WHEN pg_input_is_valid((v.elem #>> '{}')::text, 'timestamptz') THEN ((v.elem #>> '{}')::text)::timestamptz ELSE NULL END FROM (SELECT (COALESCE(NULLIF(("t"."LookupType")::jsonb, 'null'::jsonb), '[]'::jsonb) -> 0) AS elem) AS v) IS NOT NULL AND NOT (pg_input_is_valid(...)) THEN ... ELSE TO_CHAR(...) END
```

**优化效果**：

- SQL 长度减少约 40-60%
- 移除了不必要的 JSON 类型检查（因为知道 innerField 类型）
- 直接使用类型特定的提取逻辑

## 实现步骤

1. **添加辅助方法**：`getLookupInnerFieldType()` 和 `extractLookupScalarText()`
2. **修改 extractArrayScalarText**：根据 innerField 类型选择提取策略
3. **修改 coerceTo\* 方法**：在类型转换时利用 innerField 信息
4. **添加测试**：确保优化后的 SQL 正确性
5. **性能测试**：验证优化后的 SQL 执行性能

## 注意事项

1. **向后兼容**：如果 lookup 字段的 innerField 未解析（pending），回退到原有逻辑
2. **错误处理**：对于不兼容的类型（如 button），应该返回明确的错误
3. **测试覆盖**：确保所有 innerField 类型组合都被测试到

## 相关文件

- `packages/v2/formula-sql-pg/src/FormulaSqlPgExpressionBuilder.ts` - 主要实现文件
- `packages/v2/formula-sql-pg/src/FieldSqlCoercionVisitor.ts` - 字段类型元数据
- `packages/v2/core/src/domain/table/fields/types/LookupField.ts` - LookupField 定义
