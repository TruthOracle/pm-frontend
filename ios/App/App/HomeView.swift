import SwiftUI

struct HomeView: View {
    @Binding var searchText: String
    @Binding var showProfile: Bool
    @Binding var selectedTab: Int

    var body: some View {
        NavigationView { ScrollView(showsIndicators: false) { VStack(alignment: .leading, spacing: 22) {
            HeaderView(showProfile: $showProfile)
            SearchBar(text: $searchText)
            WelcomeCard()
            SectionTitle(title: "Trending markets", action: "See all") { selectedTab = 1 }
            ForEach(Array(Market.samples.prefix(3))) { MarketCard(market: $0) }
            SectionTitle(title: "Market intelligence", action: "All news") { selectedTab = 2 }
            NewsRow(article: NewsArticle.samples[0])
        }.padding(.horizontal, 20).padding(.bottom, 24) }.background(Theme.background.ignoresSafeArea()).navigationBarHidden(true) }
    }
}

private struct WelcomeCard: View {
    var body: some View { VStack(alignment: .leading, spacing: 10) {
        Text("Good morning, Alex").font(.title2.bold()).foregroundColor(.white)
        Text("Make informed predictions with real-time market signals.").font(.subheadline).foregroundColor(.white.opacity(0.75))
        HStack { Label("Portfolio +7.02%", systemImage: "arrow.up.right").font(.caption.bold()).foregroundColor(Theme.mint); Spacer(); Text("$12,840.60").font(.headline.bold()).foregroundColor(.white) }
    }.padding(20).frame(maxWidth: .infinity, alignment: .leading).background(Theme.gradient).clipShape(RoundedRectangle(cornerRadius: 24)) }
}
