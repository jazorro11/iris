export const MAX_TURNOS = 10;

/** Palabras del dueño que detienen la cosecha (word-boundary, case-insensitive). */
export const STOP_WORDS = /\b(pausa|para|basta)\b|¿?\s*eres un bot\s*\??/i;

export const RESPONSE_DELAY_MS = 4000;

export function harvestEnv(): { botToken: string; webhookSecret: string; ownerChatId: number } {
  return {
    botToken: process.env.HARVEST_BOT_TOKEN ?? "",
    webhookSecret: process.env.HARVEST_WEBHOOK_SECRET ?? "",
    ownerChatId: Number(process.env.OWNER_HARVEST_CHAT_ID ?? NaN),
  };
}
