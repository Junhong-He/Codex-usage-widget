import { CodexUsageSnapshot, FetcherConfig } from "./types";

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(2)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return `${Math.round(n)}`;
}

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function deriveLimits(monthlyQuota: number): { dailyLimit: number; weeklyLimit: number } {
  return {
    dailyLimit: Math.round(monthlyQuota / 30),
    weeklyLimit: Math.round(monthlyQuota / 4),
  };
}

export function buildSnapshot(
  tokensToday: number,
  tokensWeek: number,
  recentDays: number[],
  config: FetcherConfig,
  monthlyQuota: number,
  quotaSource: "subscription" | "manual"
): CodexUsageSnapshot {
  const { dailyLimit, weeklyLimit } = deriveLimits(monthlyQuota);
  const dayPercent = dailyLimit > 0
    ? clampPercent((tokensToday / dailyLimit) * 100)
    : 0;
  const weekPercent = weeklyLimit > 0
    ? clampPercent((tokensWeek / weeklyLimit) * 100)
    : 0;

  const dayRemaining = Math.max(0, dailyLimit - tokensToday);
  const weekRemaining = Math.max(0, weeklyLimit - tokensWeek);

  return {
    updatedAt: new Date().toISOString(),
    tokensToday,
    tokensWeek,
    monthlyQuota,
    dailyLimit,
    weeklyLimit,
    dayPercent,
    weekPercent,
    dayRemainingLabel: formatRemaining(dayRemaining, true),
    weekRemainingLabel: formatRemaining(weekRemaining, false),
    recentDays,
    quotaSource,
  };
}

function formatRemaining(tokens: number, isDay: boolean): string {
  if (isDay) {
    // Rough heuristic: ~100 tokens/min average for a coding session
    const minutes = tokens / 100;
    const hours = Math.round(minutes / 60);
    if (hours < 1) return `${Math.max(1, Math.round(minutes))}m`;
    return `${hours}h`;
  }
  // Weekly: days remaining based on daily burn rate
  const days = Math.max(1, Math.round(tokens / 2_000_000));
  return `${days}d`;
}

/** Format an ISO date as "Updated at 09:30" using the local system clock. */
export function formatUpdatedAt(isoDate: string): string {
  const date = new Date(isoDate);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `Updated at ${hours}:${minutes}`;
}
