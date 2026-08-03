INSERT INTO "setting" ("name", "content", "created_by") VALUES
('disallowDashboard', 'true', 'anonymous')
ON CONFLICT ("name") DO UPDATE SET "content" = EXCLUDED."content";