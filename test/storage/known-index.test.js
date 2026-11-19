const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildKnownIndex } = require("../../src/storage/known-index");

function writeFixture(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "known-index-test-"));
  const filePath = path.join(dir, "conversations.jsonl");
  fs.writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return filePath;
}

test("indexes the last message timestamp per session", async () => {
  const filePath = writeFixture([
    {
      session_id: "session_a",
      messages: [{ timestamp: 100 }, { timestamp: 300 }, { timestamp: 200 }],
    },
    {
      session_id: "session_b",
      messages: [{ timestamp: 50 }],
    },
  ]);

  const index = await buildKnownIndex(filePath);

  assert.equal(index.size, 2);
  assert.deepEqual(index.get("session_a"), { lastMessageTimestamp: 300 });
  assert.deepEqual(index.get("session_b"), { lastMessageTimestamp: 50 });
});

test("handles a conversation with no messages", async () => {
  const filePath = writeFixture([{ session_id: "session_empty", messages: [] }]);

  const index = await buildKnownIndex(filePath);

  assert.deepEqual(index.get("session_empty"), { lastMessageTimestamp: null });
});

test("returns an empty index for an empty file", async () => {
  const filePath = writeFixture([]);

  const index = await buildKnownIndex(filePath);

  assert.equal(index.size, 0);
});

test("skips corrupted lines without throwing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "known-index-test-"));
  const filePath = path.join(dir, "conversations.jsonl");
  fs.writeFileSync(
    filePath,
    [
      JSON.stringify({ session_id: "session_ok", messages: [{ timestamp: 10 }] }),
      "{not valid json",
      "",
      JSON.stringify({ session_id: "session_also_ok", messages: [{ timestamp: 20 }] }),
    ].join("\n") + "\n"
  );

  const index = await buildKnownIndex(filePath);

  assert.equal(index.size, 2);
  assert.deepEqual(index.get("session_ok"), { lastMessageTimestamp: 10 });
  assert.deepEqual(index.get("session_also_ok"), { lastMessageTimestamp: 20 });
});
