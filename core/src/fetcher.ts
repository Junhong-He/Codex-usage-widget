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

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function dateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return formatDate(d);
}

async function fetchOpenAIUsage(config: FetcherConfig): Promise<CodexUsageSnapshot> {
  const baseUrl = (config.baseUrl || "https://api.openai.com").replace(/\/$/, "");
  const today = formatDate(new Date());
  const startDate = dateDaysAgo(13);

  // Resolve monthly quota from the subscription plan when possible.
  const { monthlyQuota, quotaSource } = await fetchMonthlyQuota(config);

  // The dashboard billing usage endpoint returns daily costs in USD for a date range.
  const url = `${baseUrl}/v1/dashboard/billing/usage?start_date=${startDate}&end_date=${today}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to fetch usage: ${response.status} ${response.statusText} ${text}`);
  }

  const data: any = await response.json();
  const dailyCosts = Array.isArray(data.data) ? data.data : [];
  const pricePerToken = (config.pricePer1mTokens || 5.0) / 1_000_000;

  const dayMap: Record<string, number> = {};
  dailyCosts.forEach((item: any) => {
    const date = formatDate(new Date(item.timestamp * 1000));
    dayMap[date] = (dayMap[date] || 0) + (item.cost || 0);
  });

  const costToday = dayMap[today] || 0;
  const tokensToday = Math.round(costToday / pricePerToken);

  let costWeek = 0;
  for (let i = 0; i < 7; i++) {
    costWeek += dayMap[dateDaysAgo(i)] || 0;
  }
  const tokensWeek = Math.round(costWeek / pricePerToken);

  const recentDays: number[] = [];
  for (let i = 13; i >= 0; i--) {
    recentDays.push(Math.round((dayMap[dateDaysAgo(i)] || 0) / pricePerToken));
  }

  return buildSnapshot(tokensToday, tokensWeek, recentDays, config, monthlyQuota, quotaSource);
}

/**
 * Fetch the user's subscription dollar limit and convert it to a token quota.
 * Falls back to the configured monthlyQuota if the request fails.
 */
async function fetchMonthlyQuota(config: FetcherConfig): Promise<{ monthlyQuota: number; quotaSource: "subscription" | "manual" }> {
  const baseUrl = (config.baseUrl || "https://api.openai.com").replace(/\/$/, "");
  const url = `${baseUrl}/v1/dashboard/billing/subscription`;

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
