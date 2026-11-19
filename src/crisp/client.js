const { Crisp } = require("crisp-api");

const DEFAULT_MAX_RETRIES = 8;
const MAX_BACKOFF_MS = 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error) {
  const code = error?.code;
  return code === 429 || code === 420 || (code >= 500 && code < 600);
}

function isQuotaError(error) {
  const code = error?.code;
  return code === 429 || code === 420;
}

async function withRetry(fn, { maxRetries = DEFAULT_MAX_RETRIES, onQuota } = {}) {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryable(error) || attempt >= maxRetries) {
        throw error;
      }

      if (isQuotaError(error) && typeof onQuota === "function") {
        onQuota(error);
      }

      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
      await sleep(delay);
      attempt += 1;
    }
  }
}

function createClient({ identifier, key, tier = "website" }) {
  if (!identifier || !key) {
    throw new Error("Missing CRISP_IDENTIFIER or CRISP_KEY");
  }

  if (tier !== "website" && tier !== "plugin") {
    throw new Error(`Invalid CRISP_TIER "${tier}" (use website or plugin)`);
  }

  const client = new Crisp();
  client.authenticateTier(tier, identifier, key);
  return client;
}

function summarizeError(error) {
  return {
    code: error?.code ?? null,
    message: error?.message ?? String(error),
    reason: error?.reason ?? null,
  };
}

module.exports = {
  summarizeError,
  createClient,
  withRetry,
  isQuotaError,
  sleep,
};
