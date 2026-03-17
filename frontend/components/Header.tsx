import { useCantonWallet } from "@/wallets";
import { WalletSelector } from "./WalletSelector";
import { Link } from 'react-router-dom';
import {Button, useToast} from "@chakra-ui/react";

export function Header() {

    const { account } = useCantonWallet();

   const toast = useToast()


        const handleClick = async (e:any) => {
        e.preventDefault();

         if (!account) {
            console.error("Account not available");
            return;
        }

        if (account) {
            // Canton Coin is native on testnet/mainnet; use network faucet or transfer, not in-app mint
            toast({
                title: 'Canton Coin',
                description: 'Use the network faucet or transfer to get Canton Coin on testnet.',
                status: 'info',
                duration: 5000,
                isClosable: true,
            });
        } else {
            console.log("Account not available");
        }
    }




  return (
    <div
      className="header-sticky"
      style={{
        backgroundColor: "#1C2526",
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px',
        color: "white",
        borderBottom: '1px solid gray',
        position: 'fixed',
        top: 0,
        left: 0,
        height: '64px',
        width: '100%',
        zIndex: 1000
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <img src="/logonobg.svg" alt="Logo" width={40} height={40} style={{ marginRight: '10px' }} />
        <Link to="/" style={{ zIndex: 1 }}>
          <h1 className="font-jbm text-xl">TruthOracle</h1>
        </Link>
      </div>
      <div style={{ display: 'flex', justifyContent:"flex-end", width:"70%"}}>
        <Link to="/marketplace" className="font-jbm text-l" style={{marginRight:"40px", zIndex:1}}>Marketplace</Link>
        <Link to="/portfolio"  style={{marginRight:"40px", zIndex:1}} className="font-jbm text-l">Portfolio</Link>
        <Link to="/rewards" className="font-jbm text-l" style={{marginRight:"40px", zIndex:1}}>Rewards</Link>
        <Link to="/faq" className="font-jbm text-l" style={{marginRight:"40px", zIndex:1}}>FAQ's</Link>
        <Link to="/admin" className="font-jbm text-l" style={{marginRight:"40px", zIndex:1}}>Create Market</Link>
                <Button onClick={handleClick} style={{zIndex:1, borderRadius:"20px", "height":"30px"}}>Get Canton Coin</Button>


      </div>
      <div className="ml-auto">
        <WalletSelector />
      </div>
    </div>
  );
}

