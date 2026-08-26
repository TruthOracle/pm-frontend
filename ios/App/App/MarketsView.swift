import SwiftUI

struct MarketsView: View {
    @Binding var searchText: String
    @Binding var showProfile: Bool
    private var results: [Market] { Market.samples.filter { searchText.isEmpty || $0.title.localizedCaseInsensitiveContains(searchText) } }

    var body: some View { NavigationView { ScrollView(showsIndicators: false) { VStack(alignment: .leading, spacing: 18) {
        HeaderView(showProfile: $showProfile)
        Text("Explore markets").font(.system(size: 30, weight: .bold, design: .rounded)).foregroundColor(Theme.ink)
        SearchBar(text: $searchText)
        HStack(spacing: 8) { FilterPill(text: "Trending", active: true); FilterPill(text: "Politics"); FilterPill(text: "Crypto"); FilterPill(text: "Sports") }.fixedSize(horizontal: false, vertical: true)
        ForEach(results) { MarketCard(market: $0) }
    }.padding(.horizontal, 20).padding(.bottom, 24) }.background(Theme.background.ignoresSafeArea()).navigationBarHidden(true) } }
}
