-- Additive query index only; no document or revision data is rewritten.
-- Application rollback keeps this index. It is compatible with v18 queries.
CREATE INDEX app_appointment_reminder_window ON app_documents (
  parent,
  json_extract(data, '$.client.uid'),
  json_extract(data, '$.status'),
  json_extract(data, '$.type'),
  json_extract(data, '$.startAt'),
  path
);
