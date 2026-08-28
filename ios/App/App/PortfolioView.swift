import SwiftUI

struct PortfolioView: View {
    @EnvironmentObject private var session: AppSession
    @State private var hidden = false

    var body: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: 19) {
                PageHeader(
                    eyebrow: session.walletConnected ? "CANTON · CONNECTED" : "CANTON WALLET",
                    title: "Portfolio",
                    subtitle: session.walletConnected ? "Your edge, measured live." : "Connect to unlock your trading cockpit.",
                    symbol: session.walletConnected ? "eye.fill" : nil
                ) { hidden.toggle() }

                if session.walletConnected { connectedContent } else { disconnectedContent }
            }
            .padding(.horizontal, 18).padding(.top, 18).padding(.bottom, 28)
        }
        .background(AppBackdrop())
    }

    private var connectedContent: some View {
        Group {
            BalanceCard(hidden: hidden)
            HStack(spacing: 8) {
                Metric(label: "AVAILABLE", value: "842.3 CC", icon: "banknote.fill", color: Theme.green)
                Metric(label: "IN MARKETS", value: "398.2 CC", icon: "chart.pie.fill", color: Theme.cyan)
                Metric(label: "WIN RATE", value: "68%", icon: "scope", color: Theme.amber)
            }
            SectionHeader(eyebrow: "POSITIONS", title: "Open exposure", action: "3 active") {}
            ForEach(NativeData.positions) { PositionCard(position: $0) }
            SectionHeader(eyebrow: "ACTIVITY", title: "Recent moves")
            ActivityList()
        }
    }

    private var disconnectedContent: some View {
        Group {
            ConnectCard { session.walletPresented = true }
            SectionHeader(eyebrow: "BUILT FOR TRUST", title: "Secure by design")
            WalletFeature(icon: "key.fill", title: "Your keys, your assets", detail: "Non-custodial")
            WalletFeature(icon: "network", title: "Canton Network", detail: "Private settlement")
            WalletFeature(icon: "checkmark.seal.fill", title: "Verifiable outcomes", detail: "Transparent")
        }
    }
}

private struct BalanceCard: View {
    let hidden: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("PORTFOLIO VALUE").font(.system(size: 8, weight: .bold)).tracking(1).foregroundColor(Theme.muted)
                Spacer()
                Text("7D").font(.system(size: 8, weight: .bold)).foregroundColor(Theme.green).padding(.horizontal, 9).padding(.vertical, 5).background(Capsule().fill(Theme.green.opacity(0.1)))
            }
            Text(hidden ? "••••••" : "1,240.50 CC").font(.system(size: 35, weight: .bold, design: .rounded)).foregroundColor(Theme.text).monospacedDigit()
            HStack(spacing: 5) {
                Image(systemName: "arrow.up.right")
                Text("+76.42 CC").bold()
                Text("(+8.4%) this week").foregroundColor(Theme.muted)
            }.font(.system(size: 10)).foregroundColor(Theme.green)
            Sparkline(values: [0.42, 0.44, 0.43, 0.49, 0.47, 0.55, 0.53, 0.61, 0.66, 0.72], color: Theme.green, fill: true).frame(height: 88)
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 25)
                .fill(LinearGradient(colors: [Color(hex: 0x15372E), Theme.surface], startPoint: .topLeading, endPoint: .bottomTrailing))
                .overlay(RoundedRectangle(cornerRadius: 25).stroke(Theme.green.opacity(0.2)))
        )
    }
}

private struct Metric: View {
    let label: String
    let value: String
    let icon: String
    let color: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundColor(color)
            Text(value).font(.system(size: 12, weight: .bold, design: .rounded)).foregroundColor(Theme.text)
            Text(label).font(.system(size: 6, weight: .bold)).tracking(0.6).foregroundColor(Theme.muted)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(11).oracleCard(15)
    }
}

private struct PositionCard: View {
    @EnvironmentObject private var session: AppSession
    let position: NativePosition
    var body: some View {
        Button { session.selectedMarket = position.market } label: {
            VStack(alignment: .leading, spacing: 11) {
                HStack(alignment: .top, spacing: 10) {
                    Text(position.side).font(.system(size: 8, weight: .bold)).foregroundColor(position.side == "YES" ? Theme.canvas : .white).frame(width: 36, height: 36).background(Circle().fill(position.side == "YES" ? Theme.green : Theme.red))
                    Text(position.market.question).font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundColor(Theme.text).multilineTextAlignment(.leading)
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption2).foregroundColor(Theme.muted)
                }
                Rectangle().fill(Theme.stroke).frame(height: 1)
                HStack {
                    SmallValue(label: "SHARES", value: String(format: "%.0f", position.shares))
                    SmallValue(label: "AVG PRICE", value: "\(Int(position.averagePrice * 100))¢")
                    Spacer()
                    SmallValue(label: "P&L", value: String(format: "%@%.2f CC", position.profit >= 0 ? "+" : "", position.profit), color: position.profit >= 0 ? Theme.green : Theme.red)
                }
            }.padding(14).oracleCard(18)
        }.buttonStyle(PressStyle())
    }
}

private struct ConnectCard: View {
    let action: () -> Void
    var body: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle().fill(Theme.green.opacity(0.08)).frame(width: 112, height: 112)
                Circle().stroke(Theme.green.opacity(0.18)).frame(width: 84, height: 84)
                Image(systemName: "wallet.pass.fill").font(.system(size: 34)).foregroundColor(Theme.green)
            }
            VStack(spacing: 7) {
                Text("Your trading cockpit").font(.system(size: 22, weight: .bold, design: .rounded)).foregroundColor(Theme.text)
                Text("Connect a Canton wallet to trade live markets, track performance, and collect settlements.").font(.system(size: 13)).foregroundColor(Theme.muted).multilineTextAlignment(.center).lineSpacing(3)
            }
            PrimaryButton(title: "Connect Canton wallet", icon: "link", action: action)
        }.padding(23).oracleCard(25)
    }
}
