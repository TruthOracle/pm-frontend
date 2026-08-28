import SwiftUI

// MARK: - Brand tokens

enum Theme {
    static let canvas = Color(hex: 0x07100F)
    static let surface = Color(hex: 0x0D1917)
    static let raised = Color(hex: 0x132320)
    static let green = Color(hex: 0x4CE5A1)
    static let cyan = Color(hex: 0x65D8E6)
    static let red = Color(hex: 0xFF7B78)
    static let amber = Color(hex: 0xF6C767)
    static let text = Color(hex: 0xF4FBF8)
    static let muted = Color(hex: 0x89A09A)
    static let stroke = Color.white.opacity(0.08)
}

extension Color {
    init(hex: UInt) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 255) / 255,
            green: Double((hex >> 8) & 255) / 255,
            blue: Double(hex & 255) / 255,
            opacity: 1
        )
    }
}

private struct OracleCardStyle: ViewModifier {
    let radius: CGFloat

    func body(content: Content) -> some View {
        content.background(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(Theme.surface)
                .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(Theme.stroke))
        )
    }
}

extension View {
    func oracleCard(_ radius: CGFloat = 22) -> some View {
        modifier(OracleCardStyle(radius: radius))
    }
}

// MARK: - Layout and navigation components

struct AppBackdrop: View {
    var body: some View {
        ZStack {
            Theme.canvas
            Circle()
                .fill(Theme.green.opacity(0.055))
                .frame(width: 320, height: 320)
                .blur(radius: 70)
                .offset(x: 170, y: -280)
        }
        .ignoresSafeArea()
    }
}

struct SearchField: View {
    @Binding var text: String
    let placeholder: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .semibold)).foregroundColor(Theme.green)
            TextField(placeholder, text: $text).font(.system(size: 12, weight: .medium)).foregroundColor(Theme.text)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundColor(Theme.muted) }
            }
            Image(systemName: "line.3.horizontal.decrease").font(.system(size: 12)).foregroundColor(Theme.muted)
        }
        .padding(.horizontal, 14)
        .frame(height: 49)
        .background(RoundedRectangle(cornerRadius: 15).fill(Theme.surface))
        .overlay(RoundedRectangle(cornerRadius: 15).stroke(Theme.stroke))
    }
}

struct PageHeader: View {
    let eyebrow: String
    let title: String
    let subtitle: String
    var symbol: String? = nil
    var action: () -> Void = {}

    var body: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 4) {
                Text(eyebrow).font(.system(size: 8, weight: .bold)).tracking(1.1).foregroundColor(Theme.green)
                Text(title).font(.system(size: 33, weight: .bold, design: .rounded)).foregroundColor(Theme.text)
                Text(subtitle).font(.system(size: 12, weight: .medium)).foregroundColor(Theme.muted)
            }
            Spacer()
            if let symbol = symbol {
                Button(action: action) {
                    Image(systemName: symbol).font(.system(size: 14, weight: .semibold)).foregroundColor(Theme.text).frame(width: 41, height: 41).background(Circle().fill(Theme.surface))
                }
            }
        }
    }
}

struct SectionHeader: View {
    let eyebrow: String
    let title: String
    var action: String? = nil
    var onTap: () -> Void = {}

    var body: some View {
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 3) {
                Text(eyebrow).font(.system(size: 7, weight: .bold)).tracking(1.1).foregroundColor(Theme.green)
                Text(title).font(.system(size: 20, weight: .bold, design: .rounded)).foregroundColor(Theme.text)
            }
            Spacer()
            if let action = action {
                Button(action: onTap) {
                    HStack(spacing: 3) { Text(action); Image(systemName: "arrow.right") }
                        .font(.system(size: 9, weight: .bold)).foregroundColor(Theme.muted)
                }
            }
        }
    }
}

struct LiveBadge: View {
    let text: String
    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(Theme.green).frame(width: 6, height: 6)
            Text(text).font(.system(size: 8, weight: .bold)).tracking(0.9)
        }
        .foregroundColor(Theme.green)
        .padding(.horizontal, 9).padding(.vertical, 6)
        .background(Capsule().fill(Theme.green.opacity(0.1)))
    }
}

struct Chip: View {
    let title: String
    let active: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: 10, weight: .bold)).foregroundColor(active ? Theme.canvas : Theme.muted)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(Capsule().fill(active ? Theme.green : Theme.surface))
                .overlay(Capsule().stroke(active ? Color.clear : Theme.stroke))
        }
    }
}

// MARK: - Market components

struct MarketIcon: View {
    let market: NativeMarket
    let size: CGFloat
    var body: some View {
        Image(systemName: market.symbol).font(.system(size: size * 0.4, weight: .semibold)).foregroundColor(Theme.green)
            .frame(width: size, height: size)
            .background(RoundedRectangle(cornerRadius: size * 0.31).fill(Theme.green.opacity(0.1)))
    }
}

struct SaveButton: View {
    @EnvironmentObject private var session: AppSession
    let market: NativeMarket
    var body: some View {
        Button { session.toggleSave(market) } label: {
            Image(systemName: session.saved.contains(market.id) ? "bookmark.fill" : "bookmark")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(session.saved.contains(market.id) ? Theme.green : Theme.muted)
                .frame(width: 33, height: 33).background(Circle().fill(Theme.raised))
        }
        .buttonStyle(.plain)
    }
}

struct OutcomePill: View {
    let title: String
    let price: Int
    let color: Color
    var body: some View {
        HStack { Text(title); Spacer(); Text("\(price)¢").monospacedDigit() }
            .font(.system(size: 11, weight: .bold)).foregroundColor(color)
            .padding(.horizontal, 12).frame(maxWidth: .infinity).frame(height: 41)
            .background(RoundedRectangle(cornerRadius: 11).fill(color.opacity(0.1)))
            .overlay(RoundedRectangle(cornerRadius: 11).stroke(color.opacity(0.16)))
    }
}

struct OutcomeSelector: View {
    let title: String
    let price: Int
    let active: Bool
    let color: Color
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack { Text(title); Spacer(); Text("\(price)¢") }
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(active ? (title == "YES" ? Theme.canvas : .white) : color)
                .padding(.horizontal, 13).frame(maxWidth: .infinity).frame(height: 47)
                .background(RoundedRectangle(cornerRadius: 12).fill(active ? color : color.opacity(0.09)))
        }
    }
}

struct Sparkline: View {
    let values: [Double]
    let color: Color
    var fill = false

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                if fill {
                    chartPath(in: proxy.size, closed: true)
                        .fill(LinearGradient(colors: [color.opacity(0.23), color.opacity(0)], startPoint: .top, endPoint: .bottom))
                }
                chartPath(in: proxy.size, closed: false)
                    .stroke(color, style: StrokeStyle(lineWidth: 2.3, lineCap: .round, lineJoin: .round))
                if let point = points(in: proxy.size).last {
                    Circle().fill(color.opacity(0.22)).frame(width: 14, height: 14).position(point)
                    Circle().fill(color).frame(width: 6, height: 6).position(point)
                }
            }
        }
    }

    private func points(in size: CGSize) -> [CGPoint] {
        guard values.count > 1, let low = values.min(), let high = values.max() else { return [] }
        let range = max(high - low, 0.01)
        return values.enumerated().map { index, value in
            CGPoint(x: size.width * CGFloat(index) / CGFloat(values.count - 1), y: size.height * CGFloat(0.86 - ((value - low) / range) * 0.72))
        }
    }

    private func chartPath(in size: CGSize, closed: Bool) -> Path {
        let values = points(in: size)
        return Path { path in
            guard let first = values.first, let last = values.last else { return }
            if closed { path.move(to: CGPoint(x: first.x, y: size.height)); path.addLine(to: first) } else { path.move(to: first) }
            for index in 1..<values.count {
                let previous = values[index - 1]
                let current = values[index]
                let middle = (previous.x + current.x) / 2
                path.addCurve(to: current, control1: CGPoint(x: middle, y: previous.y), control2: CGPoint(x: middle, y: current.y))
            }
            if closed { path.addLine(to: CGPoint(x: last.x, y: size.height)); path.closeSubpath() }
        }
    }
}

struct StatTile: View {
    let label: String
    let value: String
    let icon: String
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: icon).font(.system(size: 10)).foregroundColor(Theme.green)
            Text(value).font(.system(size: 11, weight: .bold, design: .rounded)).foregroundColor(Theme.text)
            Text(label).font(.system(size: 6, weight: .bold)).tracking(0.5).foregroundColor(Theme.muted)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(11).oracleCard(14)
    }
}

struct SmallValue: View {
    let label: String
    let value: String
    var color = Theme.text
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 6, weight: .bold)).tracking(0.5).foregroundColor(Theme.muted)
            Text(value).font(.system(size: 10, weight: .bold)).foregroundColor(color)
        }.frame(minWidth: 67, alignment: .leading)
    }
}

// MARK: - Utility components

struct WalletFeature: View {
    let icon: String
    let title: String
    let detail: String
    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundColor(Theme.green)
                .frame(width: 37, height: 37).background(Circle().fill(Theme.green.opacity(0.09)))
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text)
            Spacer()
            Text(detail).font(.system(size: 9, weight: .medium)).foregroundColor(Theme.muted)
        }.padding(10).oracleCard(15)
    }
}

struct PrimaryButton: View {
    let title: String
    let icon: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack { Image(systemName: icon); Text(title); Spacer(); Image(systemName: "arrow.right") }
                .font(.system(size: 13, weight: .bold)).foregroundColor(Theme.canvas).padding(15)
                .background(RoundedRectangle(cornerRadius: 14).fill(Theme.green))
        }
    }
}

struct SummaryRow: View {
    let label: String
    let value: String
    var green = false
    var body: some View {
        HStack { Text(label).foregroundColor(Theme.muted); Spacer(); Text(value).foregroundColor(green ? Theme.green : Theme.text).bold() }
            .font(.system(size: 10))
    }
}

struct EmptyState: View {
    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "magnifyingglass").font(.title).foregroundColor(Theme.green)
            Text("No markets found").font(.system(size: 17, weight: .bold, design: .rounded)).foregroundColor(Theme.text)
            Text("Try another event or category.").font(.system(size: 12)).foregroundColor(Theme.muted)
        }.frame(maxWidth: .infinity).padding(.vertical, 42).oracleCard()
    }
}

struct Disclaimer: View {
    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "info.circle.fill").foregroundColor(Theme.green)
            Text("Signals are market intelligence, not financial advice. Verify the resolution rules before trading.")
                .font(.system(size: 9)).foregroundColor(Theme.muted).lineSpacing(2)
        }.padding(13).background(RoundedRectangle(cornerRadius: 14).fill(Theme.green.opacity(0.055)))
    }
}

struct ActivityList: View {
    private let rows = [
        ("arrow.up.right", "Bought YES · Rate decision", "25.00 CC", "Today · 10:42"),
        ("checkmark.seal.fill", "Settlement received", "+42.18 CC", "Yesterday · 16:18"),
        ("arrow.down.left", "Wallet funded", "+200.00 CC", "Aug 24 · 09:12")
    ]
    var body: some View {
        VStack(spacing: 0) {
            ForEach(rows.indices, id: \.self) { index in
                HStack(spacing: 11) {
                    Image(systemName: rows[index].0).font(.system(size: 11, weight: .bold)).foregroundColor(Theme.green).frame(width: 35, height: 35).background(Circle().fill(Theme.green.opacity(0.09)))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(rows[index].1).font(.system(size: 11, weight: .semibold)).foregroundColor(Theme.text)
                        Text(rows[index].3).font(.system(size: 8)).foregroundColor(Theme.muted)
                    }
                    Spacer()
                    Text(rows[index].2).font(.system(size: 10, weight: .bold)).foregroundColor(Theme.text)
                }.padding(.vertical, 11)
                if index < rows.count - 1 { Rectangle().fill(Theme.stroke).frame(height: 1).padding(.leading, 46) }
            }
        }.padding(.horizontal, 13).oracleCard(18)
    }
}

struct OrderBanner: View {
    let outcome: String
    let amount: Double
    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: "checkmark.circle.fill").font(.title2).foregroundColor(Theme.green)
            VStack(alignment: .leading, spacing: 2) {
                Text("Order ready").font(.system(size: 13, weight: .bold)).foregroundColor(Theme.text)
                Text("\(amount, specifier: "%.0f") CC on \(outcome) is ready for wallet approval.").font(.system(size: 9)).foregroundColor(Theme.muted)
            }
        }.padding(13).frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 16).fill(Theme.green.opacity(0.09)))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.green.opacity(0.2)))
    }
}

struct ResolutionCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack {
                Image(systemName: "checkmark.shield.fill").foregroundColor(Theme.green)
                Text("Resolution & settlement").font(.system(size: 14, weight: .bold, design: .rounded)).foregroundColor(Theme.text)
            }
            Text("The market resolves from the official published source. Winning shares settle at 1 CC through Canton Network contracts.")
                .font(.system(size: 11)).foregroundColor(Theme.muted).lineSpacing(3)
            HStack {
                Label("Auditable", systemImage: "checkmark.circle.fill"); Spacer()
                Label("On-chain", systemImage: "link.circle.fill"); Spacer()
                Label("Deterministic", systemImage: "scope")
            }.font(.system(size: 8, weight: .bold)).foregroundColor(Theme.green)
        }.padding(15).oracleCard(18)
    }
}

struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .opacity(configuration.isPressed ? 0.88 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
