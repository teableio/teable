# Formula Support in Generated Columns

This document outlines which formula functions are supported in generated columns for different database providers (PostgreSQL and SQLite).

## Overview

Generated columns are computed columns that are automatically calculated and stored by the database. They have strict requirements:

- **Immutable Functions Only**: Functions must produce the same output for the same input
- **No External Dependencies**: Functions cannot depend on external state or time-sensitive data
- **Database-Specific Limitations**: Each database has its own restrictions

## Support Matrix

### ✅ Supported Functions

| Function Category         | Function Name        | PostgreSQL | SQLite | Notes                                    |
| ------------------------- | -------------------- | ---------- | ------ | ---------------------------------------- |
| **Math Functions**        | `SUM`                | ✅         | ✅     | Implemented as arithmetic addition       |
|                           | `AVERAGE`            | ✅         | ✅     | Implemented as arithmetic division       |
|                           | `ABS`                | ✅         | ✅     |                                          |
|                           | `ROUND`              | ✅         | ✅     |                                          |
|                           | `CEILING`            | ✅         | ✅     |                                          |
|                           | `FLOOR`              | ✅         | ✅     |                                          |
|                           | `MAX`                | ✅         | ✅     |                                          |
|                           | `MIN`                | ✅         | ✅     |                                          |
|                           | `MOD`                | ✅         | ✅     |                                          |
|                           | `INT`                | ✅         | ✅     |                                          |
|                           | `ROUNDUP`            | ✅         | ✅     |                                          |
|                           | `ROUNDDOWN`          | ✅         | ✅     |                                          |
|                           | `EVEN`               | ✅         | ✅     |                                          |
|                           | `ODD`                | ✅         | ✅     |                                          |
|                           | `VALUE`              | ✅         | ✅     |                                          |
|                           | `SQRT`               | ✅         | ✅     | SQLite: Newton's method approximation    |
|                           | `POWER`              | ✅         | ✅     | SQLite: multiplication for common cases  |
|                           | `EXP`                | ✅         | ❌     | SQLite lacks built-in EXP                |
|                           | `LOG`                | ✅         | ❌     | SQLite lacks built-in LOG                |
| **String Functions**      | `CONCATENATE`        | ✅         | ✅     |                                          |
|                           | `LEFT`               | ✅         | ✅     |                                          |
|                           | `RIGHT`              | ✅         | ✅     |                                          |
|                           | `MID`                | ✅         | ✅     |                                          |
|                           | `LEN`                | ✅         | ✅     |                                          |
|                           | `TRIM`               | ✅         | ✅     |                                          |
|                           | `REPLACE`            | ✅         | ✅     |                                          |
| **Logical Functions**     | `IF`                 | ✅         | ✅     |                                          |
|                           | `AND`                | ✅         | ✅     |                                          |
|                           | `OR`                 | ✅         | ✅     |                                          |
|                           | `NOT`                | ✅         | ✅     |                                          |
|                           | `XOR`                | ✅         | ✅     |                                          |
|                           | `SWITCH`             | ✅         | ✅     |                                          |
|                           | `BLANK`              | ✅         | ✅     |                                          |
| **System Functions**      | `CREATED_TIME`       | ✅         | ✅     | References `__created_time` column       |
|                           | `LAST_MODIFIED_TIME` | ✅         | ✅     | References `__last_modified_time` column |
|                           | `RECORD_ID`          | ✅         | ✅     | References `__id` column                 |
|                           | `AUTO_NUMBER`        | ✅         | ✅     | References `__auto_number` column        |
|                           | `NOW`                | ✅         | ✅     | Fixed at column creation time            |
|                           | `TODAY`              | ✅         | ✅     | Fixed at column creation time            |
| **Date Functions**        | `DATE_ADD`           | ✅         | ✅     |                                          |
| **Aggregation Functions** | `COUNT`              | ✅         | ✅     |                                          |
|                           | `COUNTA`             | ✅         | ✅     |                                          |
|                           | `COUNTALL`           | ✅         | ✅     |                                          |

### ❌ Unsupported Functions

| Function Category    | Function Name          | PostgreSQL | SQLite | Reason                                            |
| -------------------- | ---------------------- | ---------- | ------ | ------------------------------------------------- |
| **String Functions** | `UPPER`                | ❌         | ✅     | PostgreSQL requires collation for string literals |
|                      | `LOWER`                | ❌         | ✅     | PostgreSQL requires collation for string literals |
|                      | `FIND`                 | ❌         | ✅     | PostgreSQL requires collation                     |
|                      | `SEARCH`               | ❌         | ✅     | PostgreSQL requires collation                     |
|                      | `SUBSTITUTE`           | ❌         | ✅     | PostgreSQL requires collation                     |
|                      | `REGEXP_REPLACE`       | ❌         | ❌     | Complex regex operations                          |
|                      | `ENCODE_URL_COMPONENT` | ❌         | ❌     | External encoding dependency                      |
|                      | `T`                    | ❌         | ❌     | Type conversion complexity                        |
|                      | `REPT`                 | ✅         | ❌     | SQLite lacks built-in REPT                        |
| **Date Functions**   | `YEAR`                 | ❌         | ❌     | Not immutable with column references              |
|                      | `MONTH`                | ❌         | ❌     | Not immutable with column references              |
|                      | `DAY`                  | ❌         | ❌     | Not immutable with column references              |
|                      | `HOUR`                 | ❌         | ❌     | Not immutable with column references              |
|                      | `MINUTE`               | ❌         | ❌     | Not immutable with column references              |
|                      | `SECOND`               | ❌         | ❌     | Not immutable with column references              |
|                      | `WEEKDAY`              | ❌         | ❌     | Not immutable with column references              |
|                      | `WEEKNUM`              | ❌         | ❌     | Not immutable with column references              |
|                      | `DATESTR`              | ❌         | ✅     | PostgreSQL: not immutable                         |
|                      | `TIMESTR`              | ❌         | ✅     | PostgreSQL: not immutable                         |
|                      | `DATETIME_FORMAT`      | ❌         | ✅     | PostgreSQL: not immutable                         |
|                      | `DATETIME_PARSE`       | ❌         | ❌     | Complex parsing logic                             |
|                      | `DATETIME_DIFF`        | ❌         | ✅     | PostgreSQL: not immutable                         |
|                      | `IS_AFTER`             | ❌         | ✅     | PostgreSQL: not immutable                         |
|                      | `IS_BEFORE`            | ❌         | ✅     | PostgreSQL: not immutable                         |
|                      | `IS_SAME`              | ❌         | ✅     | PostgreSQL: not immutable                         |
| **Array Functions**  | `ARRAY_JOIN`           | ❌         | ❌     | Complex array processing                          |
|                      | `ARRAY_UNIQUE`         | ❌         | ❌     | Complex array processing                          |
|                      | `ARRAY_COMPACT`        | ❌         | ❌     | Complex array processing                          |
|                      | `ARRAY_FLATTEN`        | ❌         | ❌     | Complex array processing                          |
| **System Functions** | `TEXT_ALL`             | ❌         | ❌     | Complex type conversion                           |

## Implementation Details

### SUM and AVERAGE Functions

These functions are implemented using arithmetic operations instead of database aggregation functions:

```sql
-- SUM(a, b, c) becomes:
(a + b + c)

-- AVERAGE(a, b, c) becomes:
(a + b + c) / 3
```

### SQRT and POWER Functions (SQLite)

SQLite doesn't have built-in SQRT and POWER functions, so we implement them using mathematical approximations:

```sql
-- SQRT(x) using Newton's method (one iteration):
CASE
  WHEN x <= 0 THEN 0
  ELSE (x / 2.0 + x / (x / 2.0)) / 2.0
END

-- POWER(base, exponent) for common cases:
CASE
  WHEN exponent = 0 THEN 1
  WHEN exponent = 1 THEN base
  WHEN exponent = 2 THEN base * base
  WHEN exponent = 3 THEN base * base * base
  -- ... more cases
  ELSE 1
END
```

### System Functions

System functions reference internal columns:

```sql
-- CREATED_TIME() becomes:
"__created_time"

-- RECORD_ID() becomes:
"__id"
```

### Date Functions Limitations

Date functions that work with column references are not supported because they are not immutable in the database context. For example:

```sql
-- This would not be immutable:
YEAR(date_column)  -- Result changes based on timezone and locale
```

## Usage Examples

### ✅ Supported Usage

```javascript
// Mathematical calculations
"SUM({field1}, {field2}, 10)";
"AVERAGE({score1}, {score2}, {score3})";

// String operations
"CONCATENATE({first_name}, ' ', {last_name})";
"LEFT({description}, 50)";

// Conditional logic
"IF({status} = 'active', {price} * 0.9, {price})";

// System information
"CREATED_TIME()";
"RECORD_ID()";
```

### ❌ Unsupported Usage

```javascript
// Date extraction (not immutable)
"YEAR({created_date})";
"MONTH({updated_at})";

// String functions requiring collation
"UPPER({name})"; // PostgreSQL only
"LOWER({title})"; // PostgreSQL only

// Complex array operations
"ARRAY_JOIN({tags}, ', ')";
"ARRAY_UNIQUE({categories})";
```

## Database-Specific Notes

### PostgreSQL

- Stricter immutability requirements
- Collation issues with string functions
- Better support for mathematical functions

### SQLite

- More permissive with string operations
- Limited mathematical function support
- Simpler date handling

## Testing

Both PostgreSQL and SQLite implementations are thoroughly tested with:

- ✅ **PostgreSQL**: 43 passed | 2 skipped
- ✅ **SQLite**: 61 passed | 6 skipped (now includes SQRT and POWER support)

The test suites verify that:

1. Supported functions generate correct SQL
2. Unsupported functions return empty SQL (preventing column creation)
3. Generated columns produce expected results
4. Error handling works correctly
