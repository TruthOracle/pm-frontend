/**
 * Canton message content: wire to Canton participant API if you have a message template.
 * Returns empty string until integrated with your Canton participant.
 */
export const getMessageContent = async (): Promise<string> => {
  try {
    // TODO: query Canton participant for message content if applicable
    return "";
  } catch (error) {
    console.error(error);
    return "";
  }
};
