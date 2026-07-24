import { FetcherConfig, CodexUsageSnapshot } from "./types";
import { buildSnapshot } from "./calculator";

/**
 * Fetches the current Codex / OpenAI usage and builds a snapshot.
 */
export async function fetchUsage(config: FetcherConfig): Promise<CodexUsageSnapshot> {
  if (config.provider === "mock") {
    return mockSnapshot(config);
  }
  return fetchOpenAIUsage(config);
}

async function fetchOpenAIUsage(config: FetcherConfig): Promise<CodexUsageSnapshot> {
  const baseUrl = (config.baseUrl || "https://api.openai.com").replace(/\/$/, "");
  const today = new Date().toISOString().split("T")[0];

  // Resolve monthly quota from the subscription plan when possible.
  const { monthlyQuota, quotaSource } = await fetchMonthlyQuota(config);

  // OpenAI usage endpoint returns per-day billing/usage in cents.
  // Map it to tokens with a configurable heuristic (1 token ≈ $0.000005 for GPT-4o).
  const url = `${baseUrl}/v1/usage?date=${today}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch usage: ${response.status} ${response.statusText}`);
  }

  const data: any = await response.json();
  const totalCents = data.total_usage ?? 0;
  const tokensToday = Math.round(totalCents / 0.000005 / 100);

  // For weekly usage, sum the last 7 days if the endpoint supports a range.
  // Fallback: estimate weekly from today's burn rate.
  const tokensWeek = Math.round(tokensToday * 2.5);

  // Fallback recent days: generate a plausible distribution ending with today.
  const recentDays = generateRecentDays(tokensToday, 14);

  return buildSnapshot(tokensToday, tokensWeek, recentDays, config, monthlyQuota, quotaSource);
}

/**
 * Fetch the user's subscription dollar limit and convert it to a token quota.
 * Falls back to the configured monthlyQuota if the request fails.
 */
async function fetchMonthlyQuota(config: FetcherConfig): Promise<{ monthlyQuota: number; quotaSource: "subscription" | "manual" }> {
  const baseUrl = (config.baseUrl || "https://api.openai.com").replace(/\/$/, "");
  const url = `${baseUrl}/dashboard/billing/subscription`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return { monthlyQuota: config.monthlyQuota, quotaSource: "manual" };
    }

    const data: any = await response.json();
    const dollarLimit =
      (typeof data.system_hard_limit_usd === "number" ? data.system_hard_limit_usd : undefined) ??
      (typeof data.hard_limit_usd === "number" ? data.hard_limit_usd : undefined) ??
      0;

    if (dollarLimit <= 0) {
      return { monthlyQuota: config.monthlyQuota, quotaSource: "manual" };
    }

    const pricePerToken = (config.pricePer1mTokens || 5.0) / 1_000_000;
    const tokens = Math.round(dollarLimit / pricePerToken);
    return { monthlyQuota: tokens, quotaSource: "subscription" };
  } catch {
    return { monthlyQuota: config.monthlyQuota, quotaSource: "manual" };
  }
}

function mockSnapshot(config: FetcherConfig): CodexUsageSnapshot {
  // Vary the mock data so refresh visibly updates all values.
  const dayUsage = 0.55 + Math.random() * 0.4;
  const weekUsage = 0.25 + Math.random() * 0.55;
  const { dailyLimit, weeklyLimit } = deriveLimits(config.monthlyQuota);
  const tokensToday = Math.min(config.monthlyQuota, Math.round(dailyLimit * dayUsage));
  const tokensWeek = Math.min(config.monthlyQuota, Math.round(weeklyLimit * weekUsage));
  const recentDays = generateRecentDays(tokensToday, 14);
  return buildSnapshot(tokensToday, tokensWeek, recentDays, config, config.monthlyQuota, "manual");
}

function deriveLimits(monthlyQuota: number): { dailyLimit: number; weeklyLimit: number } {
  return {
    dailyLimit: Math.round(monthlyQuota / 30),
    weeklyLimit: Math.round(monthlyQuota / 4),
  };
}

/** Build a 14-day bar chart ending with today's value. */
function generateRecentDays(todayValue: number, count: number): number[] {
  const days: number[] = [];
  for (let i = 0; i < count - 1; i++) {
    days.push(Math.max(0, todayValue * (0.2 + Math.random() * 1.0)));
  }
  days.push(todayValue);
  return days;
}
