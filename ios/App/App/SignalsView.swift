import SwiftUI

struct SignalsView: View {
    @State private var selected: NativeNewsItem?
    @State private var tag = "All"
    private let tags = ["All", "Macro", "Tech", "Policy", "Crypto"]

    private var stories: [NativeNewsItem] {
        tag == "All" ? NativeData.news : NativeData.news.filter { $0.tag.caseInsensitiveCompare(tag) == .orderedSame }
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: 19) {
                PageHeader(eyebrow: "CURATED INTELLIGENCE", title: "Signal desk", subtitle: "Context that moves probability.")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(tags, id: \.self) { item in
                            Chip(title: item, active: tag == item) { withAnimation { tag = item } }
                        }
                    }
                }
                if let featured = stories.first { FeaturedSignal(item: featured) { selected = featured } }
                SectionHeader(eyebrow: "LATEST", title: "Market briefings")
                ForEach(stories.dropFirst()) { item in
                    Button { selected = item } label: { SignalRow(item: item) }.buttonStyle(.plain)
                }
                Disclaimer()
            }
            .padding(.horizontal, 18).padding(.top, 18).padding(.bottom, 28)
        }
        .background(AppBackdrop())
        .sheet(item: $selected) { NewsDetail(item: $0) }
    }
}

private struct FeaturedSignal: View {
    let item: NativeNewsItem
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 17) {
                HStack {
                    LiveBadge(text: "TOP SIGNAL")
                    Spacer()
                    Image(systemName: item.symbol).font(.title2).foregroundColor(Theme.green)
                }
                Text(item.title).font(.system(size: 24, weight: .bold, design: .rounded)).foregroundColor(Theme.text).multilineTextAlignment(.leading)
                Text(item.summary).font(.system(size: 13)).foregroundColor(Theme.muted).multilineTextAlignment(.leading).lineSpacing(3)
                HStack {
                    Text(item.source)
                    Spacer()
                    Text("\(item.time) · \(item.readTime)")
                }.font(.system(size: 9, weight: .semibold)).foregroundColor(Theme.muted)
            }
            .padding(20)
            .background(
                RoundedRectangle(cornerRadius: 25)
                    .fill(LinearGradient(colors: [Color(hex: 0x142B27), Theme.surface], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .overlay(RoundedRectangle(cornerRadius: 25).stroke(Theme.green.opacity(0.16)))
            )
        }
        .buttonStyle(PressStyle())
    }
}

struct SignalRow: View {
    let item: NativeNewsItem

    var body: some View {
        HStack(spacing: 13) {
            Image(systemName: item.symbol)
                .font(.system(size: 17, weight: .semibold)).foregroundColor(Theme.green)
                .frame(width: 48, height: 48)
                .background(RoundedRectangle(cornerRadius: 14).fill(Theme.green.opacity(0.1)))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 5) {
                    Text(item.tag).foregroundColor(Theme.green)
                    Text("·")
                    Text(item.time)
                }.font(.system(size: 8, weight: .bold)).foregroundColor(Theme.muted)
                Text(item.title).font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundColor(Theme.text).lineLimit(2)
                Text(item.readTime + " read").font(.system(size: 8)).foregroundColor(Theme.muted)
            }
            Spacer()
            Image(systemName: "arrow.up.right").font(.system(size: 10, weight: .bold)).foregroundColor(Theme.muted)
        }.padding(12).oracleCard(17)
    }
}
