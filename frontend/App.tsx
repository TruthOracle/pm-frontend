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
import Footer from "@/components/Footer";

function AdminRoute() {
  return useIsAdmin() ? <Admin /> : <Navigate to="/" replace />;
}

function AppContent() {
  const location = useLocation();
  return <div className="app-shell flex min-h-screen flex-col bg-background">
    <Header />
    <main key={location.pathname} className="page-transition flex-1 pt-[6.75rem]">
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
