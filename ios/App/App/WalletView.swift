import SwiftUI

struct WalletView: View {
    @Binding var showProfile: Bool
    var body: some View { NavigationView { ScrollView(showsIndicators: false) { VStack(alignment: .leading, spacing: 20) {
        HeaderView(showProfile: $showProfile)
        Text("Your wallet").font(.system(size: 30, weight: .bold, design: .rounded)).foregroundColor(Theme.ink)
        VStack(alignment: .leading, spacing: 16) { Text("TOTAL BALANCE").font(.caption.weight(.bold)).foregroundColor(.white.opacity(0.7)); Text("$12,840.60").font(.system(size: 36, weight: .bold, design: .rounded)).foregroundColor(.white); Text("+$842.20  ·  +7.02% this month").font(.subheadline.weight(.semibold)).foregroundColor(Theme.mint) }.padding(22).frame(maxWidth: .infinity, alignment: .leading).background(Theme.gradient).clipShape(RoundedRectangle(cornerRadius: 24))
        HStack(spacing: 12) { WalletAction(title: "Deposit", icon: "arrow.down.left"); WalletAction(title: "Withdraw", icon: "arrow.up.right") }
        SectionTitle(title: "Recent activity", action: "See all") {}
        ActivityRow(title: "Market position settled", detail: "US rates · 2h ago", amount: "+$186.40", positive: true)
        ActivityRow(title: "Position purchased", detail: "AI regulation · Yesterday", amount: "-$240.00", positive: false)
    }.padding(.horizontal, 20).padding(.bottom, 24) }.background(Theme.background.ignoresSafeArea()).navigationBarHidden(true) } }
}
