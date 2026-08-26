import SwiftUI

struct NewsRow: View {
    let article: NewsArticle
    var body: some View { HStack(alignment: .top, spacing: 13) {
        RoundedRectangle(cornerRadius: 12).fill(article.color).frame(width: 72, height: 72).overlay(Image(systemName: article.icon).font(.title2).foregroundColor(.white))
        VStack(alignment: .leading, spacing: 6) { Text(article.title).font(.subheadline.bold()).foregroundColor(Theme.ink); Text("\(article.source)  ·  \(article.time)").font(.caption).foregroundColor(Theme.muted) }
    }.padding(13).background(Color.white).clipShape(RoundedRectangle(cornerRadius: 18)).overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.border)) }
}
