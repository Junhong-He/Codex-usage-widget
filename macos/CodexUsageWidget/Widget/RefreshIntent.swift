import AppIntents
import WidgetKit

struct RefreshCodexUsageIntent: AppIntent {
    static var title: LocalizedStringResource = "Refresh Codex Usage"
    static var description = IntentDescription("Fetch the latest Codex usage data.")

    func perform() async throws -> some IntentResult {
        // Force the widget timeline to reload so the provider fetches fresh data.
        WidgetCenter.shared.reloadTimelines(ofKind: "CodexUsageWidget")
        return .result()
    }
}
