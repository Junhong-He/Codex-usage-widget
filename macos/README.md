# macOS Codex Usage Widget

A macOS desktop widget built with WidgetKit that mirrors the design from the reference screenshot.

## Project Structure

```
macos/
├── CodexUsageWidget/
│   ├── App/                         # Host app (settings)
│   │   ├── CodexUsageWidgetApp.swift
│   │   └── CodexUsageWidget.entitlements
│   ├── Widget/                      # WidgetKit extension
│   │   ├── CodexUsageWidgetBundle.swift
│   │   ├── CodexUsageWidget.swift
│   │   └── CodexUsageWidgetExtension.entitlements
│   └── Shared/                      # Shared code (Data + Network)
│       └── UsageData.swift
└── project.yml                      # XcodeGen spec
```

## Requirements

- macOS 14.0+
- Xcode 15+
- An Apple Developer account (free account works for local install; paid account needed for distribution)

## Build Option 1: XcodeGen (recommended)

1. Install [XcodeGen](https://github.com/yonaskolb/XcodeGen):
   ```bash
   brew install xcodegen
   ```
2. Generate the Xcode project:
   ```bash
   cd macos
   xcodegen generate
   ```
3. Open `CodexUsageWidget.xcodeproj` in Xcode.
4. Select your team in Signing & Capabilities for both the **CodexUsageWidget** target and the **CodexUsageWidgetExtension** target.
5. Make sure both targets have the **App Group** capability enabled for `group.com.codexusage.widget`.
6. Build and run the host app once, then add the widget to your desktop or Notification Center.

## Build Option 2: Manual Xcode Project

1. Open Xcode → Create New Project → macOS → App.
2. Name it **CodexUsageWidget**, bundle ID `com.codexusage.widget`.
3. Add a new target: File → New → Target → Widget Extension → name it **CodexUsageWidgetExtension**.
4. Replace the generated source files with the ones in this folder:
   - Host app: `CodexUsageWidget/App/CodexUsageWidgetApp.swift`
   - Widget: `CodexUsageWidget/Widget/*.swift`
   - Shared: `CodexUsageWidget/Shared/UsageData.swift`
5. Add the shared Swift file to both targets.
6. Enable **App Groups** for both targets and check `group.com.codexusage.widget`.
7. Enable **Outgoing Connections (Client)** for both targets.
8. Build and run.

## Configuration

1. Launch the host app **Codex Usage**.
2. Enter your OpenAI / Codex API key.
3. Choose **OpenAI / Codex** as the provider (or **Mock** for demo data).
4. Set **Price per 1M tokens** (default 5.0 USD) so the app can convert your subscription dollar limit to a token quota.
5. Set **Monthly quota fallback** for when the subscription endpoint is unavailable. Daily limit = monthly / 30, weekly limit = monthly / 4.
6. Save.
7. Add the widget to your desktop via Control-click on the desktop → Edit Widgets.

> Note: The widget uses a shared App Group to read the settings saved by the host app. Without the App Group capability, the widget will always fall back to mock data.

## Usage API Notes

The widget fetches:

1. **Monthly quota**: OpenAI `/dashboard/billing/subscription` returns `hard_limit_usd` / `system_hard_limit_usd`. The app converts this dollar limit to tokens using the configured **Price per 1M tokens**.
2. **Daily usage**: OpenAI `/v1/usage?date=YYYY-MM-DD` returns billing in cents, converted to tokens using a rough heuristic (`1 token ≈ $0.000005`).

If Codex exposes a dedicated quota/usage endpoint, replace the URL and parsing logic in `UsageData.swift`.
