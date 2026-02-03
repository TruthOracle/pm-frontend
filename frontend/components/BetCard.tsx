import { Avatar, Flex, Stack, Text } from '@chakra-ui/react';
import {useEffect, useState} from 'react';
import { useNavigate } from 'react-router-dom'; 

type Props = {
    id: string,
    createdAt: string,
    image_url: string;
    question: string;
    option_1: string;
    option_2: string;
    status: number;
    result?: number;
};

const BetCard = (props: Props) => {
    const navigate = useNavigate(); 
    const [imageURL, setImageURL] = useState<any>("");

    const handleCardClick = () => {
        navigate(`/bet/${props.id}`);
    };

    useEffect(() => {
        setImageURL(hexToAscii(props.image_url));
    }, [props]);

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

    const getResultText = () => {
        if (props.status === 0) return null;
        if (props.result === 0) return `Winner: ${hexToAscii(props.option_1)}`;
        if (props.result === 1) return `Winner: ${hexToAscii(props.option_2)}`;
        return "Market Expired";
    };

    return (
        <Stack 
            width={"350px"} 
            height={"200px"} 
            bg={"#18191C"} 
            className="rounded-lg shadow-md p-4 font-jbm cursor-pointer" 
            key={props.id} 
            color={"white"}
            onClick={handleCardClick} 
        >
            <Flex height={"80%"}>
                <Avatar mt={3} name='TruthOracle' src={imageURL} />
                <div style={{ fontWeight: "bold", marginTop: "10px", marginLeft: "10px", fontSize: "17px" }} className='font-jbm'>
                    {hexToAscii(props.question)}
                </div>
            </Flex>

            {/* Show result for expired markets, trading buttons for active markets */}
            {props.status === 0 ? (
                <div className="px-4 pb-2 flex justify-between font-jbm">
                    <button
                        onClick={handleCardClick} 
                        style={{
                            borderColor: "#008000",
                            width: "50%",
                            borderWidth: "2px",
                            height: "auto", 
                            padding: "10px 10px", 
                            minWidth: "80px",
                            maxWidth: "150px", 
                            wordBreak: "break-word", 
                            textAlign: "center",
                            fontSize: "12px", 
                        }}
                        className="text-white font-bold hover:bg-green-600"
                    >
                        Bet {hexToAscii(props.option_1)}
                    </button>
                    <button
                        onClick={handleCardClick}
                        style={{
                            borderColor: "#FF0000",
                            width: "50%",
                            borderWidth: "2px",
                            height: "auto", 
                            padding: "5px 10px", 
                            minWidth: "80px",
                            maxWidth: "150px", 
                            wordBreak: "break-word", 
                            textAlign: "center",
                            fontSize: "12px", 
                        }}
                        className="text-white font-bold hover:bg-red-600"
                    >
                        Bet {hexToAscii(props.option_2)}
                    </button>
                </div>
            ) : (
                <div className="px-4 pb-2 font-jbm">
                    <Text color="#CCCCFF" fontSize="sm" textAlign="center">
                        {getResultText()}
                    </Text>
                </div>
            )}
        </Stack>
    );
};

export default BetCard;
