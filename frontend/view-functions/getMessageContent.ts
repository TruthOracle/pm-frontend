/**
 * Canton message content: wire to Canton participant API if you have a message template.
 * Returns empty string until integrated with your Canton participant.
 */
import { debugError } from "@/lib/debugLog";
export const getMessageContent = async (): Promise<string> => {
  try {
    // TODO: query Canton participant for message content if applicable
    return "";
  } catch (error) {
    debugError("getMessageContent failed", error);
    return "";
  }
};
