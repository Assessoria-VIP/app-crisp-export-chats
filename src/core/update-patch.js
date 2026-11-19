const { normalizeConversation } = require("./normalize");

/**
 * Decides how a listed conversation should be handled against a prior
 * export's known-conversations index (see known-index.js).
 *
 * - "new": session_id is not in the index (or there is no index at all).
 * - "updated": session_id is known and has a usable last-message
 *   timestamp — fetch only the message delta after that timestamp.
 * - "full": session_id is known but has no usable timestamp baseline
 *   (e.g. the prior export recorded it with zero messages) — there is
 *   nothing to delta against, so it must be re-exported in full.
 */
function classifyConversation(conversation, knownIndex) {
  const sessionId = conversation?.session_id;

  if (!sessionId || !knownIndex || !knownIndex.has(sessionId)) {
    return { kind: "new" };
  }

  const known = knownIndex.get(sessionId);
  const sinceTimestamp = known?.lastMessageTimestamp;

  if (!Number.isFinite(sinceTimestamp)) {
    return { kind: "full" };
  }

  return { kind: "updated", sinceTimestamp };
}

/**
 * Builds the patch record written to conversations-updated.jsonl for a
 * conversation classified as "updated": conversation-level fields reuse
 * normalizeConversation's shape, but `messages` only holds the delta.
 */
function buildUpdatePatch({ conversation, meta, deltaMessages, sinceTimestamp, events }) {
  const normalized = normalizeConversation({ conversation, meta, messages: deltaMessages, events });
  const { messages, ...conversationFields } = normalized;

  return {
    session_id: conversationFields.session_id,
    since_timestamp: sinceTimestamp,
    conversation: conversationFields,
    messages,
  };
}

module.exports = {
  classifyConversation,
  buildUpdatePatch,
};
