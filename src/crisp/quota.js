const DEFAULT_DAILY_LIMITS = {
  website: 10_000,
  plugin: 5_000,
};

function getDailyLimit(tier = "website", override) {
  if (override != null) {
    const parsed = Number(override);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error("Daily limit must be a positive number");
    }
    return Math.floor(parsed);
  }

  return DEFAULT_DAILY_LIMITS[tier] || DEFAULT_DAILY_LIMITS.website;
}

module.exports = {
  DEFAULT_DAILY_LIMITS,
  getDailyLimit,
};
