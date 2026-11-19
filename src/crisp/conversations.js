const { withRetry } = require("./client");

const EVENT_PAGE_CAP = 100;
const PAGE_SIZE = 50;

function listOptions({ includeEmpty, dateStart, dateEnd }) {
  const options = { per_page: PAGE_SIZE };

  if (includeEmpty) {
    options.include_empty = 1;
  }

  if (dateStart) {
    options.filter_date_start = dateStart;
  }

  if (dateEnd) {
    options.filter_date_end = dateEnd;
  }

  return options;
}

async function listPage(client, websiteId, page, options, retryOpts) {
  try {
    const data = await withRetry(
      () => client.website.listConversations(websiteId, page, options),
      retryOpts
    );

    if (!Array.isArray(data)) {
      return [];
    }

    return data;
  } catch (error) {
    if (error?.code === 404) {
      return [];
    }

    throw error;
  }
}

async function listAllConversations(client, websiteId, query, retryOpts) {
  const conversations = [];
  const seen = new Set();

  for (let page = 1; ; page += 1) {
    const batch = await listPage(client, websiteId, page, query, retryOpts);

    if (batch.length === 0) {
      break;
    }

    for (const conversation of batch) {
      const sessionId = conversation?.session_id;
      if (!sessionId || seen.has(sessionId)) {
        continue;
      }

      seen.add(sessionId);
      conversations.push(conversation);
    }

    if (batch.length < PAGE_SIZE) {
      break;
    }
  }

  return conversations;
}

async function fetchConversationMeta(client, websiteId, sessionId, fallbackMeta, retryOpts) {
  try {
    return await withRetry(
      () => client.website.getConversationMetas(websiteId, sessionId),
      retryOpts
    );
  } catch (error) {
    if (error?.code === 404) {
      return fallbackMeta;
    }

    throw error;
  }
}

async function fetchAllEvents(client, websiteId, sessionId, retryOpts) {
  const events = [];

  for (let page = 1; page <= EVENT_PAGE_CAP; page += 1) {
    const batch = await withRetry(
      () => client.website.listConversationEvents(websiteId, sessionId, page),
      retryOpts
    );

    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }

    events.push(...batch);

    if (batch.length < 20) {
      break;
    }
  }

  return events;
}

module.exports = {
  fetchConversationMeta,
  fetchAllEvents,
  PAGE_SIZE,
  listOptions,
  listPage,
  listAllConversations,
};
