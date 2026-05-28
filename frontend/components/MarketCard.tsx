import { Avatar, Flex, Stack, Text } from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";

export type MarketCardProps = {
  /** Stable id for routing — typically the Daml `marketId`. */
  id: string | number;
  question: string;
  imageUrl: string;
  /** 0 = active (PredictionMarket), 1 = expired/resolved (ResolvedMarket). */
  status: 0 | 1;
  /** Daml `MarketResult` variant for resolved markets. */
  result?: "Yes" | "No" | "Draw" | string;
};

const MarketCard = (props: MarketCardProps) => {
  const navigate = useNavigate();
  const statusParam = props.status === 0 ? "active" : "resolved";
  const handleCardClick = () => navigate(`/market/${props.id}?status=${statusParam}`);

  const resultText = (() => {
    if (props.status === 0) return null;
    if (props.result === "Yes") return "Winner: Yes";
    if (props.result === "No") return "Winner: No";
    if (props.result === "Draw") return "Draw";
    return "Market Resolved";
  })();

  return (
    <Stack
      width={"350px"}
      height={"200px"}
      bg={"#18191C"}
      className="rounded-lg shadow-md p-4 font-jbm cursor-pointer"
      key={String(props.id)}
      color={"white"}
      onClick={handleCardClick}
    >
      <Flex height={"80%"}>
        <Avatar mt={3} name="TruthOracle" src={props.imageUrl} />
        <div
          style={{
            fontWeight: "bold",
            marginTop: "10px",
            marginLeft: "10px",
            fontSize: "17px",
          }}
          className="font-jbm"
        >
          {props.question}
        </div>
      </Flex>

      {props.status === 0 ? (
        <div className="px-4 pb-2 flex justify-between font-jbm">
          <button
            onClick={handleCardClick}
            style={{
              borderColor: "#008000",
              width: "50%",
              borderWidth: "2px",
              padding: "10px",
              minWidth: "80px",
              maxWidth: "150px",
              wordBreak: "break-word",
              textAlign: "center",
              fontSize: "12px",
            }}
            className="text-white font-bold hover:bg-green-600"
          >
            Bet Yes
          </button>
          <button
            onClick={handleCardClick}
            style={{
              borderColor: "#FF0000",
              width: "50%",
              borderWidth: "2px",
              padding: "5px 10px",
              minWidth: "80px",
              maxWidth: "150px",
              wordBreak: "break-word",
              textAlign: "center",
              fontSize: "12px",
            }}
            className="text-white font-bold hover:bg-red-600"
          >
            Bet No
          </button>
        </div>
      ) : (
        <div className="px-4 pb-2 font-jbm">
          <Text color="#CCCCFF" fontSize="sm" textAlign="center">
            {resultText}
          </Text>
        </div>
      )}
    </Stack>
  );
};

export default MarketCard;
