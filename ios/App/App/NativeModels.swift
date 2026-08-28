import Foundation

struct NativeNewsItem: Identifiable, Hashable {
    let id: String
    let tag: String
    let title: String
    let summary: String
    let source: String
    let time: String
    let symbol: String
    let readTime: String
}

struct NativeMarket: Identifiable, Hashable {
    let id: String
    let category: String
    let question: String
    let subtitle: String
    let yesProbability: Int
    let change: Double
    let volume: String
    let liquidity: String
    let traders: String
    let expiry: String
    let symbol: String
    let history: [Double]
    let isHot: Bool

    var noProbability: Int { 100 - yesProbability }
}

struct NativePosition: Identifiable {
    let id = UUID()
    let market: NativeMarket
    let side: String
    let shares: Double
    let averagePrice: Double
    let profit: Double
}

enum NativeData {
    static let markets = [
        NativeMarket(id: "rate-cut-september", category: "MACRO", question: "Will the next rate decision be a cut?", subtitle: "Resolves YES if the benchmark rate is reduced at the next scheduled decision.", yesProbability: 64, change: 4.8, volume: "18.4K CC", liquidity: "42.8K CC", traders: "1,284", expiry: "3d 14h", symbol: "building.columns.fill", history: [0.43, 0.47, 0.45, 0.51, 0.49, 0.57, 0.55, 0.61, 0.58, 0.64], isHot: true),
        NativeMarket(id: "major-ai-launch", category: "TECH", question: "Will a major AI model launch this month?", subtitle: "Resolves YES after a public release by a top-five AI lab before month end.", yesProbability: 72, change: 8.2, volume: "12.1K CC", liquidity: "31.5K CC", traders: "892", expiry: "8d 06h", symbol: "cpu.fill", history: [0.52, 0.50, 0.56, 0.54, 0.62, 0.60, 0.67, 0.65, 0.69, 0.72], isHot: true),
        NativeMarket(id: "digital-asset-volume", category: "CRYPTO", question: "Will digital asset volume rise this week?", subtitle: "Tracks aggregate spot volume across the leading regulated digital asset venues.", yesProbability: 48, change: -2.4, volume: "9.8K CC", liquidity: "22.3K CC", traders: "647", expiry: "2d 09h", symbol: "bitcoinsign.circle.fill", history: [0.58, 0.55, 0.57, 0.51, 0.54, 0.50, 0.52, 0.47, 0.50, 0.48], isHot: false),
        NativeMarket(id: "climate-bill-vote", category: "POLITICS", question: "Will the climate bill pass its final vote?", subtitle: "Resolves against the official published result of the final legislative vote.", yesProbability: 57, change: 1.6, volume: "7.3K CC", liquidity: "19.7K CC", traders: "514", expiry: "5d 22h", symbol: "leaf.fill", history: [0.49, 0.52, 0.51, 0.55, 0.53, 0.56, 0.58, 0.55, 0.56, 0.57], isHot: false),
        NativeMarket(id: "index-record-close", category: "BUSINESS", question: "Will the market index close at a new record?", subtitle: "Resolves YES if the reference index posts a record official closing value this quarter.", yesProbability: 39, change: -5.1, volume: "6.9K CC", liquidity: "17.2K CC", traders: "438", expiry: "12d 04h", symbol: "chart.line.uptrend.xyaxis", history: [0.51, 0.48, 0.50, 0.46, 0.47, 0.43, 0.45, 0.41, 0.42, 0.39], isHot: false)
    ]

    static let news = [
        NativeNewsItem(id: "rates-watch", tag: "MACRO", title: "Markets reprice the path of the next rate decision", summary: "Fresh economic signals are changing the crowd's conviction ahead of the policy meeting.", source: "TruthOracle Intelligence", time: "12m ago", symbol: "waveform.path.ecg", readTime: "3 min"),
        NativeNewsItem(id: "ai-signal", tag: "TECH", title: "AI release signals trigger an eight-point probability move", summary: "Developer activity and new product teasers pushed the technology market sharply higher.", source: "Signal Desk", time: "28m ago", symbol: "cpu.fill", readTime: "4 min"),
        NativeNewsItem(id: "policy-landscape", tag: "POLICY", title: "New policy language reshapes the prediction landscape", summary: "Traders are parsing the latest legislative text for clues before the final vote.", source: "TruthOracle Intelligence", time: "1h ago", symbol: "building.columns.fill", readTime: "5 min"),
        NativeNewsItem(id: "digital-assets", tag: "CRYPTO", title: "Digital asset volume cools as volatility compresses", summary: "Lower weekend activity has moved the weekly volume contract back toward even odds.", source: "Market Wire", time: "2h ago", symbol: "bitcoinsign.circle.fill", readTime: "2 min")
    ]

    static let positions = [
        NativePosition(market: markets[0], side: "YES", shares: 82.0, averagePrice: 0.51, profit: 18.46),
        NativePosition(market: markets[1], side: "YES", shares: 46.0, averagePrice: 0.63, profit: 7.84),
        NativePosition(market: markets[2], side: "NO", shares: 31.0, averagePrice: 0.47, profit: -2.18)
    ]
}
