CREATE INDEX IF NOT EXISTS app_support_messages_sequence ON app_documents(parent,json_extract(data,'$.conversationId'),json_extract(data,'$.sequence'),path);
CREATE INDEX IF NOT EXISTS app_support_record_id ON app_documents(parent,json_extract(data,'$.recordType'),json_extract(data,'$.id'),path);
CREATE INDEX IF NOT EXISTS app_support_owner_record_id ON app_documents(parent,json_extract(data,'$.ownerUid'),json_extract(data,'$.recordType'),json_extract(data,'$.id'),path);
