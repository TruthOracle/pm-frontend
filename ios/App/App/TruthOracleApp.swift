import SwiftUI

/// Shared application state for navigation, wallet presentation, and saved markets.
final class AppSession: ObservableObject {
    @Published var tab = 0
    @Published var walletConnected = false
    @Published var walletPresented = false
    @Published var selectedMarket: NativeMarket?
    @Published var saved: Set<String> = ["major-ai-launch"]

    func toggleSave(_ market: NativeMarket) {
        if saved.contains(market.id) {
            saved.remove(market.id)
        } else {
            saved.insert(market.id)
        }
    }
}

/// Native iOS entry view hosted by `SceneDelegate`.
struct TruthOracleRootView: View {
    @StateObject private var session = AppSession()

    var body: some View {
        ZStack(alignment: .bottom) {
            Theme.canvas.ignoresSafeArea()
            selectedFeature
                .environmentObject(session)
                .padding(.bottom, 68)
            AppTabBar(selection: $session.tab)
        }
        .preferredColorScheme(.dark)
        .accentColor(Theme.green)
        .sheet(item: $session.selectedMarket) { market in
            MarketDetailView(market: market).environmentObject(session)
        }
        .sheet(isPresented: $session.walletPresented) {
            WalletSheet().environmentObject(session)
        }
    }

    @ViewBuilder
    private var selectedFeature: some View {
        switch session.tab {
        case 0: DiscoverView()
        case 1: MarketsView()
        case 2: SignalsView()
        default: PortfolioView()
        }
    }
}

private struct AppTabBar: View {
    @Binding var selection: Int
    private let tabs = [
        ("Discover", "sparkles"),
        ("Markets", "chart.xyaxis.line"),
        ("Signals", "bolt.horizontal.fill"),
        ("Portfolio", "wallet.pass.fill")
    ]

    var body: some View {
        HStack(spacing: 3) {
            ForEach(tabs.indices, id: \.self) { index in
                Button {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.78)) { selection = index }
                } label: {
                    VStack(spacing: 5) {
                        Image(systemName: tabs[index].1).font(.system(size: 17, weight: .semibold))
                        Text(tabs[index].0).font(.system(size: 10, weight: .semibold, design: .rounded))
                    }
                    .foregroundColor(selection == index ? Theme.green : Theme.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 9)
                    .background(Capsule().fill(selection == index ? Theme.green.opacity(0.1) : Color.clear))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 9).padding(.top, 8).padding(.bottom, 2)
        .background(.ultraThinMaterial)
        .overlay(alignment: .top) { Rectangle().fill(Theme.stroke).frame(height: 1) }
    }
}
