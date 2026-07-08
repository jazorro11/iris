import { NextResponse } from "next/server";
import { createServerClient, upsertLead, addLeadMessage, matchInventory, getRecentMessages } from "@iris/db";
import { runIris, createChatModel, extractRequest, createComposerModel, composeReply, classifyIntent, forgetUser, type IrisDeps } from "@iris/agent";
import { sendTelegramMessage, sendTelegramPhoto } from "@/lib/telegram/send";
import { parseTelegramUpdate } from "@/lib/telegram/parse";
import { parseCommand } from "@/lib/telegram/commands";

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

  // Los comandos se manejan antes del pipeline normal (no se guardan como mensajes).
  const command = parseCommand(parsed.text);
  if (command?.name === "olvidar") {
    if (!command.confirm) {
      await sendTelegramMessage(
        parsed.chatId,
        "⚠️ Esto borra de forma permanente toda nuestra conversación y tus datos.\n\nSi estás seguro, responde: /olvidar confirmar"
      );
    } else {
      try {
        await forgetUser(parsed.telegramUserId);
        await sendTelegramMessage(
          parsed.chatId,
          "Listo, borré toda tu información y nuestra conversación. Si me escribes de nuevo, empezamos de cero. 👋"
        );
      } catch (err) {
        console.error("[iris] error procesando /olvidar:", err);
        await sendTelegramMessage(parsed.chatId, "Hubo un error al borrar tus datos. Intenta de nuevo en un momento.");
      }
    }
    return NextResponse.json({ ok: true });
  }

  const db = createServerClient();
  const model = createChatModel();
  const composerModel = createComposerModel();
  const sellerRaw = process.env.SELLER_TELEGRAM_CHAT_ID;
  const sellerChatId = sellerRaw && sellerRaw.trim() ? Number(sellerRaw) : NaN;

  // Historial ANTES de guardar el mensaje actual (para que getHistory no lo incluya).
  const previas = await getRecentMessages(db, parsed.telegramUserId, 6);

  const deps: IrisDeps = {
    extract: (text) => extractRequest(model, text),
    classifyIntent: (text) => classifyIntent(model, text),
    saveLead: (row) => upsertLead(db, row),
    notifySeller: async (text) => {
      if (Number.isFinite(sellerChatId)) await sendTelegramMessage(sellerChatId, text);
    },
    matchInventory: (solicitud) => matchInventory(db, solicitud),
    compose: (brief) => composeReply(composerModel, brief),
    getHistory: async () => previas,
    summarize: async ({ previo, userMessage, reply }) => {
      const res = await model.invoke([
        { role: "system", content: "Actualiza en 2-4 frases el resumen de una conversación de venta de esmeraldas: qué pidió el cliente, qué se le mostró, sus preferencias y el próximo paso. Devuelve solo el resumen." },
        { role: "user", content: `Resumen previo: ${previo || "(vacío)"}\nCliente dijo: ${userMessage}\nIris respondió: ${reply}` },
      ]);
      return typeof res.content === "string" ? res.content.trim() : String(res.content ?? "").trim();
    },
  };

  try {
    await addLeadMessage(db, parsed.telegramUserId, "comprador", parsed.text);
    const { reply, mediaUrl } = await runIris(deps, parsed);
    await addLeadMessage(db, parsed.telegramUserId, "agente", reply);

    // Telegram limita captions a 1024 chars. Si el reply supera ese límite mandamos
    // la foto sin caption y luego el texto completo por separado.
    const CAPTION_LIMIT = 1024;
    if (mediaUrl) {
      const caption = reply.length <= CAPTION_LIMIT ? reply : undefined;
      const sentPhoto = await sendTelegramPhoto(parsed.chatId, mediaUrl, caption);
      if (!sentPhoto) {
        await sendTelegramMessage(parsed.chatId, reply);
      } else if (!caption) {
        await sendTelegramMessage(parsed.chatId, reply);
      }
    } else {
      await sendTelegramMessage(parsed.chatId, reply);
    }
  } catch (err) {
    console.error("[iris] error procesando mensaje:", err);
    await sendTelegramMessage(parsed.chatId, "Hubo un error procesando tu mensaje. Intenta de nuevo.");
  }

  return NextResponse.json({ ok: true });
}
