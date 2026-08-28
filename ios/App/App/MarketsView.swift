import SwiftUI

struct MarketsView: View {
    @State private var query = ""
    @State private var category = "All"
    @State private var volumeSort = false

    private let categories = ["All", "Macro", "Tech", "Crypto", "Politics", "Business"]

    private var markets: [NativeMarket] {
        var value = NativeData.markets.filter {
            (category == "All" || $0.category.caseInsensitiveCompare(category) == .orderedSame) &&
            (query.isEmpty || $0.question.localizedCaseInsensitiveContains(query) || $0.category.localizedCaseInsensitiveContains(query))
        }
        if volumeSort { value.sort { $0.volume > $1.volume } }
        return value
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: 17) {
                PageHeader(eyebrow: "REAL-TIME ODDS", title: "Markets", subtitle: "Trade conviction, not noise.", symbol: "slider.horizontal.3") { volumeSort.toggle() }
                SearchField(text: $query, placeholder: "Search active markets")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(categories, id: \.self) { item in
                            Chip(title: item, active: category == item) { withAnimation { category = item } }
                        }
                    }
                }
                HStack {
                    Text("\(markets.count) ACTIVE MARKETS").font(.system(size: 9, weight: .bold)).tracking(1).foregroundColor(Theme.muted)
                    Spacer()
                    if volumeSort { Label("Volume", systemImage: "arrow.down").font(.system(size: 9, weight: .bold)).foregroundColor(Theme.green) }
                }
                if markets.isEmpty {
                    EmptyState()
                } else {
                    ForEach(markets) { FullMarketCard(market: $0) }
                }
            }
            .padding(.horizontal, 18).padding(.top, 18).padding(.bottom, 28)
        }
        .background(AppBackdrop())
    }
}

struct CompactMarketCard: View {
    @EnvironmentObject private var session: AppSession
    let market: NativeMarket

    var body: some View {
        Button { session.selectedMarket = market } label: {
            VStack(alignment: .leading, spacing: 13) {
                HStack {
                    MarketIcon(market: market, size: 34)
                    Text(market.category).font(.system(size: 8, weight: .bold)).tracking(0.9).foregroundColor(Theme.green)
                    Spacer()
                    SaveButton(market: market)
                }
                Text(market.question).font(.system(size: 17, weight: .bold, design: .rounded)).foregroundColor(Theme.text).multilineTextAlignment(.leading).lineLimit(3)
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("\(market.yesProbability)¢").font(.system(size: 26, weight: .bold, design: .rounded)).foregroundColor(Theme.green)
                        Text("YES PRICE").font(.system(size: 7, weight: .bold)).tracking(0.6).foregroundColor(Theme.muted)
                    }
                    Sparkline(values: market.history, color: market.change >= 0 ? Theme.green : Theme.red).frame(height: 40)
                }
                HStack {
                    Label(market.volume, systemImage: "chart.bar.fill")
                    Spacer()
                    Label(market.expiry, systemImage: "clock")
                }.font(.system(size: 9, weight: .semibold)).foregroundColor(Theme.muted)
            }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading).oracleCard(20)
        }
        .buttonStyle(PressStyle())
    }
}

private struct FullMarketCard: View {
    @EnvironmentObject private var session: AppSession
    let market: NativeMarket

    var body: some View {
        Button { session.selectedMarket = market } label: {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    MarketIcon(market: market, size: 40)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(market.category)
                            if market.isHot { Text("HOT").foregroundColor(Theme.amber) }
                        }.font(.system(size: 8, weight: .bold)).foregroundColor(Theme.green)
                        Label(market.expiry, systemImage: "clock").font(.system(size: 9)).foregroundColor(Theme.muted)
                    }
                    Spacer()
                    SaveButton(market: market)
                }
                Text(market.question).font(.system(size: 18, weight: .bold, design: .rounded)).foregroundColor(Theme.text).multilineTextAlignment(.leading)
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("\(market.yesProbability)%").font(.system(size: 29, weight: .bold, design: .rounded)).foregroundColor(Theme.text).monospacedDigit()
                        Text("CHANCE").font(.system(size: 7, weight: .bold)).tracking(0.7).foregroundColor(Theme.muted)
                    }
                    Sparkline(values: market.history, color: market.change >= 0 ? Theme.green : Theme.red, fill: true).frame(height: 60)
                }
                HStack(spacing: 9) {
                    OutcomePill(title: "Yes", price: market.yesProbability, color: Theme.green)
                    OutcomePill(title: "No", price: market.noProbability, color: Theme.red)
                }
                HStack {
                    Label(market.volume, systemImage: "chart.bar.fill")
                    Spacer()
                    Label("\(market.change > 0 ? "+" : "")\(market.change, specifier: "%.1f")%", systemImage: market.change >= 0 ? "arrow.up.right" : "arrow.down.right")
                        .foregroundColor(market.change >= 0 ? Theme.green : Theme.red)
                }.font(.system(size: 9, weight: .semibold)).foregroundColor(Theme.muted)
            }.padding(17).oracleCard()
        }
        .buttonStyle(PressStyle())
    }
}
