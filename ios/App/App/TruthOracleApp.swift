import SwiftUI

private let oracleGreen = Color(red: 0.075, green: 0.545, blue: 0.38)
private let oracleInk = Color(red: 0.055, green: 0.09, blue: 0.16)
private let oracleCanvas = Color(red: 0.965, green: 0.973, blue: 0.98)

struct TruthOracleRootView: View {
    @State private var tab = 0
    @State private var walletConnected = false

    var body: some View {
        TabView(selection: $tab) {
            HomeView(walletConnected: $walletConnected, selectedTab: $tab).tabItem { Label("Home", systemImage: "house.fill") }.tag(0)
            MarketsView(walletConnected: $walletConnected).tabItem { Label("Markets", systemImage: "chart.xyaxis.line") }.tag(1)
            NewsView().tabItem { Label("News", systemImage: "newspaper.fill") }.tag(2)
            PortfolioView(walletConnected: $walletConnected).tabItem { Label("Portfolio", systemImage: "briefcase.fill") }.tag(3)
        }
        .tint(oracleGreen)
    }
}

private struct HomeView: View {
    @Binding var walletConnected: Bool
    @Binding var selectedTab: Int
    @State private var search = ""
    @State private var selectedMarket: NativeMarket?
    @State private var showWallet = false

    private var markets: [NativeMarket] {
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return q.isEmpty ? NativeData.markets : NativeData.markets.filter { $0.question.localizedCaseInsensitiveContains(q) || $0.category.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        NavigationView {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 22) {
                    topBar
                    searchBar
                    categoryRail
                    heroCard
                    sectionHeader("Trending markets", action: "View all") { selectedTab = 1 }
                    ForEach(markets.prefix(3)) { market in MarketCard(market: market) { selectedMarket = market } }
                    sectionHeader("News & signals", action: "See all") { selectedTab = 2 }
                    ForEach(NativeData.news.prefix(3)) { NewsRow(item: $0) }
                    howItWorks
                }
                .padding(.horizontal, 18).padding(.bottom, 28)
            }
            .background(oracleCanvas.ignoresSafeArea())
            .navigationBarHidden(true)
            .sheet(item: $selectedMarket) { MarketDetailView(market: $0, showWallet: $showWallet) }
            .sheet(isPresented: $showWallet) { WalletSheet(isConnected: $walletConnected) }
        }
    }

    private var topBar: some View {
        HStack(spacing: 9) {
            ZStack {
                RoundedRectangle(cornerRadius: 7, style: .continuous).fill(oracleInk)
                Image("TruthOracleLogo").resizable().scaledToFit().padding(2)
            }.frame(width: 30, height: 30)
            VStack(alignment: .leading, spacing: 0) {
                Text("Truth").font(.headline.bold()) + Text("Oracle").font(.headline.bold()).foregroundColor(oracleGreen)
                Text("PREDICTION MARKETS").font(.system(size: 7, weight: .bold)).tracking(1).foregroundColor(.secondary)
            }
            Spacer()
            Button { showWallet = true } label: {
                Label(walletConnected ? "Connected" : "Connect", systemImage: walletConnected ? "checkmark.circle.fill" : "wallet.pass.fill")
                    .font(.caption.bold()).foregroundColor(walletConnected ? oracleGreen : .white).padding(.horizontal, 12).padding(.vertical, 9)
                    .background(walletConnected ? oracleGreen.opacity(0.12) : oracleInk).clipShape(Capsule())
            }
        }.padding(.top, 10)
    }

    private var searchBar: some View {
        HStack(spacing: 10) { Image(systemName: "magnifyingglass").foregroundColor(oracleGreen); TextField("Search markets, topics, or events", text: $search); if !search.isEmpty { Button { search = "" } label: { Image(systemName: "xmark.circle.fill").foregroundColor(.secondary) } } }
            .font(.subheadline).padding(.horizontal, 14).padding(.vertical, 13).background(Color.white).clipShape(RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.black.opacity(0.06)))
    }

    private var categoryRail: some View {
        ScrollView(.horizontal, showsIndicators: false) { HStack(spacing: 8) { ForEach(["Trending", "Politics", "Crypto", "Business", "Tech", "Sports"], id: \.self) { category in Text(category).font(.caption.weight(.semibold)).foregroundColor(category == "Trending" ? .white : oracleInk).padding(.horizontal, 13).padding(.vertical, 8).background(category == "Trending" ? oracleInk : Color.white).clipShape(Capsule()) } } }
    }

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack { Label("LIVE SIGNAL", systemImage: "dot.radiowaves.left.and.right").font(.caption2.bold()).foregroundColor(oracleGreen); Spacer(); Text("ON-CHAIN").font(.system(size: 9, weight: .bold)).tracking(1).foregroundColor(.secondary) }
            Text("Forecast the future.\nReap the profits.").font(.system(size: 31, weight: .bold, design: .rounded)).foregroundColor(oracleInk)
            Text("Trade Yes/No shares on real-world events with transparent odds and auditable settlement.").font(.subheadline).foregroundColor(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) { StatPill(value: "100%", label: "Auditable"); StatPill(value: "LIVE", label: "Markets"); StatPill(value: "CC", label: "Settlement") }
            Button { selectedTab = 1 } label: { HStack { Text("Explore live markets"); Spacer(); Image(systemName: "arrow.right") }.font(.subheadline.bold()).foregroundColor(.white).padding(14).background(oracleGreen).clipShape(RoundedRectangle(cornerRadius: 12)) }
        }
        .padding(20).background(LinearGradient(colors: [Color.white, Color(red: 0.90, green: 0.97, blue: 0.93)], startPoint: .topLeading, endPoint: .bottomTrailing)).clipShape(RoundedRectangle(cornerRadius: 22)).overlay(RoundedRectangle(cornerRadius: 22).stroke(oracleGreen.opacity(0.12)))
    }

    private var howItWorks: some View { VStack(alignment: .leading, spacing: 12) { Text("How TruthOracle works").font(.headline.bold()); HStack(spacing: 10) { HowStep(number: "01", title: "Connect", icon: "wallet.pass"); HowStep(number: "02", title: "Predict", icon: "chart.line.uptrend.xyaxis"); HowStep(number: "03", title: "Settle", icon: "checkmark.seal") } }.padding(.top, 6) }

    private func sectionHeader(_ title: String, action: String, onTap: @escaping () -> Void) -> some View { HStack { Text(title).font(.title3.bold()).foregroundColor(oracleInk); Spacer(); Button(action: onTap) { HStack(spacing: 4) { Text(action); Image(systemName: "arrow.right") } .font(.caption.bold()).foregroundColor(oracleGreen) } } }
}

private struct MarketsView: View {
    @Binding var walletConnected: Bool
    @State private var query = ""
    @State private var category = "All"
    @State private var selectedMarket: NativeMarket?
    @State private var showWallet = false
    private let categories = ["All", "Trending", "Politics", "Crypto", "Business", "Tech", "Sports"]
    private var filtered: [NativeMarket] { NativeData.markets.filter { ($0.question.localizedCaseInsensitiveContains(query) || $0.category.localizedCaseInsensitiveContains(query) || query.isEmpty) && (category == "All" || category == "Trending" || $0.category == category.uppercased()) } }

    var body: some View {
        NavigationView { ScrollView(showsIndicators: false) { VStack(alignment: .leading, spacing: 16) {
            HStack { VStack(alignment: .leading, spacing: 4) { Text("Markets").font(.largeTitle.bold()); Text("Real-time probabilities shaped by the crowd.").font(.subheadline).foregroundColor(.secondary) }; Spacer(); Button { showWallet = true } label: { Image(systemName: "wallet.pass.fill").foregroundColor(oracleGreen) } }
            HStack { Image(systemName: "magnifyingglass").foregroundColor(oracleGreen); TextField("Search markets", text: $query) }.padding(13).background(Color.white).clipShape(RoundedRectangle(cornerRadius: 12))
            ScrollView(.horizontal, showsIndicators: false) { HStack { ForEach(categories, id: \.self) { item in FilterChip(title: item, active: category == item) { category = item } } } }
            HStack { Text("\(filtered.count) active markets").font(.caption.bold()).foregroundColor(.secondary); Spacer(); Label("LIVE", systemImage: "circle.fill").font(.caption2.bold()).foregroundColor(oracleGreen) }
            ForEach(filtered) { item in MarketCard(market: item) { selectedMarket = item } }
        }.padding(18).padding(.bottom, 28) }.background(oracleCanvas.ignoresSafeArea()).navigationBarHidden(true).sheet(item: $selectedMarket) { MarketDetailView(market: $0, showWallet: $showWallet) }.sheet(isPresented: $showWallet) { WalletSheet(isConnected: $walletConnected) } }
    }
}

private struct NewsView: View {
    @State private var query = ""
    @State private var selectedNews: NativeNewsItem?
    @State private var refreshing = false
    private var filtered: [NativeNewsItem] { NativeData.news.filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) || $0.tag.localizedCaseInsensitiveContains(query) } }
    var body: some View { NavigationView { ScrollView(showsIndicators: false) { VStack(alignment: .leading, spacing: 18) {
        HStack { VStack(alignment: .leading, spacing: 4) { Text("News & signals").font(.largeTitle.bold()); Text("The context behind the markets").font(.subheadline).foregroundColor(.secondary) }; Spacer(); Button { refresh() } label: { Image(systemName: "arrow.clockwise").rotationEffect(.degrees(refreshing ? 360 : 0)).foregroundColor(oracleGreen) } }
        HStack { Image(systemName: "magnifyingglass").foregroundColor(oracleGreen); TextField("Search news", text: $query) }.padding(13).background(Color.white).clipShape(RoundedRectangle(cornerRadius: 12))
        HStack(spacing: 8) { Circle().fill(oracleGreen).frame(width: 7, height: 7); Text("LIVE FROM THE DESK").font(.caption.bold()).tracking(1).foregroundColor(oracleGreen); Spacer(); Text("Updated just now").font(.caption).foregroundColor(.secondary) }
        ForEach(filtered) { item in NewsCard(item: item) { selectedNews = item } }
    }.padding(18).padding(.bottom, 28) }.background(oracleCanvas.ignoresSafeArea()).navigationBarHidden(true).sheet(item: $selectedNews) { NewsDetailView(item: $0) } } }
    private func refresh() { refreshing = true; DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { refreshing = false } }
}

private struct PortfolioView: View {
    @Binding var walletConnected: Bool
    @State private var showWallet = false
    var body: some View { NavigationView { ScrollView(showsIndicators: false) { VStack(alignment: .leading, spacing: 18) { Text("Portfolio").font(.largeTitle.bold()); if walletConnected { VStack(alignment: .leading, spacing: 8) { Text("TOTAL BALANCE").font(.caption.bold()).tracking(1).foregroundColor(.secondary); Text("1,240.50 CC").font(.system(size: 36, weight: .bold, design: .rounded)); Text("+8.4% this week").font(.caption.bold()).foregroundColor(oracleGreen) }.padding(20).frame(maxWidth: .infinity, alignment: .leading).background(Color.white).clipShape(RoundedRectangle(cornerRadius: 18)); Text("Open positions").font(.title3.bold()); PositionRow(title: "Will the next rate decision be a cut?", side: "YES", value: "+42.8 CC", color: oracleGreen); PositionRow(title: "Will a major AI model launch this month?", side: "NO", value: "+18.2 CC", color: .red) } else { emptyPortfolio }; Text("Recent activity").font(.title3.bold()); ActivityRow(icon: "arrow.down.left", title: "Wallet connected", detail: "Today, 10:42 AM"); ActivityRow(icon: "chart.line.uptrend.xyaxis", title: "Position opened", detail: "Yesterday, 4:18 PM") }.padding(18).padding(.bottom, 28) }.background(oracleCanvas.ignoresSafeArea()).navigationBarHidden(true).sheet(isPresented: $showWallet) { WalletSheet(isConnected: $walletConnected) } } }
    private var emptyPortfolio: some View { VStack(spacing: 14) { Image(systemName: "wallet.pass.fill").font(.system(size: 44)).foregroundColor(oracleGreen); Text("Your portfolio starts here").font(.title2.bold()); Text("Connect a Canton wallet to track positions, activity, and payouts.").font(.subheadline).foregroundColor(.secondary).multilineTextAlignment(.center); Button { showWallet = true } label: { Text("Connect wallet").font(.subheadline.bold()).foregroundColor(.white).padding(.horizontal, 22).padding(.vertical, 13).background(oracleInk).clipShape(Capsule()) } }.frame(maxWidth: .infinity).padding(.vertical, 45).padding(.horizontal, 20).background(Color.white).clipShape(RoundedRectangle(cornerRadius: 20)) }
}

private struct MarketCard: View {
    let market: NativeMarket
    let onTap: () -> Void
    var body: some View { Button(action: onTap) { VStack(alignment: .leading, spacing: 12) { HStack { Text(market.category).font(.caption.bold()).foregroundColor(oracleGreen); Spacer(); Label(market.expiry, systemImage: "clock").font(.caption).foregroundColor(.secondary) }; Text(market.question).font(.headline.weight(.semibold)).foregroundColor(oracleInk).multilineTextAlignment(.leading); ProbabilityChart(probability: Double(market.yesProbability) / 100).frame(height: 72); HStack(spacing: 8) { OutcomeButton(title: "YES", value: "\(market.yesProbability)%", color: oracleGreen); OutcomeButton(title: "NO", value: "\(100 - market.yesProbability)%", color: .red) }; HStack { Text("Volume \(market.volume)"); Spacer(); Text("View details").foregroundColor(oracleGreen) }.font(.caption).foregroundColor(.secondary) }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(Color.white).clipShape(RoundedRectangle(cornerRadius: 18)).overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.black.opacity(0.055))) }.buttonStyle(.plain) }
}

private struct NewsCard: View { let item: NativeNewsItem; let onTap: () -> Void; var body: some View { Button(action: onTap) { HStack(spacing: 14) { Image(systemName: item.symbol).font(.title3).frame(width: 52, height: 52).background(oracleGreen.opacity(0.11)).foregroundColor(oracleGreen).clipShape(RoundedRectangle(cornerRadius: 14)); VStack(alignment: .leading, spacing: 5) { Text(item.tag).font(.caption2.bold()).tracking(1).foregroundColor(oracleGreen); Text(item.title).font(.subheadline.bold()).foregroundColor(oracleInk).multilineTextAlignment(.leading); Text("\(item.source) · \(item.time)").font(.caption).foregroundColor(.secondary) }; Spacer(); Image(systemName: "chevron.right").font(.caption.bold()).foregroundColor(.secondary) }.padding(12).background(Color.white).clipShape(RoundedRectangle(cornerRadius: 16)) }.buttonStyle(.plain) } }
private struct NewsRow: View { let item: NativeNewsItem; var body: some View { HStack(spacing: 12) { Image(systemName: item.symbol).frame(width: 42, height: 42).background(oracleGreen.opacity(0.11)).foregroundColor(oracleGreen).clipShape(RoundedRectangle(cornerRadius: 11)); VStack(alignment: .leading, spacing: 4) { Text(item.tag).font(.caption2.bold()).foregroundColor(oracleGreen); Text(item.title).font(.subheadline.bold()).foregroundColor(oracleInk).lineLimit(2); Text("\(item.source) · \(item.time)").font(.caption).foregroundColor(.secondary) } } } }

private struct MarketDetailView: View { let market: NativeMarket; @Binding var showWallet: Bool; @Environment(\.dismiss) private var dismiss; var body: some View { NavigationView { ScrollView { VStack(alignment: .leading, spacing: 20) { Text(market.category).font(.caption.bold()).tracking(1).foregroundColor(oracleGreen); Text(market.question).font(.title.bold()); HStack { Text("Market probability").font(.subheadline).foregroundColor(.secondary); Spacer(); Text("Updated live").font(.caption.bold()).foregroundColor(oracleGreen) }; ProbabilityChart(probability: Double(market.yesProbability) / 100).frame(height: 150); HStack(spacing: 10) { TradeButton(title: "Buy YES", probability: market.yesProbability, color: oracleGreen) { showWallet = true }; TradeButton(title: "Buy NO", probability: 100 - market.yesProbability, color: .red) { showWallet = true } }; InfoRow(label: "Market volume", value: market.volume); InfoRow(label: "Settlement", value: "Canton Network"); InfoRow(label: "Closes", value: market.expiry); Text("Connect your wallet to trade this market. All outcomes settle transparently on-chain.").font(.subheadline).foregroundColor(.secondary); Spacer() }.padding(22) }.background(oracleCanvas.ignoresSafeArea()).navigationTitle("Market").navigationBarTitleDisplayMode(.inline).toolbar { ToolbarItem(placement: .navigationBarTrailing) { Button("Done") { dismiss() }.foregroundColor(oracleGreen) } } } } }
private struct NewsDetailView: View { let item: NativeNewsItem; var body: some View { NavigationView { VStack(alignment: .leading, spacing: 16) { Text(item.tag).font(.caption.bold()).tracking(1).foregroundColor(oracleGreen); Text(item.title).font(.title.bold()); Text("\(item.source) · \(item.time)").font(.subheadline).foregroundColor(.secondary); Divider(); Text("This story connects market context with the signals traders are watching. Live publisher content can be plugged into the native URLSession service here.").font(.body).foregroundColor(.secondary); Spacer() }.padding(22).navigationTitle("Story").navigationBarTitleDisplayMode(.inline) } } }

private struct WalletSheet: View { @Binding var isConnected: Bool; @Environment(\.dismiss) private var dismiss; @State private var connectRequest = 0; @State private var bridgeError: String?; var body: some View { NavigationView { VStack(spacing: 18) { Image(systemName: "wallet.pass.fill").font(.system(size: 46)).foregroundColor(oracleGreen); Text(isConnected ? "Wallet connected" : "Connect your wallet").font(.title2.bold()); Text(isConnected ? "Your Canton wallet is ready for markets and payouts." : "Use your Canton wallet to trade markets and manage your positions.").font(.subheadline).foregroundColor(.secondary).multilineTextAlignment(.center); if let bridgeError { Text(bridgeError).font(.caption).foregroundColor(.red).multilineTextAlignment(.center) }; Button { connectRequest += 1 } label: { HStack { Image(systemName: "link"); Text(isConnected ? "Continue" : "Connect Canton wallet") }.font(.subheadline.bold()).foregroundColor(.white).frame(maxWidth: .infinity).padding(15).background(oracleInk).clipShape(RoundedRectangle(cornerRadius: 13)) }.padding(.top, 12); Spacer(); Cantor8WalletBridge(isConnected: $isConnected, connectRequest: $connectRequest, errorMessage: $bridgeError).frame(width: 1, height: 1) }.padding(24).navigationTitle("Wallet").navigationBarTitleDisplayMode(.inline).onChange(of: isConnected) { connected in if connected { dismiss() } } } } }

private struct ProbabilityChart: View { let probability: Double; var body: some View { GeometryReader { proxy in ZStack { Path { path in let p = chartPoints(in: proxy.size); path.move(to: p[0]); for point in p.dropFirst() { path.addLine(to: point) } }.stroke(oracleGreen, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round)); Path { path in let p = chartPoints(in: proxy.size); path.move(to: CGPoint(x: 0, y: proxy.size.height)); for point in p { path.addLine(to: point) }; path.addLine(to: CGPoint(x: proxy.size.width, y: proxy.size.height)); path.closeSubpath() }.fill(oracleGreen.opacity(0.10)) } }.background(RoundedRectangle(cornerRadius: 10).fill(oracleCanvas)) }
    private func chartPoints(in size: CGSize) -> [CGPoint] { [CGPoint(x: 0, y: size.height * 0.78), CGPoint(x: size.width * 0.18, y: size.height * 0.65), CGPoint(x: size.width * 0.36, y: size.height * 0.70), CGPoint(x: size.width * 0.54, y: size.height * 0.42), CGPoint(x: size.width * 0.72, y: size.height * 0.50), CGPoint(x: size.width, y: size.height * (1 - probability))] }
}

private struct StatPill: View { let value: String; let label: String; var body: some View { VStack(alignment: .leading, spacing: 2) { Text(value).font(.caption.bold()).foregroundColor(oracleInk); Text(label).font(.system(size: 9)).foregroundColor(.secondary) }.frame(maxWidth: .infinity, alignment: .leading) } }
private struct HowStep: View { let number: String; let title: String; let icon: String; var body: some View { VStack(alignment: .leading, spacing: 6) { Image(systemName: icon).foregroundColor(oracleGreen); Text(number).font(.system(size: 9, weight: .bold)).foregroundColor(.secondary); Text(title).font(.caption.bold()).foregroundColor(oracleInk) }.frame(maxWidth: .infinity, alignment: .leading).padding(12).background(Color.white).clipShape(RoundedRectangle(cornerRadius: 12)) } }
private struct FilterChip: View { let title: String; let active: Bool; let action: () -> Void; var body: some View { Button(action: action) { Text(title).font(.caption.bold()).foregroundColor(active ? .white : oracleInk).padding(.horizontal, 12).padding(.vertical, 8).background(active ? oracleInk : Color.white).clipShape(Capsule()) } } }
private struct OutcomeButton: View { let title: String; let value: String; let color: Color; var body: some View { HStack { Text(title); Spacer(); Text(value).bold() }.font(.caption.bold()).foregroundColor(color).padding(10).background(color.opacity(0.11)).clipShape(RoundedRectangle(cornerRadius: 9)) } }
private struct TradeButton: View { let title: String; let probability: Int; let color: Color; let action: () -> Void; var body: some View { Button(action: action) { VStack(spacing: 4) { Text(title).font(.subheadline.bold()); Text("\(probability)%").font(.caption) }.foregroundColor(.white).frame(maxWidth: .infinity).padding(13).background(color).clipShape(RoundedRectangle(cornerRadius: 12)) } } }
private struct InfoRow: View { let label: String; let value: String; var body: some View { HStack { Text(label).foregroundColor(.secondary); Spacer(); Text(value).fontWeight(.semibold).foregroundColor(oracleInk) }.font(.subheadline).padding(.vertical, 4) } }
private struct PositionRow: View { let title: String; let side: String; let value: String; let color: Color; var body: some View { HStack { Circle().fill(color.opacity(0.13)).frame(width: 38, height: 38).overlay(Text(side).font(.caption2.bold()).foregroundColor(color)); VStack(alignment: .leading) { Text(title).font(.subheadline.bold()); Text(side + " position").font(.caption).foregroundColor(.secondary) }; Spacer(); Text(value).font(.subheadline.bold()).foregroundColor(color) }.padding(12).background(Color.white).clipShape(RoundedRectangle(cornerRadius: 14)) } }
private struct ActivityRow: View { let icon: String; let title: String; let detail: String; var body: some View { HStack(spacing: 12) { Image(systemName: icon).frame(width: 34, height: 34).background(oracleGreen.opacity(0.11)).foregroundColor(oracleGreen).clipShape(Circle()); VStack(alignment: .leading) { Text(title).font(.subheadline.bold()); Text(detail).font(.caption).foregroundColor(.secondary) }; Spacer(); Image(systemName: "chevron.right").font(.caption).foregroundColor(.secondary) }.padding(.vertical, 3) } }
