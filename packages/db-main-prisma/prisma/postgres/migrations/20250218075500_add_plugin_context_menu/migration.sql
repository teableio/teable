-- CreateTable
CREATE TABLE "plugin_context_menu" (
    "table_id" TEXT NOT NULL,
    "plugin_install_id" TEXT NOT NULL,
    "order" DOUBLE PRECISION NOT NULL,
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,
    "last_modified_time" TIMESTAMP(3),
    "last_modified_by" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "plugin_context_menu_plugin_install_id_key" ON "plugin_context_menu"("plugin_install_id");

-- AddForeignKey
ALTER TABLE "plugin_panel" ADD CONSTRAINT "plugin_panel_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "table_meta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugin_context_menu" ADD CONSTRAINT "plugin_context_menu_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "table_meta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
