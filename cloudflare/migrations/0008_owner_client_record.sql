-- Additive owner-only account reservation indexes; no documents are rewritten.
-- Application rollback retains these indexes and all appointment data.
CREATE INDEX IF NOT EXISTS app_client_record_all ON app_documents (
  parent,
  json_extract(data, '$.client.uid'),
  json_extract(data, '$.type'),
  json_extract(data, '$.startAt') DESC,
  json_extract(data, '$.id') ASC,
  path
);

CREATE INDEX IF NOT EXISTS app_client_record_status ON app_documents (
  parent,
  json_extract(data, '$.client.uid'),
  json_extract(data, '$.type'),
  json_extract(data, '$.status'),
  json_extract(data, '$.startAt') DESC,
  json_extract(data, '$.id') ASC,
  path
);
