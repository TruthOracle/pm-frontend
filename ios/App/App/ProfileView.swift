import SwiftUI

struct ProfileView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View { NavigationView { List {
        Section { HStack(spacing: 14) { Circle().fill(Theme.ink).frame(width: 54, height: 54).overlay(Text("AK").font(.headline.bold()).foregroundColor(.white)); VStack(alignment: .leading) { Text("Alex Kumar").font(.headline); Text("alex@truthoracle.app").font(.caption).foregroundColor(Theme.muted) } }; Text("Portfolio value                 $12,840.60"); Text("Total returns                     +$842.20") }
        Section("Account") { Label("Rewards", systemImage: "gift.fill"); Label("Security & privacy", systemImage: "lock.fill"); Label("Preferences", systemImage: "slider.horizontal.3") }
    }.navigationTitle("Profile").toolbar { ToolbarItem(placement: .navigationBarTrailing) { Button("Done") { dismiss() }.foregroundColor(Theme.accent) } } } }
}
