// Frozen enumeration SQL from develop before the arithmetic optimization.
// Used only as an independent differential oracle and benchmark baseline.
export const legacyWorkdaySql = `(
      SELECT CASE
        WHEN p.day_count = 0 THEN p.start_date::timestamp
        ELSE (
          SELECT c.candidate_date::timestamp
          FROM (
            SELECT
              (p.start_date + CASE WHEN p.day_count >= 0 THEN seq.n ELSE -seq.n END)::date AS candidate_date,
              seq.n
            FROM generate_series(1, ABS(p.day_count) * 7 + 366) AS seq(n)
          ) c
          WHERE EXTRACT(DOW FROM c.candidate_date)::int NOT IN (0, 6)
            AND NOT EXISTS (
              SELECT 1
              FROM (
                SELECT DISTINCT TO_DATE(LEFT(BTRIM(part), 10), 'YYYY-MM-DD') AS holiday_date
                FROM regexp_split_to_table(p.holiday_text, ',') AS part
                WHERE BTRIM(part) <> ''
                  AND BTRIM(part) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                  AND TO_CHAR(TO_DATE(LEFT(BTRIM(part), 10), 'YYYY-MM-DD'), 'YYYY-MM-DD') = LEFT(BTRIM(part), 10)
              ) holidays
              WHERE holidays.holiday_date = c.candidate_date
            )
          ORDER BY c.n
          OFFSET ABS(p.day_count) - 1
          LIMIT 1
        )
      END
      FROM (
        SELECT c.start_date AS start_date, COALESCE(c.day_count::double precision::integer, 0) AS day_count, COALESCE(c.holiday_text, '') AS holiday_text
      ) p
    )`;

export const legacyWorkdayDiffSql = `(
      WITH params AS (
        SELECT c.start_date AS start_date, c.end_date AS end_date, COALESCE(c.holiday_text, '') AS holiday_text
      ),
      holiday_parts AS (
        SELECT BTRIM(part) AS holiday_part
        FROM params p
        CROSS JOIN LATERAL regexp_split_to_table(p.holiday_text, ',') AS part
      ),
      holiday_dates AS (
        SELECT DISTINCT TO_DATE(LEFT(holiday_part, 10), 'YYYY-MM-DD') AS holiday_date
        FROM holiday_parts
        WHERE holiday_part <> ''
          AND holiday_part ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          AND TO_CHAR(TO_DATE(LEFT(holiday_part, 10), 'YYYY-MM-DD'), 'YYYY-MM-DD') = LEFT(holiday_part, 10)
      ),
      bounds AS (
        SELECT
          LEAST(p.start_date, p.end_date) AS min_date,
          GREATEST(p.start_date, p.end_date) AS max_date,
          CASE WHEN p.end_date >= p.start_date THEN 1 ELSE -1 END AS direction
        FROM params p
      ),
      candidates AS (
        SELECT d::date AS candidate_date
        FROM bounds b
        CROSS JOIN LATERAL generate_series(b.min_date + 1, b.max_date, INTERVAL '1 day') AS d
      ),
      workdays AS (
        SELECT c.candidate_date
        FROM candidates c
        LEFT JOIN holiday_dates h ON h.holiday_date = c.candidate_date
        WHERE EXTRACT(DOW FROM c.candidate_date)::int NOT IN (0, 6)
          AND h.holiday_date IS NULL
      )
      SELECT (b.direction * (SELECT COUNT(*) FROM workdays))::integer
      FROM bounds b
    )`;
