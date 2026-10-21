CREATE INDEX app_platform_work_due ON app_documents(parent,json_extract(data,'$.status'),json_extract(data,'$.nextAttemptAt'),path);
CREATE INDEX app_platform_work_body ON app_documents(parent,json_extract(data,'$.bodyState'),json_extract(data,'$.bodyExpiresAt'),path);
