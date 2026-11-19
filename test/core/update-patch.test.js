const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyConversation, buildUpdatePatch } = require("../../src/core/update-patch");

test("classifyConversation: new when there is no known index", () => {
  const result = classifyConversation({ session_id: "session_a" }, null);
  assert.deepEqual(result, { kind: "new" });
});

test("classifyConversation: new when session_id is not indexed", () => {
  const knownIndex = new Map([["session_other", { lastMessageTimestamp: 100 }]]);
  const result = classifyConversation({ session_id: "session_a" }, knownIndex);
  assert.deepEqual(result, { kind: "new" });
});

test("classifyConversation: updated when indexed with a finite timestamp", () => {
  const knownIndex = new Map([["session_a", { lastMessageTimestamp: 150 }]]);
  const result = classifyConversation({ session_id: "session_a" }, knownIndex);
  assert.deepEqual(result, { kind: "updated", sinceTimestamp: 150 });
});

test("classifyConversation: full when indexed but without a usable timestamp", () => {
  const knownIndex = new Map([["session_a", { lastMessageTimestamp: null }]]);
  const result = classifyConversation({ session_id: "session_a" }, knownIndex);
  assert.deepEqual(result, { kind: "full" });
});

test("buildUpdatePatch: wraps only the delta messages with conversation metadata", () => {
  const conversation = {
    session_id: "session_a",
    website_id: "site_1",
    people_id: "people_1",
    inbox_id: null,
    state: "resolved",
    created_at: 1000,
    updated_at: 2000,
    assigned: null,
  };
  const meta = { nickname: "Jane", email: "jane@example.com" };
  const deltaMessages = [
    { fingerprint: 9, timestamp: 2500, type: "text", from: "user", content: "oi" },
  ];

  const patch = buildUpdatePatch({
    conversation,
    meta,
    deltaMessages,
    sinceTimestamp: 2000,
  });

  assert.equal(patch.session_id, "session_a");
  assert.equal(patch.since_timestamp, 2000);
  assert.equal(patch.conversation.session_id, "session_a");
  assert.equal(patch.conversation.contact.nickname, "Jane");
  assert.equal(patch.conversation.messages, undefined);
  assert.deepEqual(
    patch.messages.map((message) => message.fingerprint),
    [9]
  );
});
