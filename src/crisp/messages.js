const { withRetry } = require("./client");

const MESSAGE_BATCH_CAP = 1000;

function oldestTimestamp(messages) {
  const timestamps = messages
    .map((message) => message.timestamp)
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return null;
  }

  return Math.min(...timestamps);
}

function newestTimestamp(messages) {
  const timestamps = messages
    .map((message) => message.timestamp)
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return null;
  }

  return Math.max(...timestamps);
}

/**
 * Fetches messages added to a conversation strictly after `sinceTimestamp`,
 * paginating forward with timestamp_after. Mirrors fetchAllMessages'
 * backward-pagination shape (crisp-api getMessagesInConversation signature:
 * (websiteID, sessionID, timestampBefore, timestampAfter, timestampAround)).
 */
async function fetchMessageDelta(client, websiteId, sessionId, sinceTimestamp, retryOpts) {
  if (!Number.isFinite(sinceTimestamp)) {
    throw new Error("fetchMessageDelta requires a finite sinceTimestamp");
  }

  const collected = [];
  const seen = new Set();
  let timestampAfter = sinceTimestamp;

  for (let batchIndex = 0; batchIndex < MESSAGE_BATCH_CAP; batchIndex += 1) {
    const batch = await withRetry(
      () =>
        client.website.getMessagesInConversation(
          websiteId,
          sessionId,
          undefined,
          timestampAfter
        ),
      retryOpts
    );

    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }

    let added = 0;

    for (const message of batch) {
      const id =
        message.fingerprint != null
          ? `fp:${message.fingerprint}`
          : `ts:${message.timestamp}:${message.from}:${message.type}`;

      if (seen.has(id)) {
        continue;
      }

      seen.add(id);
      collected.push(message);
      added += 1;
    }

    const newest = newestTimestamp(batch);

    if (added === 0 || newest == null || newest === timestampAfter) {
      break;
    }

    timestampAfter = newest;
  }

  return collected
    .filter((message) => message.timestamp > sinceTimestamp)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

/**
 * Fetches the full message history of a conversation, paginating backward
 * with timestamp_before, oldest first.
 */
async function fetchAllMessages(client, websiteId, sessionId, retryOpts) {
  const collected = [];
  const seen = new Set();
  let timestampBefore;

  for (let batchIndex = 0; batchIndex < MESSAGE_BATCH_CAP; batchIndex += 1) {
    const batch = await withRetry(
      () =>
        client.website.getMessagesInConversation(
          websiteId,
          sessionId,
          timestampBefore
        ),
      retryOpts
    );

    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }

    let added = 0;

    for (const message of batch) {
      const id =
        message.fingerprint != null
          ? `fp:${message.fingerprint}`
          : `ts:${message.timestamp}:${message.from}:${message.type}`;

      if (seen.has(id)) {
        continue;
      }

      seen.add(id);
      collected.push(message);
      added += 1;
    }

    const oldest = oldestTimestamp(batch);

    if (added === 0 || oldest == null || oldest === timestampBefore) {
      break;
    }

    timestampBefore = oldest;
  }

  collected.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return collected;
}

async function countMessageBatches(client, websiteId, sessionId, retryOpts) {
  let batches = 0;
  let messages = 0;
  const seen = new Set();
  let timestampBefore;

  for (let batchIndex = 0; batchIndex < MESSAGE_BATCH_CAP; batchIndex += 1) {
    const batch = await withRetry(
      () =>
        client.website.getMessagesInConversation(
          websiteId,
          sessionId,
          timestampBefore
        ),
      retryOpts
    );

    batches += 1;

    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }

    let added = 0;

    for (const message of batch) {
      const id =
        message.fingerprint != null
          ? `fp:${message.fingerprint}`
          : `ts:${message.timestamp}:${message.from}:${message.type}`;

      if (seen.has(id)) {
        continue;
      }

      seen.add(id);
      messages += 1;
      added += 1;
    }

    const oldest = oldestTimestamp(batch);

    if (added === 0 || oldest == null || oldest === timestampBefore) {
      break;
    }

    timestampBefore = oldest;
  }

  return { batches, messages };
}

module.exports = {
  MESSAGE_BATCH_CAP,
  fetchAllMessages,
  fetchMessageDelta,
  countMessageBatches,
};
