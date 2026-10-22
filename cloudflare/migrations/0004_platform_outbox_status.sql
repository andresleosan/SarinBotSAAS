-- Bounded prepared/claimed continuation, ordered by the exact document path.
CREATE INDEX app_platform_outbox_status ON app_documents(parent,json_extract(data,'$.status'),path);
