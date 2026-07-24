import WidgetKit
import SwiftUI

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> UsageEntry {
        UsageEntry.mock()
    }

    func getSnapshot(in context: Context, completion: @escaping (UsageEntry) -> Void) {
        Task {
            let entry = await fetchEntry()
            completion(entry)
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<UsageEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            // Refresh every 15 minutes; macOS widgets may be throttled by the system.
            let nextUpdate = Calendar.current.date(byAdding: .minute, value: 15, to: entry.date) ?? entry.date
            let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
            completion(timeline)
        }
    }

    private func fetchEntry() async -> UsageEntry {
        let config = UsageProvider.loadConfig()
        do {
            let snapshot = try await UsageProvider.fetchSnapshot(config: config)
            return UsageEntry(date: snapshot.updatedAt, snapshot: snapshot)
        } catch {
            var fallback = UsageEntry.mock()
            fallback.snapshot.updatedAt = Date()
            return fallback
        }
    }
}

struct UsageEntry: TimelineEntry {
    let date: Date
    var snapshot: UsageSnapshot

    static func mock() -> UsageEntry {
        let monthlyQuota = 150_000_000
        let (dailyLimit, weeklyLimit) = UsageProvider.deriveLimits(monthlyQuota: monthlyQuota)
        let tokensToday = Int(Double(dailyLimit) * 0.92)
        let tokensWeek = Int(Double(weeklyLimit) * 0.39)
        return UsageEntry(
            date: Date(),
            snapshot: UsageSnapshot(
                updatedAt: Date(),
                tokensToday: tokensToday,
                tokensWeek: tokensWeek,
                monthlyQuota: monthlyQuota,
                dailyLimit: dailyLimit,
                weeklyLimit: weeklyLimit,
                dayPercent: 92,
                weekPercent: 39,
                dayRemainingLabel: "4h",
                weekRemainingLabel: "5d",
                recentDays: UsageProvider.generateRecentDays(todayValue: tokensToday, count: 14),
                quotaSource: "manual"
            )
        )
    }
}

struct CodexUsageWidgetEntryView: View {
    var entry: Provider.Entry
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .systemLarge, .systemExtraLarge:
            largeWidget
        default:
            mediumWidget
        }
    }

    private var mediumWidget: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            Spacer()
            mainBody
            Spacer()
            footer
        }
        .padding(16)
        .containerBackground(.clear, for: .widget)
    }

    private var largeWidget: some View {
        mediumWidget
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Codex Usage")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(.white)
                HStack(spacing: 5) {
                    Circle()
                        .fill(Color.green)
                        .frame(width: 6, height: 6)
                    Text(formatUpdatedAt(entry.snapshot.updatedAt))
                        .font(.system(size: 11))
                        .foregroundColor(.gray)
                }
            }
            Spacer()
            Button(intent: RefreshCodexUsageIntent()) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.white.opacity(0.9))
            }
            .buttonStyle(.plain)
        }
    }

    private var mainBody: some View {
        HStack(alignment: .lastTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(UsageProvider.formatTokens(entry.snapshot.tokensToday))
                    .font(.system(size: 34, weight: .bold))
                    .foregroundColor(.white)
                Text("tokens today")
                    .font(.system(size: 12))
                    .foregroundColor(.gray)
            }
            Spacer()
            activityBars
        }
    }

    private var activityBars: some View {
        let values = entry.snapshot.recentDays
        let max = max(values.max() ?? 1, 1)
        return HStack(alignment: .bottom, spacing: 3) {
            ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                let isToday = index == values.count - 1
                let height = max(8, CGFloat(value) / CGFloat(max) * 30)
                RoundedRectangle(cornerRadius: 2)
                    .fill(isToday ? Color.green : Color.green.opacity(0.35))
                    .frame(width: 4, height: height)
            }
        }
        .frame(height: 32)
    }

    private var footer: some View {
        VStack(spacing: 10) {
            progressRow(
                label: "Day",
                percent: entry.snapshot.dayPercent,
                remaining: entry.snapshot.dayRemainingLabel
            )
            progressRow(
                label: "Week",
                percent: entry.snapshot.weekPercent,
                remaining: entry.snapshot.weekRemainingLabel
            )
        }
    }

    private func progressRow(label: String, percent: Double, remaining: String) -> some View {
        HStack(spacing: 10) {
            Text(label)
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.gray)
                .frame(width: 40, alignment: .leading)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color.white.opacity(0.1))
                        .frame(height: 7)
                    RoundedRectangle(cornerRadius: 4)
                        .fill(LinearGradient(
                            gradient: Gradient(colors: [Color.green, Color.green.opacity(0.8)]),
                            startPoint: .leading,
                            endPoint: .trailing
                        ))
                        .frame(width: max(0, min(geo.size.width, geo.size.width * CGFloat(percent) / 100)), height: 7)
                }
            }
            .frame(height: 7)

            Text("\(Int(percent))%")
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(.white)
                .frame(width: 40, alignment: .trailing)

            Text(remaining)
                .font(.system(size: 12))
                .foregroundColor(.gray)
                .frame(width: 26, alignment: .trailing)
        }
    }

    private func formatUpdatedAt(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return "Updated at \(formatter.string(from: date))"
    }
}

struct CodexUsageWidget: Widget {
    let kind: String = "CodexUsageWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            CodexUsageWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Codex Usage")
        .description("Monitor your Codex token quota at a glance.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

#Preview(as: .systemMedium) {
    CodexUsageWidget()
} timeline: {
    UsageEntry.mock()
}
