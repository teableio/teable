-- ============================================
-- 按空间ID诊断和修复 view column_meta
-- 使用方法：替换 :spaceId 为实际的 space id
-- ============================================

-- ========== 步骤 1: 查看指定空间下的所有 table 和 view ==========

SELECT
    s.id as space_id,
    s.name as space_name,
    b.id as base_id,
    b.name as base_name,
    tm.id as table_id,
    tm.name as table_name,
    v.id as view_id,
    v.name as view_name,
    v.type as view_type,
    meta_key as field_id,
    f.name as field_name,
    (v.column_meta::jsonb->>meta_key)::jsonb->>'order' as field_order
FROM space s
JOIN base b ON b.space_id = s.id
JOIN table_meta tm ON tm.base_id = b.id
JOIN view v ON v.table_id = tm.id
LEFT JOIN LATERAL jsonb_object_keys(v.column_meta::jsonb) as meta_key on true
LEFT JOIN field f ON f.id = meta_key AND f.table_id = tm.id AND f.deleted_time IS NULL
WHERE s.id = 'YOUR_SPACE_ID_HERE'  -- <<< 替换为空间ID
  AND s.deleted_time IS NULL
  AND b.deleted_time IS NULL
  AND tm.deleted_time IS NULL
  AND v.deleted_time IS NULL
ORDER BY s.id, b.id, tm.id, v.id, (v.column_meta::jsonb -> meta_key ->> 'order')::float;

-- ========== 步骤 2: 统计每个 view 的字段完整性 ==========

WITH table_field_count AS (
    SELECT
        tm.id as table_id,
        COUNT(*) as total_fields
    FROM table_meta tm
    JOIN field f ON f.table_id = tm.id
    WHERE tm.base_id IN (
        SELECT id FROM base WHERE space_id = 'YOUR_SPACE_ID_HERE' AND deleted_time IS NULL
    )
      AND f.deleted_time IS NULL
    GROUP BY tm.id
),
view_meta_count AS (
    SELECT
        v.table_id,
        v.id as view_id,
        v.name as view_name,
        COUNT(DISTINCT key) as meta_field_count
    FROM view v
    LEFT JOIN LATERAL jsonb_object_keys(v.column_meta::jsonb) as key on true
    WHERE v.table_id IN (
        SELECT id FROM table_meta WHERE base_id IN (
            SELECT id FROM base WHERE space_id = 'YOUR_SPACE_ID_HERE' AND deleted_time IS NULL
        )
    )
      AND v.deleted_time IS NULL
    GROUP BY v.table_id, v.id, v.name
)
SELECT
    tfc.table_id,
    tm.name as table_name,
    vmc.view_id,
    vmc.view_name,
    vmc.meta_field_count,
    tfc.total_fields,
    CASE
        WHEN vmc.meta_field_count < tfc.total_fields THEN 'INCOMPLETE'
        ELSE 'COMPLETE'
    END as status,
    (tfc.total_fields - vmc.meta_field_count) as missing_count
FROM table_field_count tfc
JOIN table_meta tm ON tm.id = tfc.table_id
JOIN view_meta_count vmc ON vmc.table_id = tfc.table_id
ORDER BY tfc.table_id, vmc.view_id;

-- ========== 步骤 3: 找出每个 view 具体缺少哪些字段 ==========

WITH space_tables AS (
    SELECT tm.id as table_id
    FROM space s
    JOIN base b ON b.space_id = s.id
    JOIN table_meta tm ON tm.base_id = b.id
    WHERE s.id = 'YOUR_SPACE_ID_HERE'  -- <<< 替换为空间ID
      AND s.deleted_time IS NULL
      AND b.deleted_time IS NULL
      AND tm.deleted_time IS NULL
),
view_missing_fields AS (
    -- 缺少的字段（column_meta中没有，但table中存在）
    SELECT
        v.id as view_id,
        v.name as view_name,
        v.table_id,
        tm.name as table_name,
        f.id as missing_field_id,
        f.name as missing_field_name,
        f.order as field_order_in_table,
        'MISSING' as issue_type
    FROM view v
    JOIN space_tables st ON v.table_id = st.table_id
    JOIN table_meta tm ON tm.id = v.table_id
    JOIN field f ON f.table_id = v.table_id
    WHERE v.deleted_time IS NULL
      AND f.deleted_time IS NULL
      AND NOT EXISTS (
          SELECT 1
          FROM jsonb_object_keys(v.column_meta::jsonb) as meta_key
          WHERE meta_key = f.id
      )
),
view_extra_fields AS (
    -- 多余的字段（column_meta中有，但table中已不存在）
    SELECT
        v.id as view_id,
        v.name as view_name,
        v.table_id,
        tm.name as table_name,
        meta_key as extra_field_id,
        (v.column_meta::jsonb->>meta_key)::jsonb->>'order' as extra_field_order,
        'EXTRA' as issue_type
    FROM view v
    JOIN space_tables st ON v.table_id = st.table_id
    JOIN table_meta tm ON tm.id = v.table_id
    LEFT JOIN LATERAL jsonb_object_keys(v.column_meta::jsonb) as meta_key on true
    WHERE v.deleted_time IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM field f
          WHERE f.table_id = v.table_id
            AND f.id = meta_key
            AND f.deleted_time IS NULL
      )
)
SELECT * FROM view_missing_fields
UNION ALL
SELECT * FROM view_extra_fields
ORDER BY table_id, view_id, field_order_in_table, extra_field_order;

-- 方法 A: 为缺失字段添加 order（按字段在表中的顺序分配）
WITH space_tables AS (
    SELECT tm.id as table_id
    FROM space s
    JOIN base b ON b.space_id = s.id
    JOIN table_meta tm ON tm.base_id = b.id
    WHERE s.id = 'YOUR_SPACE_ID_HERE'  -- <<< 替换为空间ID
      AND s.deleted_time IS NULL
      AND b.deleted_time IS NULL
      AND tm.deleted_time IS NULL
),
view_max_order AS (
    SELECT
        v.id as view_id,
        COALESCE(MAX((cm->>'order')::float), -1) as max_order
    FROM view v
    LEFT JOIN LATERAL jsonb_each(v.column_meta::jsonb) as t(key, cm) on true
    WHERE v.deleted_time IS NULL
      AND v.table_id IN (SELECT table_id FROM space_tables)
    GROUP BY v.id
)
SELECT
    'UPDATE view SET column_meta = jsonb_set(column_meta, ''{' || f.id || '}'', ''{"order": ' ||
    (ROW_NUMBER() OVER (PARTITION BY v.id ORDER BY f.order) + vmo.max_order)::text || '}'', true)
    WHERE id = ''' || v.id || ''';' as repair_sql
FROM view v
JOIN space_tables st ON v.table_id = st.table_id
JOIN view_max_order vmo ON vmo.view_id = v.id
JOIN field f ON f.table_id = v.table_id
WHERE v.deleted_time IS NULL
  AND f.deleted_time IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM jsonb_object_keys(v.column_meta::jsonb) as meta_key
      WHERE meta_key = f.id
  )
ORDER BY v.id, f.order;

-- ========== 步骤 5: 一键修复脚本（整个空间）==========

-- 开始修复
BEGIN;

-- 创建临时表记录要修复的 view
CREATE TEMPORARY TABLE views_to_fix AS
SELECT DISTINCT v.id as view_id
FROM view v
JOIN (
    SELECT tm.id as table_id
    FROM space s
    JOIN base b ON b.space_id = s.id
    JOIN table_meta tm ON tm.base_id = b.id
    WHERE s.id = 'YOUR_SPACE_ID_HERE'  -- <<< 替换为空间ID
      AND s.deleted_time IS NULL
      AND b.deleted_time IS NULL
      AND tm.deleted_time IS NULL
) as space_tables ON v.table_id = space_tables.table_id
WHERE v.deleted_time IS NULL;

-- 备份（可选）
CREATE TABLE view_backup_space_YOUR_SPACE_ID AS
SELECT v.*
FROM view v
WHERE v.id IN (SELECT view_id FROM views_to_fix);

-- ========== 修复A: 为每个 view 补充缺失的 field column_meta ==========
WITH view_max_order AS (
    SELECT
        v.id as view_id,
        COALESCE(MAX((cm->>'order')::float), -1) as max_order
    FROM view v
    LEFT JOIN LATERAL jsonb_each(v.column_meta::jsonb) as t(key, cm) on true
    WHERE v.deleted_time IS NULL
      AND v.table_id IN (SELECT table_id FROM views_to_fix)
    GROUP BY v.id
),
fix_add AS (
    SELECT
        v.id as view_id,
        f.id as field_id,
        ROW_NUMBER() OVER (PARTITION BY v.id ORDER BY f.order) + vmo.max_order as new_order
    FROM view v
    JOIN views_to_fix vf ON v.id = vf.view_id
    JOIN view_max_order vmo ON vmo.view_id = v.id
    JOIN field f ON f.table_id = v.table_id
    WHERE v.deleted_time IS NULL
      AND f.deleted_time IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM jsonb_object_keys(v.column_meta::jsonb) as meta_key
          WHERE meta_key = f.id
      )
)
UPDATE view v
SET column_meta = jsonb_set(
    v.column_meta::jsonb,
    ARRAY[fa.field_id],
    jsonb_build_object('order', fa.new_order)
)::text
FROM fix_add fa
WHERE v.id = fa.view_id
  AND fa.field_id NOT IN (
      SELECT k FROM jsonb_object_keys(v.column_meta::jsonb) as k
  );

-- ========== 修复B: 删除每个 view 中多余的 field column_meta ==========
WITH fix_remove AS (
    SELECT
        v.id as view_id,
        meta_key as extra_field_id
    FROM view v
    JOIN views_to_fix vf ON v.id = vf.view_id
    LEFT JOIN LATERAL jsonb_object_keys(v.column_meta::jsonb) as meta_key on true
    WHERE v.deleted_time IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM field f
          WHERE f.table_id = v.table_id
            AND f.id = meta_key
            AND f.deleted_time IS NULL
      )
)
UPDATE view v
SET column_meta = CAST(
    (
        SELECT jsonb_object_agg(t.key, t.value)
        FROM jsonb_each(CAST(v.column_meta AS jsonb)) as t(key, value)
        WHERE t.key NOT IN (
            SELECT extra_field_id FROM fix_remove fr WHERE fr.view_id = v.id
        )
    ) AS text
)
FROM fix_remove fr
WHERE v.id = fr.view_id;

-- 验证修复结果
SELECT
    v.id as view_id,
    v.name as view_name,
    COUNT(DISTINCT key) as meta_field_count,
    (SELECT COUNT(*) FROM field f WHERE f.table_id = v.table_id AND f.deleted_time IS NULL) as table_field_count,
    CASE
        WHEN COUNT(DISTINCT key) <
             (SELECT COUNT(*) FROM field f WHERE f.table_id = v.table_id AND f.deleted_time IS NULL)
        THEN 'STILL_MISSING'
        WHEN COUNT(DISTINCT key) >
             (SELECT COUNT(*) FROM field f WHERE f.table_id = v.table_id AND f.deleted_time IS NULL)
        THEN 'STILL_EXTRA'
        ELSE 'FIXED'
    END as status
FROM view v
JOIN views_to_fix vf ON v.id = vf.view_id
LEFT JOIN LATERAL jsonb_object_keys(v.column_meta::jsonb) as key on true
WHERE v.deleted_time IS NULL
GROUP BY v.id, v.name, v.table_id
ORDER BY v.id;

DROP TABLE views_to_fix;

COMMIT;

-- ========== 步骤 6: 查看修复后该空间所有 view 的详情 ==========

SELECT
    v.id as view_id,
    v.name as view_name,
    v.table_id,
    t.name as table_name,
    meta_key as field_id,
    f.name as field_name,
    (v.column_meta::jsonb->>meta_key)::jsonb->>'order' as field_order
FROM view v
JOIN table_meta t ON v.table_id = t.id
JOIN LATERAL jsonb_object_keys(v.column_meta::jsonb) as meta_key on true
JOIN field f ON f.id = meta_key AND f.table_id = v.table_id
WHERE v.table_id IN (SELECT table_id FROM space_tables)
  AND v.deleted_time IS NULL
ORDER BY v.id, (v.column_meta::jsonb -> meta_key ->> 'order')::float;
