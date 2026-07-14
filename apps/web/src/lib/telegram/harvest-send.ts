export async function sendHarvestMessage(chatId: number, text: string, replyMarkup?: unknown): Promise<void> {
  const token = process.env.HARVEST_BOT_TOKEN ?? "";
  if (!token) {
    console.warn("[harvest] HARVEST_BOT_TOKEN no configurado, se omite el envío");
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error("[harvest] sendMessage falló:", res.status, body);
  }
}
