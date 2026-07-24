import Foundation

struct UsageSnapshot: Codable {
    var updatedAt: Date
    var tokensToday: Int
    var tokensWeek: Int
    var monthlyQuota: Int
    var dailyLimit: Int
    var weeklyLimit: Int
    var dayPercent: Double
    var weekPercent: Double
    var dayRemainingLabel: String
    var weekRemainingLabel: String
    var recentDays: [Int]
    var quotaSource: String
}

struct WidgetConfig: Codable {
    var apiKey: String
    var baseURL: String
    var monthlyQuota: Int
    var pricePer1mTokens: Double
    var provider: String

    static let `default` = WidgetConfig(
        apiKey: "",
        baseURL: "https://api.openai.com",
        monthlyQuota: 150_000_000,
        pricePer1mTokens: 5.0,
        provider: "mock"
    )
}

enum UsageProvider {
    static let sharedDefaultsKey = "group.com.codexusage.widget"
    static let configKey = "codex_usage_config"

    static func loadConfig() -> WidgetConfig {
        guard let defaults = UserDefaults(suiteName: sharedDefaultsKey),
              let data = defaults.data(forKey: configKey),
              let config = try? JSONDecoder().decode(WidgetConfig.self, from: data) else {
            return .default
        }
        return config
    }

    static func saveConfig(_ config: WidgetConfig) {
        guard let defaults = UserDefaults(suiteName: sharedDefaultsKey),
              let data = try? JSONEncoder().encode(config) else { return }
        defaults.set(data, forKey: configKey)
    }

    static func deriveLimits(monthlyQuota: Int) -> (dailyLimit: Int, weeklyLimit: Int) {
        return (
            dailyLimit: monthlyQuota / 30,
            weeklyLimit: monthlyQuota / 4
        )
    }

    static func formatTokens(_ n: Int) -> String {
        if n >= 1_000_000 {
            return String(format: "%.2fM", Double(n) / 1_000_000)
        } else if n >= 1_000 {
            return String(format: "%.1fK", Double(n) / 1_000)
        }
        return "\(n)"
    }

    static func fetchSnapshot(config: WidgetConfig) async throws -> UsageSnapshot {
        if config.provider == "mock" || config.apiKey.isEmpty {
            return mockSnapshot(config: config)
        }
        return try await fetchOpenAIUsage(config: config)
    }

    private static func mockSnapshot(config: WidgetConfig) -> UsageSnapshot {
        let (dailyLimit, weeklyLimit) = deriveLimits(monthlyQuota: config.monthlyQuota)
        let dayUsage = 0.55 + Double.random(in: 0...1) * 0.4
        let weekUsage = 0.25 + Double.random(in: 0...1) * 0.55
        let tokensToday = min(config.monthlyQuota, Int(Double(dailyLimit) * dayUsage))
        let tokensWeek = min(config.monthlyQuota, Int(Double(weeklyLimit) * weekUsage))
        let recentDays = generateRecentDays(todayValue: tokensToday, count: 14)
        return buildSnapshot(tokensToday: tokensToday, tokensWeek: tokensWeek, recentDays: recentDays, monthlyQuota: config.monthlyQuota, quotaSource: "manual")
    }

    private static func fetchOpenAIUsage(config: WidgetConfig) async throws -> UsageSnapshot {
        let baseURL = config.baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let today = formatter.string(from: Date())

        let (monthlyQuota, quotaSource) = try await fetchMonthlyQuota(config: config)

        guard let url = URL(string: "\(baseURL)/v1/usage?date=\(today)") else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(config.apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let totalCents = json["total_usage"] as? Double ?? 0
        let tokensToday = Int(totalCents / 0.000005 / 100)
        let tokensWeek = Int(Double(tokensToday) * 2.5)
        let recentDays = generateRecentDays(todayValue: tokensToday, count: 14)
        return buildSnapshot(tokensToday: tokensToday, tokensWeek: tokensWeek, recentDays: recentDays, monthlyQuota: monthlyQuota, quotaSource: quotaSource)
    }

    private static func fetchMonthlyQuota(config: WidgetConfig) async throws -> (monthlyQuota: Int, quotaSource: String) {
        let baseURL = config.baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: "\(baseURL)/dashboard/billing/subscription") else {
            return (config.monthlyQuota, "manual")
        }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(config.apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                return (config.monthlyQuota, "manual")
            }

            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
            let dollarLimit =
                (json["system_hard_limit_usd"] as? Double) ??
                (json["hard_limit_usd"] as? Double) ??
                0

            if dollarLimit <= 0 {
                return (config.monthlyQuota, "manual")
            }

            let pricePerToken = (config.pricePer1mTokens > 0 ? config.pricePer1mTokens : 5.0) / 1_000_000
            let tokens = Int(round(dollarLimit / pricePerToken))
            return (tokens, "subscription")
        } catch {
            return (config.monthlyQuota, "manual")
        }
    }

    private static func buildSnapshot(tokensToday: Int, tokensWeek: Int, recentDays: [Int], monthlyQuota: Int, quotaSource: String) -> UsageSnapshot {
        let (dailyLimit, weeklyLimit) = deriveLimits(monthlyQuota: monthlyQuota)
        let dayPercent = dailyLimit > 0 ? min(100, max(0, Double(tokensToday) / Double(dailyLimit) * 100)) : 0
        let weekPercent = weeklyLimit > 0 ? min(100, max(0, Double(tokensWeek) / Double(weeklyLimit) * 100)) : 0
        let dayRemaining = max(0, dailyLimit - tokensToday)
        let weekRemaining = max(0, weeklyLimit - tokensWeek)

        return UsageSnapshot(
            updatedAt: Date(),
            tokensToday: tokensToday,
            tokensWeek: tokensWeek,
            monthlyQuota: monthlyQuota,
            dailyLimit: dailyLimit,
            weeklyLimit: weeklyLimit,
            dayPercent: dayPercent,
            weekPercent: weekPercent,
            dayRemainingLabel: formatRemaining(dayRemaining, isDay: true),
            weekRemainingLabel: formatRemaining(weekRemaining, isDay: false),
            recentDays: recentDays,
            quotaSource: quotaSource
        )
    }

    static func generateRecentDays(todayValue: Int, count: Int) -> [Int] {
        var days: [Int] = []
        for _ in 0..<(count - 1) {
            days.append(max(0, Int(Double(todayValue) * (0.2 + Double.random(in: 0...1) * 1.0))))
        }
        days.append(todayValue)
        return days
    }

    private static func formatRemaining(_ tokens: Int, isDay: Bool) -> String {
        if isDay {
            let minutes = max(1, Double(tokens) / 100)
            let hours = Int((minutes / 60).rounded())
            if hours < 1 {
                return "\(Int(minutes.rounded()))m"
            }
            return "\(hours)h"
        }
        let days = max(1, Int((Double(tokens) / 2_000_000).rounded()))
        return "\(days)d"
    }
}
