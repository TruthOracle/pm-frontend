import {Divider, Flex, Progress, Skeleton, Stack, Stat, StatArrow, StatGroup, StatHelpText, StatLabel, StatNumber, Text, useToast} from '@chakra-ui/react';
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getMarketCount, getMarketMetadata} from "../../blockend/cantonService";
import { useCantonWallet } from "@/contexts/CantonWalletContext";
import { buildBuySharesParams } from "@/utils/cantonCommands";
import { fetchPredictionMarketContractId, fetchUserMarketDataContractId } from "@/utils/activeContracts";





const BetBuyCard = () => {
  const { id } = useParams<{ id: string }>(); // Get the bet ID from the URL
  const [bet, setBet] = useState<any>(null); // State to hold the bet data
  const [lmsr, setLmsr] = useState<any>(null);
  const [amount, setAmount] = useState<number>(0); // State for bet amount input
  const [selectedOption, setSelectedOption] = useState<string | null>(null); // State to track selected option
  const [currentPrice, setCurrentPrice] = useState<any>(null);
  const [predictionMarketCid, setPredictionMarketCid] = useState<string | null>(null);
  const [userMarketDataCid, setUserMarketDataCid] = useState<string | null>(null);
  const { account } = useCantonWallet();

   function hexToAscii(hex:any) {
        if (!hex) return "";
        let str = "";
        for (let i = 0; i < hex.length; i += 2) {
            const hexValue = hex.substr(i, 2);
            const decimalValue = parseInt(hexValue, 16);
            str += String.fromCharCode(decimalValue);
        }
        return str;
    }

useEffect(() => {
    if (!id) return;

    getMarketCount().then((m:any) => {
        let marketCount = m;
        for(let i = 0; i < marketCount; i++) {
            getMarketMetadata(i).then((m:any) => {
                if(m[0].id == id) {
                    setBet(m[0]);
                    setLmsr(m[1]);
                }
            });
        }
    });
}, [id]);

// Fetch PredictionMarket and UserMarketData contract IDs for this market when we have account and market id
useEffect(() => {
    if (!account?.address || id == null) return;
    const marketIdNum = Number(id);
    if (isNaN(marketIdNum)) return;
    fetchPredictionMarketContractId(marketIdNum, account.address).then((info) => {
        setPredictionMarketCid(info?.contractId ?? null);
    });
    fetchUserMarketDataContractId(account.address, marketIdNum).then(setUserMarketDataCid);
}, [account?.address, id]);

// Separate useEffect for price calculation
useEffect(() => {
    if (lmsr) {
        const price = getCurrentPrice(
            lmsr.option_shares_1,
            lmsr.option_shares_2,
            lmsr.liquidity_param
        );
        setCurrentPrice(price);
        console.log("Updated price:", price);
    }
}, [lmsr]);




  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value) && value >= 0) {
      // Limit to two decimal places

     setAmount(Math.round(value * 100) / 100);
    }
  };

  const incrementAmount = () => {
    setAmount(prevAmount => Math.round((prevAmount + 1) * 100) / 100); // Increment by 0.1 and limit to two decimal places
  };

  const decrementAmount = () => {
    setAmount(prevAmount => Math.max(Math.round((prevAmount - 1) * 100) / 100, 0)); // Decrement by 0.1 and prevent negative values
  };

  const handleOptionClick = (option: string) => {
    setSelectedOption(option);
  };

  const toast = useToast()


  function getCurrentPrice(q1:any, q2:any, b:any) {
        if (q1 === undefined || q2 === undefined || b === undefined || b === 0) {
            return { val1: 0.5, val2: 0.5 }; // Default to 50/50 if data is missing
        }
        let val_1 = Math.exp(q1/b);
        let val_2 = Math.exp(q2/b);
        return { 
            val1: val_1 / (val_1 + val_2), 
            val2: val_2 / (val_1 + val_2) 
        };
    }

  const { signAndSubmitTransaction } = useCantonWallet();

  const buyShares = async(_marketId: any, shareOption: any, numberOfShares: number) => {
    try {
    if (!account) return;
    if (!predictionMarketCid) {
        toast({
            title: "Market contract not found",
            description: "This market may not be on this participant. Try refreshing.",
            status: "warning",
            duration: 5000,
            isClosable: true,
        });
        return;
    }
    // UI uses 0 = option_1, 1 = option_2; DAML Trade expects option 1 or 2
    const option = Number(shareOption) === 0 ? 1 : 2;
    const numShares = Math.max(0, Math.floor(numberOfShares));
    const cost = numShares; // or derive from LMSR; DAML expects non-negative cost
    const params = buildBuySharesParams(
        account.address,
        predictionMarketCid,
        option,
        numShares,
        cost,
        userMarketDataCid
    );
    const committedTxn = await signAndSubmitTransaction(params);
                void committedTxn.hash;
                console.log(`Committed transaction: ${committedTxn.hash}`);
                
                // Refresh all necessary data
                // 1. Refresh portfolio data
                if ((window as any).refreshPortfolio) {
                    (window as any).refreshPortfolio();
                }
                
                // 2. Refresh marketplace data
                if ((window as any).refreshMarketplace) {
                    (window as any).refreshMarketplace();
                }
                
                // 3. Refresh current bet data
                if (!id) return;
                getMarketCount().then((m:any) => {
                    let marketCount = m;
                    for(let i = 0; i < marketCount; i++) {
                        getMarketMetadata(i).then((m:any) => {
                            if(m[0].id == id) {
                                setBet(m[0]);
                                setLmsr(m[1]);
                            }
                        });
                    }
                });

                toast({
                    title: 'Bet Placed',
                    description: "We've added your bet to the market.",
                    status: 'success',
                    duration: 9000,
                    isClosable: true,
                });
    } catch (e) {
        console.error(e);
        toast({
            title: "Trade failed",
            description: e instanceof Error ? e.message : "Could not submit trade.",
            status: "error",
            duration: 5000,
            isClosable: true,
        });
    }
  }

  const handleBuyClick = () => {
    // Only proceed if amount is a number, greater than 0, and an option is selected

    console.log("Selected Option", selectedOption);
    let option;

    if(selectedOption === bet?.option_1) option = 0;
    else option = 1;

    buyShares(parseInt(bet?.id), option, amount).then(() => {})
    // if (amount > 0 && selectedOption) {
    //   alert(`Placed a bet of $${amount.toFixed(2)} on ${selectedOption}`);
    // } else {
    //   alert('Please enter a valid bet amount and select an option.');
    // }
    
  };

  const getResultText = () => {
    if (!bet) return null;
    if (bet.status === 0) return null;
    if (bet.result === 0) return `Winner: ${hexToAscii(bet.option_1)}`;
    if (bet.result === 1) return `Winner: ${hexToAscii(bet.option_2)}`;
    return "Market Expired";
  };

  return (
    
    <>
        {!bet && <Stack minHeight={"100vh"} p={5} width={"100%"} color={"white"} justifyContent={"space-between"}>
          <Skeleton height='20px' />
          <Skeleton height='20px' />
          <Skeleton height='20px' />
        </Stack>} 
        {bet && <Flex minHeight={"100vh"} p={5} width={"100%"} color={"white"} justifyContent={"space-between"}>
        <Stack width={"60%"}>
            <h2 className="text-xl font-jbm font-bold mb-3" style={{color: "#CCCCFF"}}>{hexToAscii(bet?.question)}</h2>
            <Text fontSize={"lg"} mb={10} className="font-jbm">{hexToAscii(bet?.description)}</Text>
            <Flex>
            <Stack width={"70%"}>
                <Flex>
                    <Text mr={2}>{hexToAscii(bet?.option_1)}</Text>
                    <Text> - {lmsr?.option_shares_1}  Shares</Text>
                </Flex>
                    <Progress width={"50%"} colorScheme='green' size='sm' value={lmsr?.option_shares_1} />
                <Flex width={"100%"}>
                    <Text mr={2}>{hexToAscii(bet?.option_2)}  {" "}</Text>
                    <Text> - {lmsr?.option_shares_2} Shares</Text>
                </Flex>
                 <Progress width={"50%"} colorScheme='red' size='sm' value={lmsr?.option_shares_2} />

            </Stack>

            <StatGroup >
              <Stat mr={20}>
                <StatLabel fontSize={"lg"}>{hexToAscii(bet?.option_1)}</StatLabel>
                <StatNumber>{"$"}{currentPrice?.val1.toFixed(2)}</StatNumber>
                <StatHelpText>
                  <StatArrow type='increase' />
                </StatHelpText>
              </Stat>

              <Stat>
                <StatLabel fontSize={"lg"}>{hexToAscii(bet?.option_2)}</StatLabel>
                <StatNumber>{"$"}{currentPrice?.val2.toFixed(2)}</StatNumber>
                <StatHelpText>
                  <StatArrow type='decrease' />
                </StatHelpText>
              </Stat>
            </StatGroup>
            </Flex>

            

            <Divider my={10}></Divider>

            <h2 style={{color: "#CCCCFF"}} className="text-md font-jbm font-bold">About the Logarithmic Market Scoring Rule</h2>
            <Text fontSize={"sm"} mb={20} className="font-jbm">
                The Logarithmic Market Scoring Rule (LMSR) is a mathematical tool used to evaluate the accuracy of predictions. 
                It's designed to encourage honesty and precision when making predictions about uncertain events.

            

            </Text>

        </Stack>
        {bet.status === 0 ? (
            <Stack width={"30%"} ml={20}>
                <div style={{ color: 'white', backgroundColor: '#18191C' }} className="font-jbm p-4 rounded-lg border-2 border-[#CCCCFF] shadow-md w-full max-w-sm mx-auto">
                  <div className="text-center mb-4">
                    <h2 className="text-lg font-bold">Buy Bet</h2>
                    {bet && <h3 className="text-sm text-gray-300 mt-2">{hexToAscii(bet?.question)}</h3>}
                  </div>

          {bet && (
            <>
              <div className="flex flex-col items-center mb-4">
                <button
                  onClick={() => handleOptionClick(bet?.option_1)}
                  className={`text-white font-bold py-2 px-4 mb-2 rounded ${selectedOption === bet?.option_1 ? 'bg-green-600' : 'hover:bg-green-600'}`}
                  style={{
                    borderColor: '#008000',
                    borderWidth: '2px',
                    minWidth: '100px',
                    width: '100%',
                  }}
                >
                  Bet {hexToAscii(bet.option_1)}
                </button>
                <button
                  onClick={() => handleOptionClick(bet?.option_2)}
                  className={`text-white font-bold py-2 px-4 rounded ${selectedOption === bet?.option_2 ? 'bg-red-600' : 'hover:bg-red-600'}`}
                  style={{
                    borderColor: '#FF0000',
                    borderWidth: '2px',
                    minWidth: '100px',
                    width: '100%',
                  }}
                >
                  Bet {hexToAscii(bet?.option_2)}
                </button>
              </div>

              <div className="flex flex-col items-center mb-4">
                {/* Balance and Max Buttons Above Input */}
                {/* <div className="flex justify-between w-full mb-2">
                  <button
                    className="text-white font-bold py-1 px-2 rounded"
                    
                  >
                    Balance : $40.50
                  </button>
                  {/* <button
                    className="text-white font-bold py-1 px-2 rounded bg-[#CCCCFF] hover:bg-gray-600"
                    style={{ borderColor: '#333', borderWidth: '2px', minWidth: '60px' }}
                  >
                    Max
                  </button> */}
                {/* </div> */} 

                {/* Input Field and Increment/Decrement Buttons */}
                <div className="flex flex-row items-center w-max mb-4">
                  <button
                    onClick={decrementAmount}
                    className="text-white font-bold py-2 px-4 rounded-l bg-[#CCCCFF] hover:bg-gray-600"
                    style={{ borderColor: '#333', borderWidth: '2px' }}
                  >
                    -
                  </button>
                  <input
                    type="number"
                    value={amount.toFixed(2)}
                    onChange={handleInputChange}
                    placeholder="$0.0"
                    className="text-black py-2 px-4 w-32 text-center"
                    style={{ borderColor: '#333', borderWidth: '2px', borderLeft: 'none', borderRight: 'none' }}
                  />
                  <button
                    onClick={incrementAmount}
                    className="text-white font-bold py-2 px-4 rounded-r bg-[#CCCCFF] hover:bg-gray-600"
                    style={{ borderColor: '#333', borderWidth: '2px' }}
                  >
                    +
                  </button>
                </div>

                {/* BUY Button */}
                <button
                  onClick={handleBuyClick}
                  className="text-black font-bold py-2 px-4 rounded bg-[#ebebf0] hover:bg-[#CCCCFF] hover:text-white"
                  style={{ borderColor: '#333', borderWidth: '2px', width: '100%' }}
                  disabled={!selectedOption || amount <= 0 || !predictionMarketCid}
                >
                  {!predictionMarketCid && account ? "Loading market…" : "BUY"}
                </button>
                <div className="flex flex-col m-1 text-gray-500 text-sm justify-between font-jbm">
                    <p className='font-jbm'>⚠️ Due to slippage tolerance, price may vary.</p>
                  </div>
              </div>
            </>
          )}
                </div>
            </Stack>
        ) : (
            <Stack width={"30%"} ml={20}>
                <div style={{ color: 'white', backgroundColor: '#18191C' }} className="font-jbm p-4 rounded-lg border-2 border-[#CCCCFF] shadow-md w-full max-w-sm mx-auto">
                  <div className="text-center mb-4">
                    <h2 className="text-lg font-bold">Market Result</h2>
                    <Text color="#CCCCFF" fontSize="lg" mt={4}>
                        {getResultText()}
                    </Text>
                  </div>
                </div>
            </Stack>
        )}
    </Flex>}
    </>
  );
};

export default BetBuyCard;