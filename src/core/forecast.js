const { PAGE_SIZE, listOptions, listPage } = require("../crisp/conversations");
const { countMessageBatches } = require("../crisp/messages");
const { getDailyLimit } = require("../crisp/quota");

const DEFAULT_SAMPLE = 8;
const DEFAULT_MESSAGE_BATCHES = 1.5;

async function countConversations(client, websiteId, query, retryOpts) {
  let requests = 0;

  const first = await listPage(client, websiteId, 1, query, retryOpts);
  requests += 1;

  if (first.length === 0) {
    return { count: 0, pages: 0, requests, firstPage: [] };
  }

  if (first.length < PAGE_SIZE) {
    return { count: first.length, pages: 1, requests, firstPage: first };
  }

  let low = 1;
  let high = null;
  let probe = 2;

  while (probe <= 1_000_000) {
    const batch = await listPage(client, websiteId, probe, query, retryOpts);
    requests += 1;

    if (batch.length === 0) {
      high = probe;
      break;
    }

    if (batch.length < PAGE_SIZE) {
      return {
        count: (probe - 1) * PAGE_SIZE + batch.length,
        pages: probe,
        requests,
        firstPage: first,
      };
    }

    low = probe;
    probe *= 2;
  }

  if (high == null) {
    throw new Error("Could not find the last conversation page");
  }

  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    const batch = await listPage(client, websiteId, mid, query, retryOpts);
    requests += 1;

    if (batch.length === 0) {
      high = mid;
    } else if (batch.length < PAGE_SIZE) {
      return {
        count: (mid - 1) * PAGE_SIZE + batch.length,
        pages: mid,
        requests,
        firstPage: first,
      };
    } else {
      low = mid;
    }
  }

  return {
    count: low * PAGE_SIZE,
    pages: low,
    requests,
    firstPage: first,
  };
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function estimateDays(totalRequests, dailyLimit) {
  if (totalRequests <= 0) {
    return { days: 0, lastDayRequests: 0 };
  }

  const days = Math.ceil(totalRequests / dailyLimit);
  const lastDayRequests = totalRequests - dailyLimit * (days - 1);

  return { days, lastDayRequests };
}

async function runForecast({
  client,
  websiteId,
  includeEmpty = false,
  includeEvents = false,
  dateStart = null,
  dateEnd = null,
  sampleSize = DEFAULT_SAMPLE,
  dailyLimit,
  alreadyExported = 0,
} = {}) {
  const retryOpts = {};
  const query = listOptions({ includeEmpty, dateStart, dateEnd });
  const counted = await countConversations(client, websiteId, query, retryOpts);

  let forecastRequests = counted.requests;
  const sample = {
    size: 0,
    message_batches: [],
    message_counts: [],
    avg_message_batches: DEFAULT_MESSAGE_BATCHES,
    assumed: true,
  };

  const targets = counted.firstPage
    .map((conversation) => conversation.session_id)
    .filter(Boolean)
    .slice(0, Math.max(0, sampleSize));

  if (targets.length > 0) {
    sample.assumed = false;

    for (const sessionId of targets) {
      const result = await countMessageBatches(
        client,
        websiteId,
        sessionId,
        retryOpts
      );
      forecastRequests += result.batches;
      sample.size += 1;
      sample.message_batches.push(result.batches);
      sample.message_counts.push(result.messages);
    }

    sample.avg_message_batches = round1(average(sample.message_batches));
  }

  const remainingConversations = Math.max(0, counted.count - alreadyExported);
  const remainingPages = Math.ceil(remainingConversations / PAGE_SIZE);
  const eventsPerConversation = includeEvents ? 1 : 0;
  const metaRequests = remainingConversations;
  const messageRequests = remainingConversations * sample.avg_message_batches;
  const eventRequests = remainingConversations * eventsPerConversation;
  const listRequests = remainingPages;
  const exportRequests = Math.ceil(
    listRequests + metaRequests + messageRequests + eventRequests
  );

  const { days, lastDayRequests } = estimateDays(exportRequests, dailyLimit);
  const conversationsPerDay = sample.avg_message_batches + 1 + eventsPerConversation;
  const estimatedConversationsPerDay =
    conversationsPerDay > 0 ? Math.floor(dailyLimit / conversationsPerDay) : 0;

  return {
    website_id: websiteId,
    generated_at: new Date().toISOString(),
    conversations: counted.count,
    pages: counted.pages,
    already_exported: alreadyExported,
    remaining_conversations: remainingConversations,
    filters: {
      include_empty: includeEmpty,
      include_events: includeEvents,
      date_start: dateStart,
      date_end: dateEnd,
    },
    sample: {
      size: sample.size,
      assumed: sample.assumed,
      avg_message_batches: sample.avg_message_batches,
      min_message_batches: sample.message_batches.length
        ? Math.min(...sample.message_batches)
        : null,
      max_message_batches: sample.message_batches.length
        ? Math.max(...sample.message_batches)
        : null,
      avg_messages: sample.message_counts.length
        ? Math.round(average(sample.message_counts))
        : null,
    },
    requests: {
      forecast: forecastRequests,
      list: listRequests,
      meta: metaRequests,
      messages: Math.ceil(messageRequests),
      events: eventRequests,
      export_total: exportRequests,
    },
    quota: {
      daily_limit: dailyLimit,
      days,
      last_day_requests: lastDayRequests,
      approx_conversations_per_day: Math.max(0, estimatedConversationsPerDay),
    },
  };
}

function formatNumber(value) {
  return Number(value).toLocaleString("pt-BR");
}

function formatForecast(result) {
  const sampleNote = result.sample.assumed
    ? `sem amostragem (assumido ${result.sample.avg_message_batches} lote(s) de mensagens/conversa)`
    : `${result.sample.size} conversas, média ${result.sample.avg_message_batches} lote(s) de mensagens (min ${result.sample.min_message_batches}, max ${result.sample.max_message_batches})`;

  const remainingLine =
    result.already_exported > 0
      ? `Já exportadas (checkpoint): ${formatNumber(result.already_exported)} → restam ${formatNumber(result.remaining_conversations)}\n`
      : "";

  const windowLine =
    result.filters.date_start || result.filters.date_end
      ? `Janela: ${result.filters.date_start || "…"} → ${result.filters.date_end || "…"}\n`
      : "";

  return (
    "Previsão de extração Crisp\n" +
    "-------------------------\n" +
    `Conversas: ${formatNumber(result.conversations)} (${formatNumber(result.pages)} páginas de listagem)\n` +
    windowLine +
    remainingLine +
    `Amostragem: ${sampleNote}\n` +
    "\n" +
    "Custo estimado da extração:\n" +
    `  Listagem:   ${formatNumber(result.requests.list)}\n` +
    `  Meta:       ${formatNumber(result.requests.meta)}\n` +
    `  Mensagens:  ~${formatNumber(result.requests.messages)}\n` +
    `  Eventos:    ${formatNumber(result.requests.events)}\n` +
    `  Total:      ~${formatNumber(result.requests.export_total)} requests\n` +
    "\n" +
    `Cota diária: ${formatNumber(result.quota.daily_limit)} requests (~${formatNumber(result.quota.approx_conversations_per_day)} conversas/dia)\n` +
    `Tempo estimado: ${formatNumber(result.quota.days)} dia(s) (último dia ~${formatNumber(result.quota.last_day_requests)} requests)\n` +
    `Requests usados nesta previsão: ${formatNumber(result.requests.forecast)}\n`
  );
}

module.exports = {
  DEFAULT_SAMPLE,
  runForecast,
  formatForecast,
};
