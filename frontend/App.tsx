import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import { Header } from "@/components/Header";
import FAQ from '@/components/FAQ';
import Marketplace from "./components/Marketplace";
import Homepage from "./components/Homepage";
import Portfolio from "./components/Portfolio";
import Admin from "./components/Admin/Admin";
import BetDetails from './components/BetDetails';
import Rewards from './components/Rewards';
import { WalletProvider } from './components/WalletProvider';
import { useIsAdmin } from "@/lib/useIsAdmin";

function AdminRoute() {
  return useIsAdmin() ? <Admin /> : <Navigate to="/" replace />;
}

function App() {

  return (
    <WalletProvider>
    <Router>
      <Header />
      <div
        style={{
          backgroundColor: "#1C2526",
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          overflow: "hidden",
        }}
        className="flex flex-col"
      >
        <main
          style={{
            backgroundColor: "#1C2526",
            paddingTop: "64px", // header height
            flex: 1,
            overflowY: "auto",
          }}
          className="flex flex-col items-center px-4"
        >
          <Routes>
            <Route path="/faq" element={<FAQ />} />
            <Route path="/marketplace" element={<Marketplace/>} />
            <Route
              path="/"
              element={
            <Homepage/>
              }
            />
            <Route path="/portfolio" element={<Portfolio/>} />
            <Route path="/bet/:id" element={<BetDetails />} /> 
            <Route path="/admin" element={<AdminRoute />} />
            <Route path="/rewards" element={<Rewards/>} />
            {/* <Route path="/market/:address" element={<Market/>} /> */}


          </Routes>
          
        </main>
				{/* <Footer /> */}
         
      </div>
    </Router>
    </WalletProvider>
  );
}

    // <div className="flex flex-col w-full max-w-4xl">
                //   {connected ? (
                //     <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full text-center">
                //       {/* Left Column */}
                //       <div className="flex flex-col items-left justify-center p-4">
                //         <p className="font-jbm text-lg">
                //           TruthOracle: A decentralized prediction market platform on the Canton Network. Make predictions on politics and more—securely and transparently, with low fees. Join us to harness collective intelligence and gain rewards for accurate predictions.
                //         </p>
                //         <button 
                //           className="mt-4 bg-white text-white py-2 px-4 rounded-md hover:bg-gray-800 transition duration-300 font-jbm text-lg"
                //           onClick={() => window.location.href = '/marketplace'}
                //         >
                //           Get Started
                //         </button>
                //       </div>

                //       {/* Right Column */}
                //       <div className="flex justify-center items-center">
                //         <img
                //           src="/logonobg.svg"
                //           className="w-64 h-64 md:w-80 md:h-80 object-contain transform transition duration-500 ease-in-out hover:scale-105"
                //           alt="Logo"
                //         />
                //       </div>
                //     </div>
                //   ) : (
                //     <CardHeader className="flex items-center justify-center flex-col py-4">
                //       <CardTitle className="font-jbm text-lg text-center">
                //         To get started, Connect a wallet
                //       </CardTitle>
                //     </CardHeader>
                //   )}
                // </div>

export default App;
