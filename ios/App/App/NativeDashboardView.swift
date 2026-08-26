import SwiftUI

struct NativeDashboardView: View {
    @State private var selectedTab = 0
    @State private var searchText = ""
    @State private var showProfile = false

    var body: some View {
        TabView(selection: $selectedTab) {
            HomeView(searchText: $searchText, showProfile: $showProfile, selectedTab: $selectedTab).tabItem { Label("Home", systemImage: "house.fill") }.tag(0)
            MarketsView(searchText: $searchText, showProfile: $showProfile).tabItem { Label("Markets", systemImage: "chart.line.uptrend.xyaxis") }.tag(1)
            NewsView(showProfile: $showProfile).tabItem { Label("News", systemImage: "newspaper.fill") }.tag(2)
            WalletView(showProfile: $showProfile).tabItem { Label("Wallet", systemImage: "wallet.pass.fill") }.tag(3)
        }.tint(Theme.accent).sheet(isPresented: $showProfile) { ProfileView() }
    }
}
