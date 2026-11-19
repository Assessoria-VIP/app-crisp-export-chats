const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ACTIVE_DIR,
  ARCHIVE_DIR,
  FULL_EXPORT_DIR,
  UsageError,
  parseRemainsArgs,
  prepareRun,
} = require("../../src/cli/export-remaining");

const CUTOFF = "2026-09-22T00:00:00.000Z";

function makeRoot({ active = false, archive = false, known = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "export-remaining-test-"));
  if (known) {
    fs.mkdirSync(path.join(root, FULL_EXPORT_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, FULL_EXPORT_DIR, "conversations.jsonl"), "");
  }
  if (active) {
    fs.mkdirSync(path.join(root, ACTIVE_DIR));
    fs.writeFileSync(
      path.join(root, ACTIVE_DIR, "checkpoint.json"),
      JSON.stringify({ date_start: CUTOFF })
    );
  }
  if (archive) {
    fs.mkdirSync(path.join(root, ARCHIVE_DIR), { recursive: true });
    fs.writeFileSync(path.join(root, ARCHIVE_DIR, "marker"), "old");
  }
  return root;
}

test("no args means resume the active export", () => {
  assert.deepEqual(parseRemainsArgs([]), { mode: "resume", cutoff: null, passthrough: [] });
});

test("--new takes the cutoff (space or = form) and keeps passthrough flags", () => {
  assert.deepEqual(parseRemainsArgs(["--new", CUTOFF, "--max-conversations=3"]), {
    mode: "new",
    cutoff: CUTOFF,
    passthrough: ["--max-conversations=3"],
  });
  assert.equal(parseRemainsArgs([`--new=${CUTOFF}`]).cutoff, CUTOFF);
});

test("a cutoff without --new is rejected", () => {
  assert.throws(() => parseRemainsArgs([CUTOFF]), UsageError);
});

test("--new with a missing or invalid cutoff is rejected", () => {
  assert.throws(() => parseRemainsArgs(["--new"]), UsageError);
  assert.throws(() => parseRemainsArgs(["--new", "not-a-date"]), UsageError);
});

test("flags controlled by the wrapper are rejected", () => {
  for (const flag of ["--resume", "--out=./x", "--known-dir", "--date-start"]) {
    assert.throws(() => parseRemainsArgs([flag]), UsageError, flag);
  }
});

test("resume without an active checkpoint fails", () => {
  const root = makeRoot();
  assert.throws(
    () => prepareRun({ mode: "resume", passthrough: [] }, { root, knownDir: path.join(root, FULL_EXPORT_DIR) }),
    UsageError
  );
});

test("resume passes --resume and no --date-start", () => {
  const root = makeRoot({ active: true });
  const { args, message } = prepareRun(
    { mode: "resume", passthrough: ["--max-conversations=1"] },
    { root, knownDir: path.join(root, FULL_EXPORT_DIR) }
  );
  assert.deepEqual(args, [
    "--out", path.join(root, ACTIVE_DIR),
    "--known-dir", path.join(root, FULL_EXPORT_DIR),
    "--resume",
    "--max-conversations=1",
  ]);
  assert.match(message, new RegExp(CUTOFF));
});

test("--new archives the active export and starts with the cutoff", () => {
  const root = makeRoot({ active: true });
  const { args } = prepareRun({ mode: "new", cutoff: CUTOFF, passthrough: [] }, { root, knownDir: path.join(root, FULL_EXPORT_DIR) });

  assert.equal(fs.existsSync(path.join(root, ACTIVE_DIR)), false);
  assert.equal(fs.existsSync(path.join(root, ARCHIVE_DIR, "checkpoint.json")), true);
  assert.deepEqual(args, [
    "--out", path.join(root, ACTIVE_DIR),
    "--known-dir", path.join(root, FULL_EXPORT_DIR),
    "--date-start", CUTOFF,
  ]);
});

test("--new without an active export just starts", () => {
  const root = makeRoot();
  const { args } = prepareRun({ mode: "new", cutoff: CUTOFF, passthrough: [] }, { root, knownDir: path.join(root, FULL_EXPORT_DIR) });
  assert.ok(args.includes("--date-start"));
  assert.equal(fs.existsSync(path.join(root, ARCHIVE_DIR)), false);
});

test("--new aborts without touching anything when the archive already exists", () => {
  const root = makeRoot({ active: true, archive: true });
  assert.throws(
    () => prepareRun({ mode: "new", cutoff: CUTOFF, passthrough: [] }, { root, knownDir: path.join(root, FULL_EXPORT_DIR) }),
    UsageError
  );
  assert.equal(fs.existsSync(path.join(root, ACTIVE_DIR, "checkpoint.json")), true);
  assert.equal(fs.readFileSync(path.join(root, ARCHIVE_DIR, "marker"), "utf8"), "old");
});

test("missing full-export reference fails before archiving anything", () => {
  const root = makeRoot({ active: true, known: false });
  for (const mode of ["new", "resume"]) {
    assert.throws(
      () => prepareRun({ mode, cutoff: CUTOFF, passthrough: [] }, { root, knownDir: path.join(root, FULL_EXPORT_DIR) }),
      UsageError
    );
  }
  assert.equal(fs.existsSync(path.join(root, ACTIVE_DIR, "checkpoint.json")), true);
  assert.equal(fs.existsSync(path.join(root, ARCHIVE_DIR)), false);
});
