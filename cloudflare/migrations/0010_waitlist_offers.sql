-- Additive private offers indexes. Expiry never deletes offers or booking proof.
CREATE INDEX IF NOT EXISTS app_waitlist_offers_date ON app_documents (
  parent,
  json_extract(data, '$.dateKey'),
  json_extract(data, '$.createdAt') DESC,
  json_extract(data, '$.id') ASC,
  path
);
CREATE INDEX IF NOT EXISTS app_waitlist_offers_state ON app_documents (
  parent,
  json_extract(data, '$.dateKey'),
  json_extract(data, '$.state'),
  json_extract(data, '$.createdAt') DESC,
  json_extract(data, '$.id') ASC,
  path
);
