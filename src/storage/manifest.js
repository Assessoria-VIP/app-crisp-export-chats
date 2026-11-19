const fs = require("node:fs");

function writeManifest(filePath, checkpoint, extra = {}) {
  const payload = {
    website_id: checkpoint.website_id,
    exported_at: new Date().toISOString(),
    conversation_count: checkpoint.conversation_count,
    message_count: checkpoint.message_count,
    updated_conversation_count: checkpoint.updated_conversation_count || 0,
    updated_message_count: checkpoint.updated_message_count || 0,
    last_completed_page: checkpoint.last_completed_page,
    quota_errors: checkpoint.quota_errors,
    error_count: checkpoint.errors.length,
    errors: checkpoint.errors.slice(-50),
    ...extra,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

module.exports = {
  writeManifest,
};
