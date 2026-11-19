#!/usr/bin/env node
// Wrapper for the post-cutoff (remaining) export.
//
// There is a single active export at ./export/app-crisp-export-chats:
//   npm run remains                       -> continue the active export (resume is implicit;
//                                            the cutoff comes from its checkpoint)
//   npm run remains -- --new <cutoff ISO> -> archive the active export to
//                                            ./export/app-crisp-exported-chats and start a new one
// Extra flags (e.g. --max-conversations, --daily-limit) are passed through.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const EXPORT_ROOT = "./export";
const KNOWN_DIR = EXPORT_ROOT;
const ACTIVE_DIR = "app-crisp-export-chats";
const ARCHIVE_DIR = "app-crisp-exported-chats";

// Flags the wrapper controls; accepting them from the user would conflict.
const RESERVED_FLAGS = ["--resume", "--out", "--known-dir", "--date-start"];

const USAGE =
  "usage:\n" +
  "  npm run remains                          continue the active export\n" +
  "  npm run remains -- --new <cutoff ISO>    archive the active export and start a new one\n" +
  "  e.g. npm run remains -- --new 2026-09-22T00:00:00.000Z\n";

class UsageError extends Error {}

function parseRemainsArgs(argv) {
  let cutoff = null;
  let isNew = false;
  const positional = [];
  const passthrough = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const flag = arg.split("=")[0];

    if (flag === "--new") {
      isNew = true;
      cutoff = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[(i += 1)];
    } else if (RESERVED_FLAGS.includes(flag)) {
      throw new UsageError(
        `${flag} is set by this wrapper and cannot be passed` +
          (flag === "--resume" ? " (resume is implicit: just run `npm run remains`)" : "")
      );
    } else if (arg.startsWith("-")) {
      passthrough.push(arg);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    throw new UsageError(
      `unexpected argument "${positional[0]}": a cutoff is only accepted with --new ` +
        "(an existing active export always uses the cutoff stored in its checkpoint)"
    );
  }

  if (isNew && (!cutoff || Number.isNaN(Date.parse(cutoff)))) {
    throw new UsageError(`--new requires a valid ISO 8601 cutoff, got "${cutoff ?? ""}"`);
  }

  return { mode: isNew ? "new" : "resume", cutoff, passthrough };
}

/**
 * Validates the filesystem state, archives the active export when starting a
 * new one, and returns the args for export-conversations.js.
 */
function prepareRun({ mode, cutoff, passthrough = [] }, { root = EXPORT_ROOT, knownDir = KNOWN_DIR } = {}) {
  const activeDir = path.join(root, ACTIVE_DIR);
  const archiveDir = path.join(root, ARCHIVE_DIR);
  const checkpointPath = path.join(activeDir, "checkpoint.json");
  const baseArgs = ["--out", activeDir, "--known-dir", knownDir];

  if (mode === "resume") {
    if (!fs.existsSync(checkpointPath)) {
      throw new UsageError(
        `no active export (missing ${checkpointPath}). ` +
          "Start one with: npm run remains -- --new <cutoff ISO>"
      );
    }

    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
    return {
      args: [...baseArgs, "--resume", ...passthrough],
      message: `continuing active export ${activeDir} (cutoff from checkpoint: ${checkpoint.date_start ?? "none"})`,
    };
  }

  if (fs.existsSync(archiveDir)) {
    throw new UsageError(
      `${archiveDir} already exists; move or remove it before starting a new export ` +
        "(nothing was changed)"
    );
  }

  let archived = false;
  if (fs.existsSync(activeDir)) {
    fs.renameSync(activeDir, archiveDir);
    archived = true;
  }

  return {
    args: [...baseArgs, "--date-start", cutoff, ...passthrough],
    message:
      (archived ? `archived previous active export to ${archiveDir}; ` : "") +
      `starting new export in ${activeDir} (cutoff ${cutoff})`,
  };
}

function main() {
  let run;
  try {
    run = prepareRun(parseRemainsArgs(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${USAGE}`);
      return 1;
    }
    throw error;
  }

  process.stderr.write(`${run.message}\n`);
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "export-conversations.js"), ...run.args],
    { stdio: "inherit" }
  );
  return result.status ?? 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  ACTIVE_DIR,
  ARCHIVE_DIR,
  UsageError,
  parseRemainsArgs,
  prepareRun,
};
