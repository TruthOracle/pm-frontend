import Foundation

struct NativeNewsItem: Identifiable {
    let id = UUID()
    let tag: String
    let title: String
    let source: String
    let time: String
    let symbol: String
}

struct NativeMarket: Identifiable {
    let id = UUID()
    let category: String
    let question: String
    let yesProbability: Int
    let volume: String
    let expiry: String
}

enum NativeData {
    static let news = [
        NativeNewsItem(tag: "MACRO", title: "Markets are watching the next rate decision", source: "TruthOracle Desk", time: "12 min ago", symbol: "chart.line.uptrend.xyaxis"),
        NativeNewsItem(tag: "TECH", title: "AI adoption becomes a key signal for investors", source: "TruthOracle Desk", time: "28 min ago", symbol: "cpu"),
        NativeNewsItem(tag: "POLICY", title: "New policy signals reshape the prediction landscape", source: "TruthOracle Desk", time: "1 hr ago", symbol: "building.columns")
    ]

    static let markets = [
        NativeMarket(category: "MACRO", question: "Will the next rate decision be a cut?", yesProbability: 64, volume: "18.4k CC", expiry: "3d left"),
        NativeMarket(category: "TECH", question: "Will a major AI model launch this month?", yesProbability: 72, volume: "12.1k CC", expiry: "8d left"),
        NativeMarket(category: "CRYPTO", question: "Will digital asset volume rise this week?", yesProbability: 48, volume: "9.8k CC", expiry: "2d left")
    ]
}
