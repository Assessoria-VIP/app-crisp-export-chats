#!/usr/bin/env node

require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("node:util");
const { createClient, isQuotaError, summarizeError } = require("../crisp/client");
const {
  listOptions,
  listAllConversations,
  fetchConversationMeta,
  fetchAllEvents,
} = require("../crisp/conversations");
const { fetchAllMessages, fetchMessageDelta } = require("../crisp/messages");
const { getDailyLimit } = require("../crisp/quota");
const {
  emptyCheckpoint,
  loadCheckpoint,
  applyCheckpointWindow,
  saveCheckpoint,
} = require("../storage/checkpoint");
const { writeManifest } = require("../storage/manifest");
const { buildKnownIndex } = require("../storage/known-index");
const { normalizeConversation } = require("../core/normalize");
const { DEFAULT_SAMPLE, runForecast, formatForecast } = require("../core/forecast");
const { resolveDateWindow, sortOldestFirst, defaultOutDir } = require("../core/dates");
const { classifyConversation, buildUpdatePatch } = require("../core/update-patch");

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      out: { type: "string", default: "./export/completed-exports/full-export" },
      resume: { type: "boolean", default: false },
      "include-empty": { type: "boolean", default: false },
      "include-events": { type: "boolean", default: false },
      days: { type: "string" },
      "date-start": { type: "string" },
      "date-end": { type: "string" },
      "max-conversations": { type: "string" },
      forecast: { type: "boolean", default: false },
      sample: { type: "string" },
      "daily-limit": { type: "string" },
      "known-dir": { type: "string" },
    },
    allowPositionals: false,
  });

  const maxConversations = values["max-conversations"]
    ? Number.parseInt(values["max-conversations"], 10)
    : null;

  if (maxConversations !== null && (!Number.isFinite(maxConversations) || maxConversations < 1)) {
    throw new Error("--max-conversations must be a positive integer");
  }

  const sample = values.sample != null
    ? Number.parseInt(values.sample, 10)
    : DEFAULT_SAMPLE;

  if (!Number.isFinite(sample) || sample < 0) {
    throw new Error("--sample must be a non-negative integer");
  }

  const days = values.days != null ? Number.parseInt(values.days, 10) : null;
  if (days !== null && (!Number.isFinite(days) || days < 1)) {
    throw new Error("--days must be a positive integer");
  }

  const window = resolveDateWindow({
    days,
    dateStart: values["date-start"] || null,
    dateEnd: values["date-end"] || null,
  });

  return {
    outDir: path.resolve(defaultOutDir({ out: values.out, days: window.days, argv })),
    resume: values.resume,
    includeEmpty: values["include-empty"],
    includeEvents: values["include-events"],
    days: window.days,
    dateStart: window.dateStart,
    dateEnd: window.dateEnd,
    oldestFirst: true,
    maxConversations,
    forecast: values.forecast,
    sample,
    dailyLimit: values["daily-limit"] || process.env.CRISP_DAILY_LIMIT || null,
    knownDir: values["known-dir"] ? path.resolve(values["known-dir"]) : null,
  };
}

async function exportOneConversation({
  client,
  websiteId,
  conversation,
  includeEvents,
  retryOpts,
}) {
  const sessionId = conversation.session_id;
  const meta = await fetchConversationMeta(client, websiteId, sessionId, conversation.meta || {}, retryOpts);
  const messages = await fetchAllMessages(client, websiteId, sessionId, retryOpts);
  const events = includeEvents
    ? await fetchAllEvents(client, websiteId, sessionId, retryOpts)
    : undefined;

  return normalizeConversation({ conversation, meta, messages, events });
}

function windowMeta(options) {
  return {
    days: options.days,
    date_start: options.dateStart,
    date_end: options.dateEnd,
    order: "created_at_asc",
    include_events: options.includeEvents,
    include_empty: options.includeEmpty,
  };
}

async function exportOldestFirst({
  client,
  websiteId,
  options,
  checkpoint,
  checkpointPath,
  jsonlPath,
  updatedJsonlPath,
  manifestPath,
  exported,
  updatedProcessed,
  knownIndex,
  retryOpts,
  startedAt,
}) {
  const windowLabel =
    options.dateStart || options.dateEnd
      ? `from ${options.dateStart || "…"} to ${options.dateEnd || "…"}`
      : "all pages";

  process.stderr.write(
    `listing conversations ${windowLabel} (API pages are newest-first; writing oldest → newest)...\n`
  );

  const listed = await listAllConversations(
    client,
    websiteId,
    listOptions(options),
    retryOpts
  );
  const ordered = sortOldestFirst(listed);

  process.stderr.write(
    `found ${ordered.length} conversations; exporting oldest → newest\n`
  );

  let reachedCap = false;
  let processedCount = 0;

  for (const conversation of ordered) {
    if (options.maxConversations && processedCount >= options.maxConversations) {
      reachedCap = true;
      break;
    }

    const sessionId = conversation?.session_id;
    if (!sessionId || exported.has(sessionId) || updatedProcessed.has(sessionId)) {
      continue;
    }

    const classification = classifyConversation(conversation, knownIndex);

    try {
      if (classification.kind === "updated") {
        const meta = await fetchConversationMeta(
          client,
          websiteId,
          sessionId,
          conversation.meta || {},
          retryOpts
        );
        const deltaMessages = await fetchMessageDelta(
          client,
          websiteId,
          sessionId,
          classification.sinceTimestamp,
          retryOpts
        );

        updatedProcessed.add(sessionId);
        checkpoint.updated_session_ids.push(sessionId);
        processedCount += 1;

        if (deltaMessages.length > 0) {
          const patch = buildUpdatePatch({
            conversation,
            meta,
            deltaMessages,
            sinceTimestamp: classification.sinceTimestamp,
          });
          fs.appendFileSync(updatedJsonlPath, `${JSON.stringify(patch)}\n`);
          checkpoint.updated_conversation_count += 1;
          checkpoint.updated_message_count += deltaMessages.length;
        }

        saveCheckpoint(checkpointPath, checkpoint);

        process.stderr.write(
          `updated ${processedCount}/${ordered.length} (+${deltaMessages.length} messages, ${sessionId})\n`
        );
      } else {
        const record = await exportOneConversation({
          client,
          websiteId,
          conversation,
          includeEvents: options.includeEvents,
          retryOpts,
        });

        fs.appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`);
        exported.add(sessionId);
        checkpoint.exported_session_ids.push(sessionId);
        checkpoint.conversation_count += 1;
        checkpoint.message_count += record.messages.length;
        processedCount += 1;
        saveCheckpoint(checkpointPath, checkpoint);

        const created = record.created_at
          ? new Date(record.created_at).toISOString()
          : "unknown";
        process.stderr.write(
          `exported ${processedCount}/${ordered.length} (${created}, ${sessionId})\n`
        );
      }
    } catch (error) {
      checkpoint.errors.push({
        session_id: sessionId,
        ...summarizeError(error),
        at: new Date().toISOString(),
      });
      saveCheckpoint(checkpointPath, checkpoint);

      if (isQuotaError(error)) {
        writeManifest(manifestPath, checkpoint, {
          status: "quota_exhausted",
          elapsed_ms: Date.now() - startedAt,
          ...windowMeta(options),
        });
        process.stderr.write(
          "Quota or rate limit exhausted. Re-run with --resume later.\n"
        );
        process.exitCode = 2;
        return;
      }

      process.stderr.write(`skip ${sessionId}: ${error?.message || error}\n`);
    }
  }

  writeManifest(manifestPath, checkpoint, {
    status: reachedCap ? "partial_limit" : "complete",
    elapsed_ms: Date.now() - startedAt,
    window_conversations: ordered.length,
    ...windowMeta(options),
  });

  process.stderr.write(
    `done: ${checkpoint.conversation_count} conversations, ${checkpoint.message_count} messages\n`
  );
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const websiteId = process.env.CRISP_WEBSITE_ID;

  if (!websiteId) {
    throw new Error("Missing CRISP_WEBSITE_ID");
  }

  const tier = process.env.CRISP_TIER || "website";
  const client = createClient({
    identifier: process.env.CRISP_IDENTIFIER,
    key: process.env.CRISP_KEY,
    tier,
  });

  if (options.forecast) {
    let alreadyExported = 0;
    const checkpointPath = path.join(options.outDir, "checkpoint.json");

    if (fs.existsSync(checkpointPath)) {
      try {
        const checkpoint = loadCheckpoint(checkpointPath, websiteId);
        alreadyExported = checkpoint.conversation_count || 0;
        applyCheckpointWindow(options, checkpoint);
      } catch {
        alreadyExported = 0;
      }
    }

    const result = await runForecast({
      client,
      websiteId,
      includeEmpty: options.includeEmpty,
      includeEvents: options.includeEvents,
      dateStart: options.dateStart,
      dateEnd: options.dateEnd,
      sampleSize: options.sample,
      dailyLimit: getDailyLimit(tier, options.dailyLimit),
      alreadyExported,
    });

    fs.mkdirSync(options.outDir, { recursive: true });
    fs.writeFileSync(
      path.join(options.outDir, "forecast.json"),
      `${JSON.stringify(result, null, 2)}\n`
    );
    process.stdout.write(formatForecast(result));
    return;
  }

  fs.mkdirSync(options.outDir, { recursive: true });

  const jsonlPath = path.join(options.outDir, "conversations.jsonl");
  const updatedJsonlPath = path.join(options.outDir, "conversations-updated.jsonl");
  const checkpointPath = path.join(options.outDir, "checkpoint.json");
  const manifestPath = path.join(options.outDir, "manifest.json");

  let checkpoint;

  if (options.resume && fs.existsSync(checkpointPath)) {
    checkpoint = loadCheckpoint(checkpointPath, websiteId);
    applyCheckpointWindow(options, checkpoint);
    if (checkpoint.order === "api_page") {
      process.stderr.write(
        "checkpoint was newest-first (API page order). Remaining rows will be appended oldest-first, so the JSONL will be mixed. For a chronological file, run without --resume.\n"
      );
    }
    checkpoint.order = "created_at_asc";
  } else {
    checkpoint = emptyCheckpoint(websiteId, options);
    if (fs.existsSync(jsonlPath)) {
      fs.unlinkSync(jsonlPath);
    }
    if (fs.existsSync(updatedJsonlPath)) {
      fs.unlinkSync(updatedJsonlPath);
    }
  }

  const exported = new Set(checkpoint.exported_session_ids);
  const updatedProcessed = new Set(checkpoint.updated_session_ids);
  const retryOpts = {
    onQuota: () => {
      checkpoint.quota_errors += 1;
    },
  };

  let knownIndex = null;
  if (options.knownDir) {
    const knownJsonlPath = path.join(options.knownDir, "conversations.jsonl");
    process.stderr.write(`indexing known conversations from ${knownJsonlPath}...\n`);
    knownIndex = await buildKnownIndex(knownJsonlPath);
    process.stderr.write(`known-conversations index ready: ${knownIndex.size} sessions\n`);
  }

  const startedAt = Date.now();
  saveCheckpoint(checkpointPath, checkpoint);

  try {
    await exportOldestFirst({
      client,
      websiteId,
      options,
      checkpoint,
      checkpointPath,
      jsonlPath,
      updatedJsonlPath,
      manifestPath,
      exported,
      updatedProcessed,
      knownIndex,
      retryOpts,
      startedAt,
    });
  } catch (error) {
    if (isQuotaError(error)) {
      checkpoint.quota_errors += 1;
    }

    checkpoint.errors.push({
      ...summarizeError(error),
      at: new Date().toISOString(),
    });
    saveCheckpoint(checkpointPath, checkpoint);
    writeManifest(manifestPath, checkpoint, {
      status: isQuotaError(error) ? "quota_exhausted" : "failed",
      elapsed_ms: Date.now() - startedAt,
      ...windowMeta(options),
    });

    if (isQuotaError(error)) {
      process.stderr.write("Quota or rate limit exhausted. Re-run with --resume later.\n");
      process.exitCode = 2;
      return;
    }

    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
});
