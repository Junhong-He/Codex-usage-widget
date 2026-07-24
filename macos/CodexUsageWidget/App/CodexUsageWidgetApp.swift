import SwiftUI

@main
struct CodexUsageWidgetApp: App {
    var body: some Scene {
        WindowGroup {
            SettingsView()
                .frame(minWidth: 320, idealWidth: 360, maxWidth: 400,
                       minHeight: 420, idealHeight: 460, maxHeight: 520)
        }
        .windowResizability(.contentSize)
    }
}

struct SettingsView: View {
    @State private var config = UsageProvider.loadConfig()
    @State private var statusMessage = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Codex Usage Settings")
                .font(.title2)
                .fontWeight(.bold)

            Group {
                Text("API Key")
                    .font(.headline)
                SecureField("sk-...", text: $config.apiKey)
                    .textFieldStyle(.roundedBorder)

                Text("Provider")
                    .font(.headline)
                Picker("Provider", selection: $config.provider) {
                    Text("Mock (demo)").tag("mock")
                    Text("OpenAI / Codex").tag("openai-usage")
                }
                .pickerStyle(.segmented)

                Text("Price per 1M tokens (USD)")
                    .font(.headline)
                TextField("5.0", value: $config.pricePer1mTokens, format: .number)
                    .textFieldStyle(.roundedBorder)

                Text("Monthly quota fallback (tokens)")
                    .font(.headline)
                TextField("150000000", value: $config.monthlyQuota, format: .number)
                    .textFieldStyle(.roundedBorder)
            }

            if !statusMessage.isEmpty {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            HStack {
                Button("Reset") {
                    config = .default
                    UsageProvider.saveConfig(config)
                    statusMessage = "Settings reset."
                }
                Spacer()
                Button("Save") {
                    UsageProvider.saveConfig(config)
                    statusMessage = "Saved. The widget will refresh shortly."
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding()
    }
}
