# SQL 复杂度分析报告

## 执行摘要

通过对快照文件的全面分析，发现了以下主要问题：

1. **153个SQL查询超过500字符**，其中许多可以显著简化
2. **103个错误结果但SQL复杂**（长度>100字符），这些应该直接返回错误字面量
3. **严重的重复模式**：`pg_input_is_valid` 在某些查询中重复104次
4. **单位参数类型检查缺失**：DateAdd、DatetimeDiff、IsSame 函数在已知会失败的情况下仍生成复杂SQL

## 关键发现

### 1. 最严重的案例（错误结果但SQL极长）

| 测试用例                               | SQL长度    | 结果                                    | 问题                                                     |
| -------------------------------------- | ---------- | --------------------------------------- | -------------------------------------------------------- |
| `DatetimeDiffUnitField` with 'formula' | 16,240字符 | `#ERROR:ARG:invalid_datetime_diff_unit` | 单位参数是formula字段，生成了极度复杂的SQL但结果只是错误 |
| `DateAddUnitField` with 'formula'      | 7,128字符  | `#ERROR:ARG:invalid_date_add_unit`      | 同上                                                     |
| `IsSameUnitField` with 'formula'       | 5,946字符  | `#ERROR:ARG:invalid_is_same_unit`       | 同上                                                     |

**建议**：这些情况应该在编译期就检测到单位参数不可能是有效单位字符串，直接返回错误字面量。

### 2. 重复模式统计

最常见的重复模式：

- `pg_input_is_valid` 调用在单个查询中重复最多104次
- Attachment字段提取子查询在同一SQL中重复多次
- 数字转换的正则表达式模式重复多次

**示例问题SQL结构**：

```sql
-- 伪代码示例：实际SQL中相同的子查询重复多次
(SELECT ... FROM (SELECT CASE WHEN v.elem IS NULL ... END FROM ...)) =
(SELECT ... FROM (SELECT CASE WHEN v.elem IS NULL ... END FROM ...))
```

### 3. 错误路径的SQL复杂度

**103个错误结果但SQL复杂的案例**，主要包括：

1. **日期函数单位参数错误**（最严重）

   - `DatetimeDiffUnitField`, `DateAddUnitField`, `IsSameUnitField` 使用formula字段
   - SQL长度：1,000-16,000字符
   - 结果：错误消息

2. **类型转换错误**

   - `DatetimeParse` with formula字段 → `#ERROR:TYPE:cannot_cast_to_datetime`
   - SQL长度：~800字符
   - 结果：错误消息

3. **数值函数类型错误**
   - `ValueBad`, `Mod`, `Abs` 等函数使用不兼容字段类型
   - SQL长度：300-1,800字符
   - 结果：错误消息

## 详细分类分析

### 日期函数 (DateFunctions.spec.ts.snap)

#### 问题1: 单位参数类型检查缺失 ⚠️ **严重**

**影响函数**：`DateAdd`, `DatetimeDiff`, `IsSame`

**问题描述**：

- 当单位参数是formula字段引用时，生成了数千字符的SQL
- 实际上在编译期就可以判断这些字段类型不可能包含有效的单位字符串
- 结果只是错误消息，但SQL极其复杂

**优化建议**：

- 添加编译期类型检查：如果单位参数是字段引用，检查字段类型
- 日期时间类型字段（date, createdTime, lastModifiedTime）→ 直接返回错误
- 非字符串类型字段（number, checkbox等）→ 直接返回错误
- 复杂类型字段（attachment, user, link等）→ 直接返回错误
- 只有 singleLineText/longText 需要运行时检查

#### 问题2: DatetimeParse 复杂SQL

**问题描述**：

- `DATETIME_PARSE({Attachment})` 生成~800字符的SQL
- 结果只是 `#ERROR:TYPE:cannot_cast_to_datetime`
- `coerceToString` 先执行，然后 `coerceToDatetime` 内部又调用 `coerceToString`

**优化建议**：

- 在调用 `coerceToString` 之前先检查字段类型
- 如果是 `isNonDatetimeField` 或 `isStructuredJsonField`，直接返回错误

### 数值函数 (NumericFunctions.spec.ts.snap)

#### 问题1: 重复的数值转换模式

**问题描述**：

- 数值转换（如 `INT`, `VALUE`）使用复杂类型字段时，生成长SQL
- 包含重复的 `REGEXP_REPLACE` 和 `pg_input_is_valid` 调用
- 同一转换逻辑在SQL中重复多次

**示例**：

```sql
-- INT({Attachment}) 生成的SQL包含：
CASE WHEN (SELECT (NULLIF(REGEXP_REPLACE(BTRIM((v.val)::text), '[,\\s]', '', 'g'), '') IS NOT NULL
  AND NOT (NULLIF(REGEXP_REPLACE(BTRIM((v.val)::text), '[,\\s]', '', 'g'), '') ~ '^[+-]?((\\d+\\.?\\d*)|(\\d*\\.\\d+))([eE][+-]?\\d+)?$'
  AND pg_input_is_valid(NULLIF(REGEXP_REPLACE(BTRIM((v.val)::text), '[,\\s]', '', 'g'), ''), 'numeric')))
FROM (SELECT (SELECT CASE WHEN v.elem IS NULL ... END FROM ...) AS val) AS v) THEN ...
-- 这个模式在同一SQL中重复多次
```

**优化建议**：

- 考虑使用CTE（Common Table Expression）提取公共子查询
- 或者优化转换逻辑，减少重复计算

### 二进制运算符 (BinaryOperators.spec.ts.snap)

#### 问题1: Attachment字段比较的重复子查询

**问题描述**：

- Attachment字段比较时，提取第一个元素的子查询重复出现
- 同一个 `CASE WHEN v.elem IS NULL ... END FROM ...` 模式在同一SQL中重复多次

**示例**：

```sql
-- {Attachment} = {Attachment} 生成的SQL：
((SELECT CASE
    WHEN v.elem IS NULL OR jsonb_typeof(v.elem) = 'null' THEN NULL
    ELSE COALESCE(v.elem->>'title', v.elem->>'name', v.elem #>> '{}')
  END
  FROM (SELECT (COALESCE(NULLIF(("t"."Attachment")::jsonb, 'null'::jsonb), '[]'::jsonb) -> 0) AS elem) AS v)
=
(SELECT CASE
    WHEN v.elem IS NULL OR jsonb_typeof(v.elem) = 'null' THEN NULL
    ELSE COALESCE(v.elem->>'title', v.elem->>'name', v.elem #>> '{}')
  END
  FROM (SELECT (COALESCE(NULLIF(("t"."Attachment")::jsonb, 'null'::jsonb), '[]'::jsonb) -> 0) AS elem) AS v))
```

**优化建议**：

- 考虑提取公共的attachment字段转换表达式
- 或者使用LATERAL JOIN等PostgreSQL特性简化

#### 问题2: 类型转换比较的过度复杂CASE语句

**问题描述**：

- 不同类型字段比较时（如 attachment = date），生成多层嵌套的CASE语句
- 包含重复的类型验证和转换逻辑

**示例**：

- `{Attachment} = {Date}` 生成的SQL包含80+行，多个重复的子查询

### 数组函数 (ArrayFunctions.spec.ts.snap)

#### 问题1: Formula字段作为数组函数的参数

**问题描述**：

- `ArrayCompact`, `ArrayUnique`, `ArrayFlatten` 使用formula字段时，SQL长度6,000+字符
- 虽然结果正确，但SQL复杂度很高

**分析**：

- 这些情况可能是合理的，因为formula字段可能是数组类型，需要复杂的处理
- 但值得检查是否有优化空间

## 优化优先级

### 优先级 P0（立即处理）

1. **日期函数单位参数编译期检查**

   - `DateAdd`, `DatetimeDiff`, `IsSame` 的单位参数类型检查
   - 预期效果：将16,000字符的SQL简化为~50字符的错误字面量
   - 影响：3个最严重的案例

2. **DatetimeParse 编译期类型检查**
   - 在 `coerceToString` 之前检查字段类型
   - 预期效果：将~800字符的SQL简化为错误字面量
   - 影响：多个 `DatetimeParse` 用例

### 优先级 P1（高优先级）

3. **错误路径SQL简化**

   - 对于已知会失败的类型转换，直接返回错误字面量
   - 影响：103个错误但SQL复杂的案例中的大部分

4. **Attachment字段提取优化**
   - 考虑使用CTE或简化表达式提取attachment字段值
   - 影响：BinaryOperators中多个用例

### 优先级 P2（中优先级）

5. **数值转换重复模式优化**

   - 考虑提取公共的数值转换表达式
   - 影响：NumericFunctions中多个用例

6. **类型转换比较优化**
   - 简化不同类型字段比较的SQL生成逻辑
   - 影响：BinaryOperators中类型转换比较用例

## 实施建议

### 阶段1：编译期类型检查（P0）

参考 `COMPILE_TIME_OPTIMIZATION_ANALYSIS.md` 中的建议：

1. 添加 `isUnitStringCompatibleField` 辅助函数
2. 在 `DateAdd`, `DatetimeDiff`, `IsSame` 中检查单位参数类型
3. 添加 `canFieldBeDatetimeString` 辅助函数
4. 在 `DatetimeParse` 中提前检查字段类型

### 阶段2：错误路径简化（P1）

1. 识别所有已知会失败的类型转换场景
2. 在这些场景中直接返回错误字面量，而不是生成复杂SQL
3. 确保错误消息准确

### 阶段3：SQL优化（P2）

1. 分析是否可以提取公共子查询
2. 考虑使用PostgreSQL的CTE特性
3. 评估性能影响（可能需要在真实数据上测试）

## 预期收益

### SQL长度减少

- **P0优化**：预计减少 ~25,000字符的SQL（3个最严重案例）
- **P1优化**：预计减少 ~50,000-100,000字符的SQL（103个错误案例）
- **总计**：预计减少 ~30-40% 的快照文件大小

### 性能改善

- 查询计划更简单
- 减少不必要的类型转换计算
- 减少数据库CPU使用

### 可维护性改善

- SQL更易读
- 错误处理更清晰
- 代码更易理解

## 测试建议

1. **验证优化后的SQL正确性**

   - 运行所有现有测试
   - 确保结果与优化前一致

2. **性能测试**

   - 在真实数据上测试优化前后的查询性能
   - 特别关注大数据集的性能

3. **边界情况测试**
   - 测试所有字段类型组合
   - 确保错误消息准确

## 参考文档

- `COMPILE_TIME_OPTIMIZATION_ANALYSIS.md` - 日期函数编译期优化分析
- 快照文件位于 `src/__snapshots__/`

## 统计信息

- 总快照文件大小：~55,000行
- 长SQL查询（>500字符）：153个
- 错误但SQL复杂（>100字符）：103个
- 最大SQL长度：16,240字符
- 最多重复模式：`pg_input_is_valid` 重复104次
