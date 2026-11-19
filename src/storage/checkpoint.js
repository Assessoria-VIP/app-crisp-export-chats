const fs = require("node:fs");

function emptyCheckpoint(websiteId, window = {}) {
  return {
    website_id: websiteId,
    last_completed_page: 0,
    in_progress_page: 1,
    exported_session_ids: [],
    updated_session_ids: [],
    errors: [],
    quota_errors: 0,
    conversation_count: 0,
    message_count: 0,
    updated_conversation_count: 0,
    updated_message_count: 0,
    days: window.days ?? null,
    date_start: window.dateStart ?? null,
    date_end: window.dateEnd ?? null,
    order: "created_at_asc",
    updated_at: new Date().toISOString(),
  };
}

function loadCheckpoint(filePath, websiteId) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);

  if (data.website_id && data.website_id !== websiteId) {
    throw new Error(
      `Checkpoint website_id ${data.website_id} does not match CRISP_WEBSITE_ID`
    );
  }

  return {
    ...emptyCheckpoint(websiteId),
    ...data,
    exported_session_ids: Array.isArray(data.exported_session_ids)
      ? data.exported_session_ids
      : [],
    updated_session_ids: Array.isArray(data.updated_session_ids)
      ? data.updated_session_ids
      : [],
    errors: Array.isArray(data.errors) ? data.errors : [],
  };
}

function applyCheckpointWindow(options, checkpoint) {
  if (checkpoint.date_start || checkpoint.date_end || checkpoint.days != null) {
    if (options.days != null && checkpoint.days != null && options.days !== checkpoint.days) {
      throw new Error(
        `Checkpoint --days ${checkpoint.days} does not match --days ${options.days}`
      );
    }

    options.days = checkpoint.days ?? options.days;
    options.dateStart = checkpoint.date_start || options.dateStart;
    options.dateEnd = checkpoint.date_end || options.dateEnd;
    options.oldestFirst = true;
  }

  return options;
}

function saveCheckpoint(filePath, checkpoint) {
  const payload = {
    ...checkpoint,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

module.exports = {
  emptyCheckpoint,
  loadCheckpoint,
  applyCheckpointWindow,
  saveCheckpoint,
};
