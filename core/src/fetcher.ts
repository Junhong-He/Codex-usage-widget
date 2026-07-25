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

async function fetchUsageForDate(baseUrl: string, apiKey: string, date: string): Promise<number> {
  const url = `${baseUrl}/v1/usage?date=${date}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to fetch usage for ${date}: ${response.status} ${response.statusText} ${text}`);
  }

  const data: any = await response.json();
  // Some endpoints return a single object { date, usage }, others wrap it as { data: [...] }.
  if (data && typeof data.usage === "number") {
    return Number(data.usage);
  }
  if (Array.isArray(data.data)) {
    return data.data.reduce((sum: number, item: any) => sum + Number(item.usage || 0), 0);
  }
  return 0;
}

async function fetchOpenAIUsage(config: FetcherConfig): Promise<CodexUsageSnapshot> {
  const baseUrl = (config.baseUrl || "https://api.openai.com").replace(/\/$/, "");
  const today = formatDate(new Date());

  // The subscription/hard-limit endpoint only accepts a browser session key,
  // not an API secret key, so we fall back to the configured monthly quota.
  const { monthlyQuota, quotaSource } = await fetchMonthlyQuota(config);

  // Query each day individually. Many /v1/usage-compatible endpoints (including
  // some third-party proxies) only accept a single "date" parameter, not a range.
  const dates: string[] = [];
  for (let i = 13; i >= 0; i--) {
    dates.push(dateDaysAgo(i));
  }

  const dayMap: Record<string, number> = {};
  const results = await Promise.all(
    dates.map((date) => fetchUsageForDate(baseUrl, config.apiKey, date).then((cents) => ({ date, cents })))
  );
  results.forEach(({ date, cents }) => {
    dayMap[date] = cents;
  });

  const pricePerToken = (config.pricePer1mTokens || 5.0) / 1_000_000;
  const centsToday = dayMap[today] || 0;
  const tokensToday = Math.round((centsToday / 100) / pricePerToken);

  let centsWeek = 0;
  for (let i = 0; i < 7; i++) {
    centsWeek += dayMap[dateDaysAgo(i)] || 0;
  }
  const tokensWeek = Math.round((centsWeek / 100) / pricePerToken);

  const recentDays: number[] = [];
  for (let i = 13; i >= 0; i--) {
    recentDays.push(Math.round((dayMap[dateDaysAgo(i)] || 0) / 100 / pricePerToken));
  }

  return buildSnapshot(tokensToday, tokensWeek, recentDays, config, monthlyQuota, quotaSource);
}

/**
 * The subscription/hard-limit endpoint (/dashboard/billing/subscription) only
 * accepts a browser session key, NOT an API secret key, so it cannot be fetched
 * here. We fall back to the configured monthlyQuota.
 */
async function fetchMonthlyQuota(config: FetcherConfig): Promise<{ monthlyQuota: number; quotaSource: "subscription" | "manual" }> {
  return { monthlyQuota: config.monthlyQuota, quotaSource: "manual" };
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
