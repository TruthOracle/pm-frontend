import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Header } from "@/components/Header";
import FAQ from "@/components/FAQ";
import Marketplace from "./components/Marketplace";
import Homepage from "./components/Homepage";
import Portfolio from "./components/Portfolio";
import Admin from "./components/Admin/Admin";
import MarketDetails from "./components/MarketDetails";
import Rewards from "./components/Rewards";
import { WalletProvider } from "./components/WalletProvider";
import { useIsAdmin } from "@/lib/useIsAdmin";
import { useEffect, useRef, useState, type CSSProperties } from "react";

function AdminRoute() {
  return useIsAdmin() ? <Admin /> : <Navigate to="/" replace />;
}

function NavigationProgressBar() {
  const location = useLocation();
  const [isVisible, setIsVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const hasMounted = useRef(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    timers.current.forEach(window.clearTimeout);

    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }

    setIsVisible(true);
    setProgress(0);

    timers.current = [
      window.setTimeout(() => setProgress(0.68), 20),
      window.setTimeout(() => setProgress(1), 260),
      window.setTimeout(() => {
        setIsVisible(false);
        setProgress(0);
      }, 650),
    ];

    return () => {
      timers.current.forEach(window.clearTimeout);
    };
  }, [location.pathname]);

  return (
    <div
      className={isVisible ? "scroll-progress is-visible" : "scroll-progress"}
      aria-hidden="true"
      style={
        {
          "--scroll-progress": progress,
        } as CSSProperties
      }
    />
  );
}

function App() {
  return (
    <WalletProvider>
      <Router>
        <div className="app-shell flex min-h-screen flex-col bg-background">
          <Header />
          <main className="flex-1 pt-16">
            <Routes>
              <Route path="/faq" element={<FAQ />} />
              <Route path="/marketplace" element={<Marketplace />} />
              <Route path="/" element={<Homepage />} />
              <Route path="/portfolio" element={<Portfolio />} />
              <Route path="/market/:id" element={<MarketDetails />} />
              <Route path="/admin" element={<AdminRoute />} />
              <Route path="/rewards" element={<Rewards />} />
            </Routes>
          </main>
          <NavigationProgressBar />
        </div>
      </Router>
    </WalletProvider>
  );
}

export default App;
