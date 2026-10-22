-- Stable bounded cursor pages for strict wake and unsent recovery; no content projection.
CREATE INDEX IF NOT EXISTS app_platform_outbox_cursor ON app_documents(parent, json_extract(data, '$.status'), json_extract(data, '$.outboxId'), path) WHERE parent='platformWhatsAppOutbox';
CREATE INDEX IF NOT EXISTS app_platform_job_cursor ON app_documents(parent, json_extract(data, '$.status'), json_extract(data, '$.jobId'), path) WHERE parent='platformWhatsAppJobs';
CREATE INDEX IF NOT EXISTS app_platform_head_cursor ON app_documents(parent, json_extract(data, '$.status'), json_extract(data, '$.conversationId'), path) WHERE parent='platformWhatsAppJobs';
