-- CreateTable
CREATE TABLE "waitlist" (
    "email" TEXT NOT NULL,
    "invite" BOOLEAN,
    "invite_time" TIMESTAMP(3),
    "created_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_email_key" ON "waitlist"("email");
