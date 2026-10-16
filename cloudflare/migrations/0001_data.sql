-- Additive only. Roll back application traffic, not these tables, during acceptance.
-- If D1 received writes, export/reconcile them before switching to Firestore.
CREATE TABLE app_revision (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL CHECK (revision >= 0));
INSERT INTO app_revision (id, revision) VALUES (1, 0);
CREATE TRIGGER app_revision_cas BEFORE UPDATE OF revision ON app_revision
WHEN NEW.revision != OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'SARIN_REVISION_CONFLICT');
END;
CREATE TABLE app_documents (
  path TEXT PRIMARY KEY,
  parent TEXT NOT NULL,
  document_id TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data) AND json_type(data) = 'object'),
  updated_at INTEGER NOT NULL,
  blob TEXT CHECK (blob IS NULL OR json_valid(blob))
);
-- UUID replay records are retained for 24 hours by successful commit batches.
CREATE TABLE app_commits (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, revision INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX app_commits_created ON app_commits(created_at);
CREATE TRIGGER app_commit_guard BEFORE INSERT ON app_commits
BEGIN
  SELECT CASE
    WHEN (SELECT revision FROM app_revision WHERE id=1) IS NULL THEN RAISE(ABORT, 'SARIN_REVISION_MISSING')
    WHEN NEW.revision != (SELECT revision FROM app_revision WHERE id=1) + 1 THEN RAISE(ABORT, 'SARIN_REVISION_CONFLICT')
  END;
END;
CREATE INDEX app_parent ON app_documents(parent, path);
CREATE INDEX app_owner ON app_documents(parent, json_extract(data, '$.ownerUid'));
CREATE INDEX app_client ON app_documents(parent, json_extract(data, '$.client.uid'));
CREATE INDEX app_appointments ON app_documents(parent, json_extract(data, '$.dateKey'), json_extract(data, '$.resourceId'), json_extract(data, '$.status'));
CREATE INDEX app_created ON app_documents(parent, json_extract(data, '$.createdAt'));
CREATE INDEX app_submitted ON app_documents(parent, json_extract(data, '$.submittedAt'));
CREATE INDEX app_owner_submitted ON app_documents(parent, json_extract(data, '$.ownerUid'), json_extract(data, '$.submittedAt'));
CREATE INDEX app_starts ON app_documents(parent, json_extract(data, '$.startsAt'));
CREATE INDEX app_next_attempt ON app_documents(parent, json_extract(data, '$.nextAttemptAt'));
CREATE INDEX app_body_expiry ON app_documents(parent, json_extract(data, '$.bodyExpiresAt'));
CREATE INDEX app_expiry ON app_documents(parent, json_extract(data, '$.expiresAt'));
