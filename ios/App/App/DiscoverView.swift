import SwiftUI

struct DiscoverView: View {
    @EnvironmentObject private var session: AppSession
    @State private var query = ""
    @State private var notifications = 3

    private var results: [NativeMarket] {
        query.isEmpty ? NativeData.markets : NativeData.markets.filter {
            $0.question.localizedCaseInsensitiveContains(query) ||
            $0.category.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: 22) {
                appHeader
                SearchField(text: $query, placeholder: "Search markets, events, or signals")

                if query.isEmpty {
                    HeroMarketCard(market: NativeData.markets[0])
                    PulseStrip()
                }

                SectionHeader(
                    eyebrow: query.isEmpty ? "DISCOVER" : "SEARCH RESULTS",
                    title: query.isEmpty ? "Markets moving now" : "\(results.count) matches",
                    action: query.isEmpty ? "See all" : nil
                ) { session.tab = 1 }

                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 13) {
                        ForEach(results) { market in
                            CompactMarketCard(market: market).frame(width: 282)
                        }
                    }.padding(.horizontal, 1)
                }

                if query.isEmpty {
                    SectionHeader(eyebrow: "INTELLIGENCE", title: "Signals for you", action: "Open desk") { session.tab = 2 }
                    ForEach(NativeData.news.prefix(3)) { SignalRow(item: $0) }
                }
            }
            .padding(.horizontal, 18).padding(.top, 12).padding(.bottom, 28)
        }
        .background(AppBackdrop())
    }

    private var appHeader: some View {
        HStack(spacing: 11) {
            ZStack {
                RoundedRectangle(cornerRadius: 13)
                    .fill(LinearGradient(colors: [Theme.green, Theme.cyan], startPoint: .topLeading, endPoint: .bottomTrailing))
                Image("TruthOracleLogo").resizable().scaledToFit().padding(5)
            }
            .frame(width: 44, height: 44)

            VStack(alignment: .leading, spacing: 2) {
                Text("TruthOracle").font(.system(size: 20, weight: .bold, design: .rounded)).foregroundColor(Theme.text)
                HStack(spacing: 5) {
                    Circle().fill(Theme.green).frame(width: 6, height: 6)
                    Text("CANTON NETWORK · LIVE").font(.system(size: 8, weight: .bold)).tracking(0.8).foregroundColor(Theme.muted)
                }
            }
            Spacer()
            Button { notifications = 0 } label: {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "bell.fill").foregroundColor(Theme.text).frame(width: 42, height: 42).background(Circle().fill(Theme.surface))
                    if notifications > 0 {
                        Text("\(notifications)").font(.system(size: 8, weight: .bold)).foregroundColor(Theme.canvas).frame(width: 16, height: 16).background(Circle().fill(Theme.green)).offset(x: 2, y: -2)
                    }
                }
            }
            .buttonStyle(.plain)
        }
    }
}

private struct HeroMarketCard: View {
    @EnvironmentObject private var session: AppSession
    let market: NativeMarket

    var body: some View {
        Button { session.selectedMarket = market } label: {
            VStack(alignment: .leading, spacing: 17) {
                HStack {
                    LiveBadge(text: "LIVE MARKET")
                    Spacer()
                    Label(market.expiry, systemImage: "clock.fill").font(.system(size: 10, weight: .semibold)).foregroundColor(Theme.muted)
                }
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 7) {
                        Text(market.category).font(.system(size: 9, weight: .bold)).tracking(1.1).foregroundColor(Theme.green)
                        Text(market.question).font(.system(size: 23, weight: .bold, design: .rounded)).foregroundColor(Theme.text).multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 2)
                    VStack(alignment: .trailing, spacing: 0) {
                        Text("\(market.yesProbability)%").font(.system(size: 38, weight: .bold, design: .rounded)).monospacedDigit().foregroundColor(Theme.green)
                        Text("YES").font(.system(size: 9, weight: .bold)).tracking(1).foregroundColor(Theme.muted)
                    }
                }
                Sparkline(values: market.history, color: Theme.green, fill: true).frame(height: 86)
                HStack(spacing: 9) {
                    OutcomePill(title: "Buy Yes", price: market.yesProbability, color: Theme.green)
                    OutcomePill(title: "Buy No", price: market.noProbability, color: Theme.red)
                }
                HStack {
                    Label("+\(market.change, specifier: "%.1f")% today", systemImage: "arrow.up.right").foregroundColor(Theme.green)
                    Spacer()
                    Text("\(market.volume) volume").foregroundColor(Theme.muted)
                }.font(.system(size: 10, weight: .semibold))
            }
            .padding(20)
            .background(
                RoundedRectangle(cornerRadius: 27, style: .continuous)
                    .fill(LinearGradient(colors: [Color(hex: 0x15352D), Theme.surface], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .overlay(RoundedRectangle(cornerRadius: 27).stroke(Theme.green.opacity(0.18)))
            )
        }
        .buttonStyle(PressStyle())
    }
}

private struct PulseStrip: View {
    private let stats = [
        ("24H VOLUME", "54.5K CC", "+12.8%"),
        ("ACTIVE", "24", "6 closing"),
        ("TRADERS", "3,842", "+184 today")
    ]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(stats.indices, id: \.self) { index in
                VStack(alignment: .leading, spacing: 4) {
                    Text(stats[index].0).font(.system(size: 7, weight: .bold)).tracking(0.7).foregroundColor(Theme.muted)
                    Text(stats[index].1).font(.system(size: 13, weight: .bold, design: .rounded)).foregroundColor(Theme.text)
                    Text(stats[index].2).font(.system(size: 8, weight: .semibold)).foregroundColor(index == 1 ? Theme.amber : Theme.green)
                }.frame(maxWidth: .infinity, alignment: .leading)
                if index < stats.count - 1 { Rectangle().fill(Theme.stroke).frame(width: 1, height: 40) }
            }
        }.padding(.vertical, 14).padding(.horizontal, 15).oracleCard(17)
    }
}
