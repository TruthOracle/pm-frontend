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
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

function AdminRoute() {
  return useIsAdmin() ? <Admin /> : <Navigate to="/" replace />;
}

function AppContent() {
  const location = useLocation();
  const prefersReducedMotion = useReducedMotion();
  return <div className="app-shell flex min-h-screen flex-col bg-background">
    <Header />
    <AnimatePresence mode="wait" initial={false}>
      <motion.main
        key={location.pathname}
        className="page-transition flex-1 pt-[6.75rem]"
        initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
        animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
        exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      >
        <Routes location={location}>
          <Route path="/faq" element={<FAQ />} />
          <Route path="/marketplace" element={<Marketplace />} />
          <Route path="/" element={<Homepage />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/market/:id" element={<MarketDetails />} />
          <Route path="/admin" element={<AdminRoute />} />
          <Route path="/rewards" element={<Rewards />} />
        </Routes>
      </motion.main>
    </AnimatePresence>
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
