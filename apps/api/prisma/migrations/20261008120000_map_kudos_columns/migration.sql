-- Rename the fields to the approved database-facing names without rebuilding
-- the table, so kudos data and foreign keys remain intact.
DROP TRIGGER "Kudos_message_insert";
DROP TRIGGER "Kudos_message_update";
DROP TRIGGER "Kudos_moderation_insert";
DROP TRIGGER "Kudos_moderation_update";

DROP INDEX "Kudos_isVisible_createdAt_id_idx";
DROP INDEX "Kudos_recipientUserId_createdAt_idx";
DROP INDEX "Kudos_senderUserId_createdAt_idx";

ALTER TABLE "Kudos" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "Kudos" RENAME COLUMN "isVisible" TO "is_visible";
ALTER TABLE "Kudos" RENAME COLUMN "moderatedBy" TO "moderated_by";
ALTER TABLE "Kudos" RENAME COLUMN "moderatedAt" TO "moderated_at";
ALTER TABLE "Kudos" RENAME COLUMN "reasonForModeration" TO "reason_for_moderation";

CREATE INDEX "Kudos_is_visible_created_at_id_idx" ON "Kudos"("is_visible", "created_at" DESC, "id" DESC);
CREATE INDEX "Kudos_recipientUserId_created_at_idx" ON "Kudos"("recipientUserId", "created_at" DESC);
CREATE INDEX "Kudos_senderUserId_created_at_idx" ON "Kudos"("senderUserId", "created_at" DESC);

CREATE TRIGGER "Kudos_message_insert"
BEFORE INSERT ON "Kudos"
WHEN length(trim(NEW."message")) < 1 OR length(NEW."message") > 500
BEGIN
    SELECT RAISE(ABORT, 'Kudos message must contain 1 to 500 Unicode code points.');
END;

CREATE TRIGGER "Kudos_message_update"
BEFORE UPDATE OF "message" ON "Kudos"
WHEN length(trim(NEW."message")) < 1 OR length(NEW."message") > 500
BEGIN
    SELECT RAISE(ABORT, 'Kudos message must contain 1 to 500 Unicode code points.');
END;

CREATE TRIGGER "Kudos_moderation_insert"
BEFORE INSERT ON "Kudos"
WHEN NOT (
    (NEW."is_visible" = 1 AND NEW."moderated_by" IS NULL AND NEW."moderated_at" IS NULL AND NEW."reason_for_moderation" IS NULL)
    OR
    (NEW."is_visible" = 0 AND NEW."moderated_by" IS NOT NULL AND NEW."moderated_at" IS NOT NULL AND NEW."reason_for_moderation" IS NOT NULL AND length(trim(NEW."reason_for_moderation")) BETWEEN 1 AND 500)
)
BEGIN
    SELECT RAISE(ABORT, 'Kudos moderation metadata is inconsistent.');
END;

CREATE TRIGGER "Kudos_moderation_update"
BEFORE UPDATE OF "is_visible", "moderated_by", "moderated_at", "reason_for_moderation" ON "Kudos"
WHEN NOT (
    (NEW."is_visible" = 1 AND NEW."moderated_by" IS NULL AND NEW."moderated_at" IS NULL AND NEW."reason_for_moderation" IS NULL)
    OR
    (NEW."is_visible" = 0 AND NEW."moderated_by" IS NOT NULL AND NEW."moderated_at" IS NOT NULL AND NEW."reason_for_moderation" IS NOT NULL AND length(trim(NEW."reason_for_moderation")) BETWEEN 1 AND 500)
)
BEGIN
    SELECT RAISE(ABORT, 'Kudos moderation metadata is inconsistent.');
END;
