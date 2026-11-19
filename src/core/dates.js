function resolveDateWindow({ days, dateStart, dateEnd, now = new Date() }) {
  if (days != null && (dateStart || dateEnd)) {
    throw new Error("Use either --days or --date-start/--date-end, not both");
  }

  if (days != null) {
    const end = now;
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    return {
      days,
      dateStart: start.toISOString(),
      dateEnd: end.toISOString(),
    };
  }

  return {
    days: null,
    dateStart: dateStart || null,
    dateEnd: dateEnd || null,
  };
}

function conversationTime(conversation) {
  return conversation.created_at || conversation.updated_at || 0;
}

function sortOldestFirst(conversations) {
  return [...conversations].sort((a, b) => {
    const delta = conversationTime(a) - conversationTime(b);
    if (delta !== 0) {
      return delta;
    }

    return String(a.session_id || "").localeCompare(String(b.session_id || ""));
  });
}

function defaultOutDir({ out, days, argv }) {
  const outPassed = argv.includes("--out");
  if (outPassed || !days) {
    return out;
  }

  return `./export/last-${days}d`;
}

module.exports = {
  resolveDateWindow,
  sortOldestFirst,
  defaultOutDir,
};
