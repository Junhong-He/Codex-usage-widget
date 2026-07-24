/**
 * Codex / OpenAI usage snapshot.
 */
export interface CodexUsageSnapshot {
  /** ISO timestamp of when the data was fetched */
  updatedAt: string;

  /** Tokens used today */
  tokensToday: number;

  /** Tokens used this week (rolling 7 days or calendar week) */
  tokensWeek: number;

  /** Monthly quota used for calculations (fetched from subscription or configured) */
  monthlyQuota: number;

  /** Daily limit derived from monthly quota (monthly / 30) */
  dailyLimit: number;

  /** Weekly limit derived from monthly quota (monthly / 4) */
  weeklyLimit: number;

  /** Percentage of daily limit consumed (0-100) */
  dayPercent: number;

  /** Percentage of weekly limit consumed (0-100) */
  weekPercent: number;

  /** Estimated time / tokens remaining for the day (shown as "4h") */
  dayRemainingLabel?: string;

  /** Estimated days remaining for the week (shown as "5d") */
  weekRemainingLabel?: string;

  /** Usage for the last N days, oldest first, today last */
  recentDays: number[];

  /** Where the monthly quota came from */
  quotaSource: "subscription" | "manual";
}

export interface FetcherConfig {
  /** OpenAI / Codex API key */
  apiKey: string;

  /** Base URL for the API. Defaults to https://api.openai.com */
  baseUrl?: string;

  /** Manual monthly Codex subscription quota in tokens (fallback when subscription fetch fails) */
  monthlyQuota: number;

  /**
   * Price in USD per 1 million tokens. Used to convert the subscription's
   * monthly dollar limit (hard_limit_usd) into a token quota.
   * Defaults to 5.0 (a blended estimate for Codex CLI usage).
   */
  pricePer1mTokens: number;

  /**
   * How to fetch usage.
   * - "openai-usage": use /v1/usage (daily summary)
   * - "mock": return randomized mock data
   */
  provider: "openai-usage" | "mock";
}
