-- Additive private history index; no documents or revisions are rewritten.
-- Application rollback retains the index and all attendance event receipts.
CREATE INDEX IF NOT EXISTS app_attendance_history ON app_documents (
  parent,
  json_extract(data, '$.appointmentId'),
  json_extract(data, '$.sequence') DESC,
  path
);
