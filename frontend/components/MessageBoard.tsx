import { useEffect, useState } from "react";
import { useCantonWallet } from "@/wallets";
import { buildWriteMessageParams } from "@/utils/cantonCommands";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMessageContent } from "@/view-functions/getMessageContent";
import { debugError } from "@/lib/debugLog";

export function MessageBoard() {
  const { account, signAndSubmitTransaction } = useCantonWallet();
  const queryClient = useQueryClient();

  const [messageContent, setMessageContent] = useState<string>();
  const [newMessageContent, setNewMessageContent] = useState<string>();

  const { data } = useQuery({
    queryKey: ["message-content", account?.address],
    refetchInterval: 10_000,
    queryFn: async () => {
      try {
        const content = await getMessageContent();

        return {
          content,
        };
      } catch (error: any) {
        toast({
          variant: "destructive",
          title: "Error",
          description: error,
        });
        return {
          content: "",
        };
      }
    },
  });

  const onClickButton = async () => {
    if (!account || !newMessageContent) {
      return;
    }

    try {
      const params = buildWriteMessageParams(account.address, newMessageContent);
      const result = await signAndSubmitTransaction(params);
      queryClient.invalidateQueries();
      toast({
        title: "Success",
        description: `Transaction succeeded, commandId: ${result.hash}`,
      });
    } catch (error) {
      debugError("Message post failed", error);
    }
  };

  useEffect(() => {
    if (data) {
      setMessageContent(data.content);
    }
  }, [data]);

  return (
    <div className="flex flex-col gap-6">
      <h4 className="text-lg font-medium">Message content: {messageContent}</h4>
      New message{" "}
      <Input disabled={!account} placeholder="yoho" onChange={(e) => setNewMessageContent(e.target.value)} />
      <Button
        disabled={!account || !newMessageContent || newMessageContent.length === 0 || newMessageContent.length > 100}
        onClick={onClickButton}
      >
        Write
      </Button>
    </div>
  );
}
