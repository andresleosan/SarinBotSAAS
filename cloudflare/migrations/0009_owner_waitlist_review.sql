-- Additive private waitlist indexes. Rollback keeps markers and tombstones.
CREATE INDEX IF NOT EXISTS app_waitlist_owner_fifo ON app_documents (
  parent,
  json_extract(data, '$.request.dateKey'),
  json_extract(data, '$.request.createdAt'),
  json_extract(data, '$.request.id'),
  path
);
CREATE INDEX IF NOT EXISTS app_waitlist_owner_review_record ON app_documents (
  parent,
  json_extract(data, '$.waitlistRecordId'),
  document_id,
  path
);
