interface TelegramMessage {
  from?: { id?: number; username?: string };
  chat?: { id?: number };
  text?: string;
}

export function parseTelegramUpdate(
  update: unknown
): { telegramUserId: number; chatId: number; telegramUsername?: string; text: string } | null {
  const u = update as { message?: TelegramMessage };
  const msg = u?.message;
  const telegramUserId = msg?.from?.id;
  const chatId = msg?.chat?.id;
  const text = msg?.text?.trim();
  if (typeof telegramUserId !== "number" || typeof chatId !== "number" || !text) return null;
  return {
    telegramUserId,
    chatId,
    telegramUsername: msg?.from?.username,
    text,
  };
}
