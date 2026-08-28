import SwiftUI

struct MarketDetailView: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss

    let market: NativeMarket

    @State private var outcome = "YES"
    @State private var amount = 25.0
    @State private var ready = false

    private var price: Int { outcome == "YES" ? market.yesProbability : market.noProbability }
    private var shares: Double { amount / (Double(price) / 100) }

    var body: some View {
        NavigationView {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 20) {
                    marketHeader
                    Text(market.question).font(.system(size: 27, weight: .bold, design: .rounded)).foregroundColor(Theme.text)
                    Text(market.subtitle).font(.system(size: 12)).foregroundColor(Theme.muted).lineSpacing(3)
                    ProbabilityCard(market: market)
                    marketStats
                    tradeComposer
                    if ready {
                        OrderBanner(outcome: outcome, amount: amount)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                    ResolutionCard()
                }
                .padding(.horizontal, 18).padding(.top, 10).padding(.bottom, 28)
            }
            .background(AppBackdrop())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("MARKET").font(.system(size: 9, weight: .bold)).tracking(1.3).foregroundColor(Theme.muted)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").foregroundColor(Theme.text).frame(width: 30, height: 30).background(Circle().fill(Theme.raised))
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var marketHeader: some View {
        HStack {
            MarketIcon(market: market, size: 48)
            VStack(alignment: .leading, spacing: 3) {
                Text(market.category).font(.system(size: 9, weight: .bold)).tracking(1).foregroundColor(Theme.green)
                Label("Closes in \(market.expiry)", systemImage: "clock.fill").font(.system(size: 10)).foregroundColor(Theme.muted)
            }
            Spacer()
            SaveButton(market: market)
        }
    }

    private var marketStats: some View {
        HStack(spacing: 8) {
            StatTile(label: "VOLUME", value: market.volume, icon: "chart.bar.fill")
            StatTile(label: "LIQUIDITY", value: market.liquidity, icon: "drop.fill")
            StatTile(label: "TRADERS", value: market.traders, icon: "person.2.fill")
        }
    }

    private var tradeComposer: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("BUILD YOUR POSITION").font(.system(size: 8, weight: .bold)).tracking(1).foregroundColor(Theme.green)
                    Text("Buy outcome shares").font(.system(size: 18, weight: .bold, design: .rounded)).foregroundColor(Theme.text)
                }
                Spacer()
                Image(systemName: "bolt.fill").foregroundColor(Theme.green)
            }
            HStack(spacing: 8) {
                OutcomeSelector(title: "YES", price: market.yesProbability, active: outcome == "YES", color: Theme.green) { outcome = "YES" }
                OutcomeSelector(title: "NO", price: market.noProbability, active: outcome == "NO", color: Theme.red) { outcome = "NO" }
            }
            HStack(alignment: .firstTextBaseline) {
                Text("AMOUNT").font(.system(size: 8, weight: .bold)).tracking(0.8).foregroundColor(Theme.muted)
                Spacer()
                Text("\(amount, specifier: "%.0f")").font(.system(size: 27, weight: .bold, design: .rounded)).foregroundColor(Theme.text)
                Text("CC").font(.system(size: 10, weight: .bold)).foregroundColor(Theme.muted)
            }
            Slider(value: $amount, in: 5...200, step: 5).accentColor(outcome == "YES" ? Theme.green : Theme.red)
            quickAmounts
            tradeSummary
            Button {
                if session.walletConnected {
                    withAnimation(.spring()) { ready = true }
                } else {
                    session.walletPresented = true
                }
            } label: {
                HStack { Image(systemName: "bolt.fill"); Text("Review \(outcome) order"); Spacer(); Image(systemName: "arrow.right") }
                    .font(.system(size: 13, weight: .bold)).foregroundColor(outcome == "YES" ? Theme.canvas : .white)
                    .padding(15).background(RoundedRectangle(cornerRadius: 14).fill(outcome == "YES" ? Theme.green : Theme.red))
            }
        }
        .padding(17).oracleCard(23)
    }

    private var quickAmounts: some View {
        HStack(spacing: 6) {
            ForEach([10.0, 25.0, 50.0, 100.0], id: \.self) { value in
                Button { amount = value } label: {
                    Text("\(Int(value))").font(.system(size: 9, weight: .bold))
                        .foregroundColor(amount == value ? Theme.canvas : Theme.muted)
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                        .background(Capsule().fill(amount == value ? Theme.green : Theme.raised))
                }
            }
        }
    }

    private var tradeSummary: some View {
        VStack(spacing: 9) {
            SummaryRow(label: "Est. shares", value: String(format: "%.2f", shares))
            SummaryRow(label: "Average price", value: "\(price)¢")
            SummaryRow(label: "Potential payout", value: String(format: "%.2f CC", shares), green: true)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 13).fill(Theme.canvas.opacity(0.7)))
    }
}

private struct ProbabilityCard: View {
    let market: NativeMarket
    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("CURRENT PROBABILITY").font(.system(size: 7, weight: .bold)).tracking(0.8).foregroundColor(Theme.muted)
                    Text("\(market.yesProbability)%").font(.system(size: 41, weight: .bold, design: .rounded)).foregroundColor(Theme.text)
                }
                Spacer()
                Label("\(market.change > 0 ? "+" : "")\(market.change, specifier: "%.1f")%", systemImage: market.change >= 0 ? "arrow.up.right" : "arrow.down.right")
                    .font(.system(size: 10, weight: .bold)).foregroundColor(market.change >= 0 ? Theme.green : Theme.red)
                    .padding(.horizontal, 9).padding(.vertical, 6)
                    .background(Capsule().fill((market.change >= 0 ? Theme.green : Theme.red).opacity(0.1)))
            }
            Sparkline(values: market.history, color: Theme.green, fill: true).frame(height: 120)
            HStack { Text("24 HOURS AGO"); Spacer(); Text("NOW") }.font(.system(size: 6, weight: .bold)).foregroundColor(Theme.muted)
        }.padding(17).oracleCard()
    }
}
