/*
  Warnings:

  - You are about to drop the `automation_workflow` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `automation_workflow_action` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `automation_workflow_execution_history` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `automation_workflow_trigger` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "automation_workflow";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "automation_workflow_action";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "automation_workflow_execution_history";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "automation_workflow_trigger";
PRAGMA foreign_keys=on;
