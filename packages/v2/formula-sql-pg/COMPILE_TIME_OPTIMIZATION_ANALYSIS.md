# 日期函数 SQL 生成的编译期优化分析

## 问题概述

当前日期函数的 SQL 生成存在以下问题：

1. **不必要的复杂 SQL**：即使可以确定结果一定是错误，仍然生成复杂的 CASE WHEN 语句
2. **缺少编译期类型检查**：对于单位参数，如果字段类型明显不可能是有效单位字符串，应该在编译期就返回错误
3. **SQL 性能问题**：生成的 SQL 过长，包含大量不必要的条件判断
4. **重复的复杂 SQL**：某些函数在错误路径上生成了重复的复杂 SQL 表达式

## 所有日期函数分析

### 函数分类

1. **提取日期部分函数** (extractDatePart): Year, Month, WeekNum, Weekday, Day, Hour, Minute, Second
2. **相对时间函数**: FromNow, ToNow
3. **日期计算函数**: DateAdd, DatetimeDiff, Workday, WorkdayDiff
4. **日期比较函数**: IsSame, IsAfter, IsBefore
5. **日期格式化函数**: Datestr, Timestr, DatetimeFormat, DatetimeParse

## 具体问题分析

### 1. 单位参数类型检查缺失（DateAdd, DatetimeDiff, IsSame）

#### 问题示例

```typescript
// 测试用例：DATE_ADD("2024-01-02T00:00:00Z", 1, {CreatedTime})
// CreatedTime 是日期时间类型字段
// 格式化后的值： "0000/00/00 00:00" (格式：YYYY/MM/DD HH:mm)
// 这个值不可能匹配任何有效的单位字符串（"year", "month", "day" 等）
```

**当前行为**：

- 将 CreatedTime 通过 `coerceToString` 转换为字符串
- 使用 `formatDatetimeString` 格式化为日期时间字符串
- 生成复杂的 CASE WHEN 语句，检查格式化后的字符串是否匹配单位列表
- 最终结果一定是 `#ERROR:ARG:invalid_date_add_unit`

**问题**：

- 在编译期就可以知道 CreatedTime 字段格式化后的字符串格式是固定的（如 "YYYY/MM/DD HH:mm"）
- 这个格式不可能匹配任何单位字符串（"year", "month", "day", "hour", "minute", "second" 等）
- 应该直接返回错误，而不是生成复杂的 SQL

#### 应该优化的字段类型

以下字段类型作为单位参数时，应该直接返回错误：

1. **日期时间类型字段**（格式化后的字符串格式固定，不可能匹配单位字符串）：

   - `date` - 格式：`YYYY/MM/DD` 或 `YYYY/MM/DD HH:mm`
   - `createdTime` - 格式：`YYYY/MM/DD HH:mm`
   - `lastModifiedTime` - 格式：`YYYY/MM/DD HH:mm`

2. **非字符串类型字段**（如果不是字面量，不可能是有效的单位字符串）：

   - `number` - 数字类型，不可能匹配单位字符串
   - `checkbox` - 布尔类型，不可能匹配单位字符串
   - `rating` - 数字类型，不可能匹配单位字符串
   - `autoNumber` - 数字类型，不可能匹配单位字符串

3. **复杂类型字段**（格式化后的字符串不可能匹配单位字符串）：
   - `attachment` - JSON 对象数组，格式化后是 "10, 20" 这样的格式
   - `user` - JSON 对象数组，格式化后是 "10, 20" 这样的格式
   - `link` - JSON 对象，格式化后是 title 或 name
   - `singleSelect` - 选项值，不可能是单位字符串
   - `multipleSelect` - 选项值数组，格式化后是 "10, 20" 这样的格式

**例外**：

- `singleLineText` / `longText` - 字符串类型，可能包含有效的单位字符串，需要运行时检查
- 字面量字符串 - 需要在运行时检查

### 2. DatetimeParse 的复杂 SQL 问题

#### 问题示例

```typescript
// DATETIME_PARSE({Attachment})
// Attachment 是 JSON 数组类型字段
```

**当前行为**：

- 通过 `coerceToString` 将 Attachment 转换为字符串
- 生成包含重复字符串聚合操作的复杂 SQL（~500+ 字符）
- 字符串聚合操作在 SQL 中重复出现多次
- 最终结果一定是 `#ERROR:TYPE:cannot_cast_to_datetime`

**问题**：

- `coerceToDatetime` 已经有 `isNonDatetimeField` 和 `isStructuredJsonField` 的检查
- 但是 `coerceToString` 会先执行，将 JSON 数组转换为字符串
- 然后 `coerceToDatetime` 内部的 `coerceToString` 又会再次执行
- 导致重复的复杂 SQL 生成

**分析**：

- `coerceToDatetime` 在调用 `coerceToString` 之前，应该先检查字段类型
- 实际上 `coerceToDatetime` 已经检查了 `isStructuredJsonField` 和 `isNonDatetimeField`
- 但 `DatetimeParse` 的实现中，先调用了 `coerceToString`，然后再调用 `coerceToDatetime`
- 这导致 `coerceToDatetime` 的编译期检查被绕过

**优化建议**：

- `DatetimeParse` 应该先检查字段类型，如果是非日期时间兼容字段，直接返回错误
- 或者重构 `coerceToDatetime` 以在更早的阶段检查字段类型

### 3. DateAdd/DatetimeDiff/IsSame 的单位参数优化

这三个函数都有类似的问题：

- 单位参数如果是字段引用，且字段类型不可能是有效的单位字符串，应该直接返回错误
- 当前实现会生成复杂的 CASE WHEN SQL

### 4. 提取日期部分函数（Year, Month, Day 等）

**当前状态**：✅ **已优化**

- 使用 `coerceToDatetime`，已经有编译期检查
- `isNonDatetimeField` 和 `isStructuredJsonField` 会直接返回错误
- SQL 生成简洁

**示例**：

```sql
-- YEAR({Attachment})
-- SQL: '#ERROR:TYPE:cannot_cast_to_datetime'
-- ✅ 正确：直接返回错误
```

### 5. FromNow/ToNow

**当前状态**：✅ **已优化**

- 使用 `coerceToDatetime`，已经有编译期检查
- SQL 生成简洁

### 6. Workday/WorkdayDiff

**当前状态**：✅ **已优化**

- 使用 `coerceToDatetime`，已经有编译期检查
- SQL 生成简洁

**示例**：

```sql
-- WORKDAY({Attachment}, 2)
-- SQL: "CASE WHEN TRUE THEN '#ERROR:TYPE:cannot_cast_to_datetime' ELSE '#ERROR:TYPE:invalid_workday' END"
-- ✅ 正确：直接返回错误（虽然 SQL 可以进一步简化）
```

### 7. IsAfter/IsBefore

**当前状态**：✅ **已优化**

- 使用 `handleComparison`，内部使用 `coerceToDatetime`
- SQL 生成相对简洁

### 8. Datestr/Timestr

**当前状态**：✅ **已优化**

- 使用 `coerceToDatetime`，已经有编译期检查
- SQL 生成简洁

### 9. DatetimeFormat

**当前状态**：✅ **基本正常**

- 使用 `coerceToDatetime` 和 `coerceToString`
- SQL 生成简洁
- 格式参数是字符串，可能需要运行时检查（合理）

## 优化方案总结

### 优先级高

1. **DateAdd 单位参数类型检查**

   - 当单位参数是字段引用时，检查字段类型
   - 如果是日期时间类型、非字符串类型或复杂类型字段，直接返回错误

2. **DatetimeDiff 单位参数类型检查**

   - 同 DateAdd

3. **IsSame 单位参数类型检查**

   - 同 DateAdd

4. **DatetimeParse 优化**
   - 在调用 `coerceToString` 之前，先检查字段类型
   - 如果是 `isNonDatetimeField` 或 `isStructuredJsonField`，直接返回错误

### 优先级中

5. **Workday/WorkdayDiff SQL 简化**
   - 当前 SQL 是 `CASE WHEN TRUE THEN ... ELSE ... END`
   - 可以简化为直接返回错误字面量

### 优先级低

6. **其他微优化**
   - 各种错误 SQL 的进一步简化

## 辅助函数建议

添加以下辅助函数来简化类型检查：

```typescript
protected isDatetimeField(expr: SqlExpr): boolean {
  const type = this.getFieldTypeName(expr);
  return type === 'date' || type === 'createdTime' || type === 'lastModifiedTime';
}

protected isUnitStringCompatibleField(expr: SqlExpr): boolean {
  // 检查字段类型是否可能包含有效的单位字符串
  if (!expr.field) return true; // 非字段引用，需要运行时检查

  const fieldType = this.getFieldTypeName(expr);
  if (!fieldType) return true; // 无法确定类型，需要运行时检查

  // 字符串类型字段可能包含有效的单位字符串
  if (fieldType === 'singleLineText' || fieldType === 'longText') {
    return true;
  }

  // 其他类型字段不可能包含有效的单位字符串
  return false;
}

protected canFieldBeDatetimeString(expr: SqlExpr): boolean {
  // 检查字段是否可能包含有效的日期时间字符串
  if (!expr.field) return true; // 非字段引用，需要运行时检查

  // 如果是非日期时间兼容字段，不可能包含有效的日期时间字符串
  if (this.isNonDatetimeField(expr) || this.isStructuredJsonField(expr)) {
    return false;
  }

  return true;
}
```

## 实施建议

### 阶段 1：单位参数优化（优先级最高）

1. 为 DateAdd、DatetimeDiff、IsSame 添加单位参数的编译期类型检查
2. 添加 `isUnitStringCompatibleField` 辅助函数
3. 当单位参数是字段引用且类型不兼容时，直接返回错误

### 阶段 2：DatetimeParse 优化

1. 重构 DatetimeParse，在调用 coerceToString 之前检查字段类型
2. 添加 `canFieldBeDatetimeString` 辅助函数
3. 如果是非日期时间兼容字段，直接返回错误

### 阶段 3：SQL 简化（可选）

1. 简化 Workday/WorkdayDiff 的错误 SQL
2. 其他微优化

## 测试建议

添加以下测试用例验证优化效果：

1. 日期时间类型字段作为单位参数的测试
2. 非字符串类型字段作为单位参数的测试
3. 复杂类型字段作为单位参数的测试
4. DatetimeParse 使用复杂类型字段的测试
5. 验证优化后的 SQL 长度和复杂度
6. 验证错误消息的正确性

## 预期效果

### DateAdd 单位参数优化

**优化前**：

```sql
-- DATE_ADD("2024-01-02T00:00:00Z", 1, {CreatedTime})
-- SQL 长度：~2000+ 字符
-- 包含：多层 CASE WHEN、日期格式化、单位匹配检查
```

**优化后**：

```sql
-- DATE_ADD("2024-01-02T00:00:00Z", 1, {CreatedTime})
-- SQL 长度：~50 字符
-- 直接返回：'#ERROR:ARG:invalid_date_add_unit'
```

### DatetimeParse 优化

**优化前**：

```sql
-- DATETIME_PARSE({Attachment})
-- SQL 长度：~500+ 字符
-- 包含：重复的字符串聚合操作、日期时间验证
```

**优化后**：

```sql
-- DATETIME_PARSE({Attachment})
-- SQL 长度：~50 字符
-- 直接返回：'#ERROR:TYPE:cannot_cast_to_datetime'
```

### 性能提升

1. **SQL 解析时间**：减少 90%+
2. **执行时间**：从需要执行复杂 CASE WHEN 到直接返回错误
3. **可读性**：SQL 更简洁，更容易调试
4. **维护性**：代码逻辑更清晰，错误处理更明确
