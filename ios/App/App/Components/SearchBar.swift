import SwiftUI

struct SearchBar: View {
    @Binding var text: String
    var body: some View { HStack(spacing: 10) { Image(systemName: "magnifyingglass").foregroundColor(Theme.muted); TextField("Search markets", text: $text).font(.subheadline) }.padding(14).background(Color.white).clipShape(RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border)) }
}
