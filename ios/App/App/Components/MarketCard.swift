import SwiftUI

struct MarketCard: View {
    let market: Market
    var body: some View { VStack(alignment: .leading, spacing: 13) {
        HStack { Text(market.category.uppercased()).font(.caption2.bold()).foregroundColor(Theme.accent); Spacer(); Text(market.time).font(.caption).foregroundColor(Theme.muted) }
        Text(market.title).font(.headline).foregroundColor(Theme.ink)
        HStack { Text("YES \(market.probability)%").font(.subheadline.bold()).foregroundColor(Theme.green); Spacer(); Text("NO \(100 - market.probability)%").font(.subheadline.bold()).foregroundColor(Theme.red) }
        ProgressView(value: Double(market.probability), total: 100).tint(Theme.green)
        HStack { Text("$\(market.volume) volume").font(.caption).foregroundColor(Theme.muted); Spacer(); Text("Trade →").font(.caption.bold()).foregroundColor(Theme.accent) }
    }.padding(17).background(Color.white).clipShape(RoundedRectangle(cornerRadius: 18)).overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.border)) }
}
