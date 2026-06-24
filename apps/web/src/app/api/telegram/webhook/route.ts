import { NextResponse } from "next/server";
import { createServerClient, upsertLead, addLeadMessage, matchInventory } from "@iris/db";
import { runIris, createChatModel, extractRequest, createComposerModel, composeReply, type IrisDeps } from "@iris/agent";
import { sendTelegramMessage } from "@/lib/telegram/send";
import { parseTelegramUpdate } from "@/lib/telegram/parse";

export const runtime = "nodejs";
export const maxDuration = 60;

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

export async function POST(request: Request) {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = parseTelegramUpdate(await request.json());
  if (!parsed) return NextResponse.json({ ok: true });

  const db = createServerClient();
  const model = createChatModel();
  const composerModel = createComposerModel();
  const sellerRaw = process.env.SELLER_TELEGRAM_CHAT_ID;
  const sellerChatId = sellerRaw && sellerRaw.trim() ? Number(sellerRaw) : NaN;

  const deps: IrisDeps = {
    extract: (text) => extractRequest(model, text),
    saveLead: (row) => upsertLead(db, row),
    notifySeller: async (text) => {
      if (Number.isFinite(sellerChatId)) await sendTelegramMessage(sellerChatId, text);
    },
    matchInventory: (solicitud) => matchInventory(db, solicitud),
    compose: (brief) => composeReply(composerModel, brief),
  };

  try {
    await addLeadMessage(db, parsed.telegramUserId, "comprador", parsed.text);
    const { reply } = await runIris(deps, parsed);
    await addLeadMessage(db, parsed.telegramUserId, "agente", reply);
    await sendTelegramMessage(parsed.chatId, reply);
  } catch (err) {
    console.error("[iris] error procesando mensaje:", err);
    await sendTelegramMessage(parsed.chatId, "Hubo un error procesando tu mensaje. Intenta de nuevo.");
  }

  return NextResponse.json({ ok: true });
}
