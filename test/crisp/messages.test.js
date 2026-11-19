const test = require("node:test");
const assert = require("node:assert/strict");

const { fetchMessageDelta, MESSAGE_BATCH_CAP } = require("../../src/crisp/messages");

function stubClient(handler) {
  return {
    website: {
      getMessagesInConversation: (websiteId, sessionId, timestampBefore, timestampAfter) =>
        Promise.resolve(handler(timestampAfter)),
    },
  };
}

test("paginates forward across multiple batches until empty", async () => {
  const calls = [];
  const client = stubClient((timestampAfter) => {
    calls.push(timestampAfter);
    if (timestampAfter === 100) {
      return [
        { fingerprint: 1, timestamp: 150, from: "user", type: "text" },
        { fingerprint: 2, timestamp: 160, from: "user", type: "text" },
      ];
    }
    if (timestampAfter === 160) {
      return [{ fingerprint: 3, timestamp: 180, from: "operator", type: "text" }];
    }
    return [];
  });

  const messages = await fetchMessageDelta(client, "site", "session_a", 100);

  assert.deepEqual(
    messages.map((message) => message.fingerprint),
    [1, 2, 3]
  );
  assert.deepEqual(calls, [100, 160, 180]);
});

test("stops immediately when the first batch is empty", async () => {
  const client = stubClient(() => []);

  const messages = await fetchMessageDelta(client, "site", "session_a", 100);

  assert.deepEqual(messages, []);
});

test("stops when the cursor stops advancing, avoiding an infinite loop", async () => {
  const client = stubClient((timestampAfter) => [
    { fingerprint: 1, timestamp: timestampAfter, from: "user", type: "text" },
  ]);

  const messages = await fetchMessageDelta(client, "site", "session_a", 100);

  assert.deepEqual(messages, []);
});

test("dedupes a message repeated across overlapping batches", async () => {
  const client = stubClient((timestampAfter) => {
    if (timestampAfter === 100) {
      return [
        { fingerprint: 1, timestamp: 150, from: "user", type: "text" },
        { fingerprint: 2, timestamp: 160, from: "user", type: "text" },
      ];
    }
    if (timestampAfter === 160) {
      return [
        { fingerprint: 2, timestamp: 160, from: "user", type: "text" },
        { fingerprint: 3, timestamp: 170, from: "operator", type: "text" },
      ];
    }
    return [];
  });

  const messages = await fetchMessageDelta(client, "site", "session_a", 100);

  assert.deepEqual(
    messages.map((message) => message.fingerprint),
    [1, 2, 3]
  );
});

test("filters out the boundary message at sinceTimestamp itself", async () => {
  const client = stubClient((timestampAfter) => {
    if (timestampAfter === 100) {
      return [
        { fingerprint: 1, timestamp: 100, from: "user", type: "text" },
        { fingerprint: 2, timestamp: 150, from: "user", type: "text" },
      ];
    }
    return [];
  });

  const messages = await fetchMessageDelta(client, "site", "session_a", 100);

  assert.deepEqual(
    messages.map((message) => message.fingerprint),
    [2]
  );
});

test("respects MESSAGE_BATCH_CAP instead of looping forever", async () => {
  let calls = 0;
  const client = stubClient((timestampAfter) => {
    calls += 1;
    return [{ fingerprint: calls, timestamp: timestampAfter + 1, from: "user", type: "text" }];
  });

  await fetchMessageDelta(client, "site", "session_a", 0);

  assert.equal(calls, MESSAGE_BATCH_CAP);
});

test("throws when sinceTimestamp is not a finite number", async () => {
  const client = stubClient(() => []);

  await assert.rejects(() => fetchMessageDelta(client, "site", "session_a", null));
  await assert.rejects(() => fetchMessageDelta(client, "site", "session_a", undefined));
});
