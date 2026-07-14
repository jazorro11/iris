import { NextResponse } from "next/server";
import { createChatModel } from "@iris/agent";
import {
  createServerClient, getConversacionActiva, getHarvestMessages, addHarvestMessage,
  guardarDatasetRecord, cerrarConversacion, bumpTurno, updateYaVisto,
} from "@iris/db";
import {
  getPersona, evaluarGuardrails, siguienteTurno, extraerRegistro, espejarDataset, harvestEnv, RESPONSE_DELAY_MS,
  type HistItem,
} from "@iris/harvest";
import { sendHarvestMessage } from "@/lib/telegram/harvest-send";

export const runtime = "nodejs";
export const maxDuration = 60;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: Request) {
  const { webhookSecret, ownerChatId } = harvestEnv();
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!webhookSecret || secret !== webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as
    | { update_id?: number; message?: { chat?: { id?: number }; text?: string } }
    | null;
  if (!update?.message?.text || update.update_id == null) return NextResponse.json({ ok: true });
  if (update.message.chat?.id !== ownerChatId) return NextResponse.json({ ok: true });

  const db = createServerClient();

  // Idempotencia: un reintento de Telegram no genera turno duplicado.
  if (await updateYaVisto(db, update.update_id)) return NextResponse.json({ ok: true });

  const conv = await getConversacionActiva(db);
  if (!conv) return NextResponse.json({ ok: true });

  const respuestaDueno = update.message.text.trim();

  try {
    // 1) Guarda la respuesta del dueño en el turno actual del comprador.
    await addHarvestMessage(db, conv.id, "dueño", respuestaDueno, conv.turno_actual);

    // 2) Historial completo (incluye la respuesta recién guardada).
    const historial = (await getHarvestMessages(db, conv.id)) as HistItem[];
    const ultimoComprador = [...historial].reverse().find((h) => h.rol === "comprador")?.texto ?? "";
    const contextoPrevio = historial.slice(0, -1).map((h) => `${h.rol}: ${h.texto}`).join(" | ").slice(0, 1000);

    // 3) Cosecha el par → dataset local + espejo Langfuse.
    const rec = await extraerRegistro(createChatModel(), {
      conversationId: conv.id, personaKey: conv.persona_key, turno: conv.turno_actual,
      mensajeComprador: ultimoComprador, respuestaDueno, contextoPrevio,
    });
    const itemId = await espejarDataset(rec);
    await guardarDatasetRecord(db, rec, itemId);

    // 4) Guardrails.
    const g = evaluarGuardrails({ turnosComprador: conv.turno_actual, ultimoTextoDueno: respuestaDueno });
    if (g.accion === "detener") {
      await cerrarConversacion(db, conv.id, "detenida", g.motivo);
      return NextResponse.json({ ok: true });
    }

    // 5) Siguiente turno del comprador.
    const persona = getPersona(conv.persona_key);
    const turno = await siguienteTurno(createChatModel({ temperature: 0.7 }), persona, historial);
    if (turno.fin) {
      await cerrarConversacion(db, conv.id, "terminada", "persona finalizó");
      return NextResponse.json({ ok: true });
    }

    // 6) Persiste, avanza el turno y envía (con delay para no sonar robótico).
    const nuevoTurno = conv.turno_actual + 1;
    await addHarvestMessage(db, conv.id, "comprador", turno.texto, nuevoTurno);
    await bumpTurno(db, conv.id, nuevoTurno);
    await delay(RESPONSE_DELAY_MS);
    await sendHarvestMessage(ownerChatId, turno.texto);
  } catch (err) {
    console.error("[harvest] error procesando turno:", err);
  }

  return NextResponse.json({ ok: true });
}
