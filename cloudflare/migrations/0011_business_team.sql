-- Additive private team indexes. Rollback retains memberships, state and events.
CREATE INDEX IF NOT EXISTS app_team_member ON app_documents (
  parent, json_extract(data, '$.memberUid'), json_extract(data, '$.businessId'), path
);
CREATE INDEX IF NOT EXISTS app_team_business_status ON app_documents (
  parent, json_extract(data, '$.businessId'), json_extract(data, '$.status'), path
);
CREATE INDEX IF NOT EXISTS app_team_events_sequence ON app_documents (
  parent, json_extract(data, '$.sequence') DESC, path
);
