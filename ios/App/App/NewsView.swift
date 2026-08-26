import SwiftUI

struct NewsView: View {
    @Binding var showProfile: Bool
    var body: some View { NavigationView { ScrollView(showsIndicators: false) { VStack(alignment: .leading, spacing: 18) {
        HeaderView(showProfile: $showProfile)
        Text("Market news").font(.system(size: 30, weight: .bold, design: .rounded)).foregroundColor(Theme.ink)
        Text("Signals and stories shaping the odds").font(.subheadline).foregroundColor(Theme.muted)
        ForEach(NewsArticle.samples) { NewsRow(article: $0) }
    }.padding(.horizontal, 20).padding(.bottom, 24) }.background(Theme.background.ignoresSafeArea()).navigationBarHidden(true) } }
}
