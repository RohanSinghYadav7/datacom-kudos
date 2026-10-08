-- Prisma does not express SQLite CHECK constraints in the schema language;
-- enforce message and moderation invariants at the persistence boundary.
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
    (NEW."isVisible" = 1 AND NEW."moderatedBy" IS NULL AND NEW."moderatedAt" IS NULL AND NEW."reasonForModeration" IS NULL)
    OR
    (NEW."isVisible" = 0 AND NEW."moderatedBy" IS NOT NULL AND NEW."moderatedAt" IS NOT NULL AND NEW."reasonForModeration" IS NOT NULL AND length(trim(NEW."reasonForModeration")) BETWEEN 1 AND 500)
)
BEGIN
    SELECT RAISE(ABORT, 'Kudos moderation metadata is inconsistent.');
END;

CREATE TRIGGER "Kudos_moderation_update"
BEFORE UPDATE OF "isVisible", "moderatedBy", "moderatedAt", "reasonForModeration" ON "Kudos"
WHEN NOT (
    (NEW."isVisible" = 1 AND NEW."moderatedBy" IS NULL AND NEW."moderatedAt" IS NULL AND NEW."reasonForModeration" IS NULL)
    OR
    (NEW."isVisible" = 0 AND NEW."moderatedBy" IS NOT NULL AND NEW."moderatedAt" IS NOT NULL AND NEW."reasonForModeration" IS NOT NULL AND length(trim(NEW."reasonForModeration")) BETWEEN 1 AND 500)
)
BEGIN
    SELECT RAISE(ABORT, 'Kudos moderation metadata is inconsistent.');
END;

CREATE TRIGGER "User_role_insert"
BEFORE INSERT ON "User"
WHEN NEW."role" NOT IN ('USER', 'ADMIN')
BEGIN
    SELECT RAISE(ABORT, 'User role must be USER or ADMIN.');
END;

CREATE TRIGGER "User_role_update"
BEFORE UPDATE OF "role" ON "User"
WHEN NEW."role" NOT IN ('USER', 'ADMIN')
BEGIN
    SELECT RAISE(ABORT, 'User role must be USER or ADMIN.');
END;
