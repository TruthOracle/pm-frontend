import { BrowserRouter as Router, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import FAQ from "@/components/FAQ";
import Marketplace from "./components/Marketplace";
import Homepage from "./components/Homepage";
import Portfolio from "./components/Portfolio";
import Admin from "./components/Admin/Admin";
import MarketDetails from "./components/MarketDetails";
import Rewards from "./components/Rewards";
import News from "./components/News";
import { WalletProvider } from "./components/WalletProvider";
import { useIsAdmin } from "@/lib/useIsAdmin";
import Footer from "@/components/Footer";
import { useEffect, useLayoutEffect, useState } from "react";
import { fetchAllPredictionMarkets } from "@/utils/activeContracts";
import { setPrefetchedMarkets } from "@/utils/marketPrefetch";
import { fetchMarketNews } from "@/lib/marketNews";

function AdminRoute() {
  return useIsAdmin() ? <Admin /> : <Navigate to="/" replace />;
}

function resetPageScroll() {
  // Reset both browser scrolling roots synchronously before the next route can paint.
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

function AppContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const [routeProgress, setRouteProgress] = useState<number | null>(null);
  const [loadingRoute, setLoadingRoute] = useState<string | null>(null);

  useLayoutEffect(() => {
    resetPageScroll();
  }, [location.pathname]);

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    if (!loadingRoute) return;
    setRouteProgress(0.18);
    const advance = window.setInterval(() => {
      setRouteProgress((value) => {
        const current = value ?? 0;
        if (current >= 0.9) return current;
        return Math.min(current + Math.max(0.02, (0.9 - current) * 0.12), 0.9);
      });
    }, 120);
    return () => {
      window.clearInterval(advance);
    };
  }, [loadingRoute]);

  const handleNavigation = async (event: React.MouseEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest("a");
    if (!target || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (loadingRoute) {
      event.preventDefault();
      return;
    }
    const href = target.getAttribute("href");
    if (!href || !href.startsWith("/") || href === location.pathname) return;
    const targetPath = href.split("?")[0];
    const waitsForMarketData = targetPath === "/" || targetPath === "/marketplace" || targetPath.startsWith("/market/");

    event.preventDefault();
    setLoadingRoute(targetPath);
    try {
      if (waitsForMarketData) {
        setPrefetchedMarkets(await fetchAllPredictionMarkets());
      } else if (targetPath === "/news") {
        await fetchMarketNews();
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
    } finally {
      // Let the line run a little beyond the right edge, then remove it directly.
      // It never receives a reverse width transition.
      setRouteProgress(1.015);
      window.setTimeout(() => {
        resetPageScroll();
        navigate(href);
        window.setTimeout(() => {
          setLoadingRoute(null);
          setRouteProgress(null);
        }, 100);
      }, 260);
    }
  };

  return <div className="app-shell flex min-h-screen flex-col bg-background" onClickCapture={handleNavigation}>
    {routeProgress !== null && (
      <div
        className="route-progress"
        style={{ transform: `scaleX(${routeProgress})` }}
        aria-hidden="true"
      />
    )}
    <Header />
    <main className="page-transition flex-1 pt-[6.75rem]">
      <Routes location={location}>
        <Route path="/faq" element={<FAQ />} />
        <Route path="/marketplace" element={<Marketplace />} />
        <Route path="/" element={<Homepage />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/market/:id" element={<MarketDetails />} />
        <Route path="/admin" element={<AdminRoute />} />
        <Route path="/rewards" element={<Rewards />} />
        <Route path="/news" element={<News />} />
      </Routes>
    </main>
    <Footer />
  </div>;
}

function App() {
  return (
    <WalletProvider>
      <Router>
        <AppContent />
      </Router>
    </WalletProvider>
  );
}

export default App;
