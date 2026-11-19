const fs = require("node:fs");
const readline = require("node:readline");

function maxMessageTimestamp(messages) {
  const timestamps = (Array.isArray(messages) ? messages : [])
    .map((message) => message?.timestamp)
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return null;
  }

  return Math.max(...timestamps);
}

async function buildKnownIndex(jsonlPath) {
  const index = new Map();

  const stream = fs.createReadStream(jsonlPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      process.stderr.write(`known-index: skipping corrupted line (${error.message})\n`);
      continue;
    }

    const sessionId = record?.session_id;
    if (!sessionId) {
      continue;
    }

    const lastMessageTimestamp = maxMessageTimestamp(record.messages);
    const existing = index.get(sessionId);

    if (!existing || (lastMessageTimestamp ?? -Infinity) > (existing.lastMessageTimestamp ?? -Infinity)) {
      index.set(sessionId, { lastMessageTimestamp });
    }
  }

  return index;
}

module.exports = {
  buildKnownIndex,
};
