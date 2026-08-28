import SwiftUI

struct WalletSheet: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    @State private var connecting = false

    var body: some View {
        NavigationView {
            VStack(spacing: 20) {
                Spacer(minLength: 8)
                walletGraphic
                VStack(spacing: 8) {
                    Text(session.walletConnected ? "Wallet connected" : "Enter the market")
                        .font(.system(size: 26, weight: .bold, design: .rounded)).foregroundColor(Theme.text)
                    Text(session.walletConnected ? "Your Canton identity is active and ready to trade." : "Connect securely. TruthOracle never holds your funds or private keys.")
                        .font(.system(size: 13)).foregroundColor(Theme.muted).multilineTextAlignment(.center).lineSpacing(3)
                }
                WalletFeature(icon: "lock.shield.fill", title: "Non-custodial", detail: "You stay in control")
                WalletFeature(icon: "checkmark.seal.fill", title: "Auditable settlement", detail: "Verified on Canton")
                WalletFeature(icon: "bolt.fill", title: "Fast execution", detail: "Built for live markets")
                Spacer()
                connectButton
            }
            .padding(22)
            .background(AppBackdrop())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Close") { dismiss() }.font(.system(size: 11, weight: .bold)).foregroundColor(Theme.muted)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var walletGraphic: some View {
        ZStack {
            Circle().fill(Theme.green.opacity(0.07)).frame(width: 138, height: 138)
            Circle().stroke(Theme.green.opacity(0.15)).frame(width: 104, height: 104)
            Image(systemName: session.walletConnected ? "checkmark.shield.fill" : "wallet.pass.fill")
                .font(.system(size: 40)).foregroundColor(Theme.green)
        }
    }

    private var connectButton: some View {
        Button {
            if session.walletConnected {
                dismiss()
            } else {
                connecting = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                    session.walletConnected = true
                    connecting = false
                    dismiss()
                }
            }
        } label: {
            HStack {
                if connecting { ProgressView().tint(Theme.canvas) } else { Image(systemName: "link") }
                Text(connecting ? "Connecting securely…" : session.walletConnected ? "Continue" : "Connect Canton wallet")
                Spacer()
                if !connecting { Image(systemName: "arrow.right") }
            }
            .font(.system(size: 13, weight: .bold)).foregroundColor(Theme.canvas).padding(15)
            .background(RoundedRectangle(cornerRadius: 14).fill(Theme.green))
        }
        .disabled(connecting)
    }
}

struct NewsDetail: View {
    @Environment(\.dismiss) private var dismiss
    let item: NativeNewsItem

    var body: some View {
        NavigationView {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 19) {
                    Image(systemName: item.symbol).font(.system(size: 34)).foregroundColor(Theme.green)
                        .frame(maxWidth: .infinity).frame(height: 175)
                        .background(RoundedRectangle(cornerRadius: 23).fill(LinearGradient(colors: [Color(hex: 0x193B32), Theme.surface], startPoint: .topLeading, endPoint: .bottomTrailing)))
                    LiveBadge(text: item.tag)
                    Text(item.title).font(.system(size: 28, weight: .bold, design: .rounded)).foregroundColor(Theme.text)
                    HStack { Text(item.source); Spacer(); Text("\(item.time) · \(item.readTime)") }
                        .font(.system(size: 9, weight: .semibold)).foregroundColor(Theme.muted)
                    Rectangle().fill(Theme.stroke).frame(height: 1)
                    Text(item.summary).font(.system(size: 16, weight: .semibold, design: .rounded)).foregroundColor(Theme.text).lineSpacing(4)
                    Text("This intelligence briefing connects verified market context with the signals traders are watching. Live publisher content and related market movements can be connected to the native data service as the product moves into production.")
                        .font(.system(size: 14)).foregroundColor(Theme.muted).lineSpacing(5)
                }.padding(20)
            }
            .background(AppBackdrop())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { dismiss() } label: { Image(systemName: "xmark").foregroundColor(Theme.text) }
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}
