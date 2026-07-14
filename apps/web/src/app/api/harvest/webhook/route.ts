import { NextResponse } from "next/server";
import { createChatModel } from "@iris/agent";
import {
  createServerClient, getConversacionActiva, getHarvestMessages, addHarvestMessage,
  guardarDatasetRecord, cerrarConversacion, bumpTurno, updateYaVisto,
  crearConversacion, marcarTodasDetenidas, contarConversacionesPorPersona,
} from "@iris/db";
import {
  getPersona, evaluarGuardrails, siguienteTurno, extraerRegistro, espejarDataset, harvestEnv, RESPONSE_DELAY_MS,
  STOP_WORDS, parseHarvestMessage,
  parseHarvestCommand, HARVEST_KEYBOARD, iniciarConversacion, resolverPersona,
  elegirPersonaMenosUsada, listarPerfiles, AYUDA_TEXT, GREETING_TEXT,
  type HistItem, type IniciarDeps,
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
    | {
        update_id?: number;
        message?: { chat?: { id?: number }; text?: string; caption?: string; photo?: { file_id: string }[] };
      }
    | null;
  if (!update?.message || update.update_id == null) return NextResponse.json({ ok: true });
  if (update.message.chat?.id !== ownerChatId) return NextResponse.json({ ok: true });

  const db = createServerClient();

  // Idempotencia: un reintento de Telegram no genera turno duplicado.
  if (await updateYaVisto(db, update.update_id)) return NextResponse.json({ ok: true });

  // Comandos del dueño (teclado persistente + slash). Se manejan antes del flujo de cosecha.
  const command = parseHarvestCommand(update.message.text);
  if (command) {
    await manejarComando(db, ownerChatId, command);
    return NextResponse.json({ ok: true });
  }

  const conv = await getConversacionActiva(db);
  if (!conv) {
    // Mensaje normal sin práctica activa → pista suave (con teclado para descubrimiento).
    await sendHarvestMessage(ownerChatId, "Toca 🆕 Nuevo comprador para empezar una práctica.", HARVEST_KEYBOARD);
    return NextResponse.json({ ok: true });
  }

  const parsed = parseHarvestMessage(update.message);
  if (!parsed) return NextResponse.json({ ok: true });
  const { respuestaDueno, fotoFileId } = parsed;

  try {
    // 1) Guarda la respuesta del dueño en el turno actual del comprador.
    await addHarvestMessage(db, conv.id, "dueño", respuestaDueno, conv.turno_actual, fotoFileId);

    // 2) Historial completo (incluye la respuesta recién guardada).
    const historial = (await getHarvestMessages(db, conv.id)) as HistItem[];
    const ultimoComprador = [...historial].reverse().find((h) => h.rol === "comprador")?.texto ?? "";
    const contextoPrevio = historial.slice(0, -1).map((h) => `${h.rol}: ${h.texto}`).join(" | ").slice(0, 1000);

    // 3) Cosecha el par → dataset local + espejo Langfuse.
    // No cosechar señales de pausa (ruido en el dataset); el guardrail las cierra abajo.
    if (!STOP_WORDS.test(respuestaDueno)) {
      const rec = await extraerRegistro(createChatModel(), {
        conversationId: conv.id, personaKey: conv.persona_key, turno: conv.turno_actual,
        mensajeComprador: ultimoComprador, respuestaDueno, contextoPrevio,
        duenoFotoFileId: fotoFileId,
      });
      const itemId = await espejarDataset(rec);
      await guardarDatasetRecord(db, rec, itemId);
    }

    // 4) Guardrails.
    const g = evaluarGuardrails({ turnosComprador: conv.turno_actual, ultimoTextoDueno: respuestaDueno });
    if (g.accion === "detener") {
      await cerrarConversacion(db, conv.id, "detenida", g.motivo);
      await sendHarvestMessage(ownerChatId, "Perfecto, lo dejamos por ahora. ¡Gracias por tu tiempo! 🙏");
      return NextResponse.json({ ok: true });
    }

    // 5) Siguiente turno del comprador.
    const persona = getPersona(conv.persona_key);
    const turno = await siguienteTurno(createChatModel({ temperature: 0.7 }), persona, historial);
    if (turno.fin) {
      await cerrarConversacion(db, conv.id, "terminada", "persona finalizó");
      await sendHarvestMessage(ownerChatId, "Gracias, lo pienso y te escribo. 🙏");
      return NextResponse.json({ ok: true });
    }

    // 6) Persiste, avanza el turno y envía (con delay para no sonar robótico).
    const nuevoTurno = conv.turno_actual + 1;
    await addHarvestMessage(db, conv.id, "comprador", turno.texto, nuevoTurno);
    await bumpTurno(db, conv.id, nuevoTurno);
    await delay(RESPONSE_DELAY_MS);
    await sendHarvestMessage(ownerChatId, turno.texto);
  } catch (err) {
    console.error(
      `[harvest] turno FALLÓ (conversation=${conv.id}, update_id=${update.update_id}, turno_actual=${conv.turno_actual}). ` +
      `La conversación pudo quedar sin avanzar; revisa y si aplica usa cosechar-detener + relanzar. Error:`,
      err
    );
  }

  return NextResponse.json({ ok: true });
}

/** Ejecuta un comando del dueño (nuevo/detener/perfiles/ayuda/estado/start). */
async function manejarComando(
  db: ReturnType<typeof createServerClient>,
  ownerChatId: number,
  command: NonNullable<ReturnType<typeof parseHarvestCommand>>,
): Promise<void> {
  switch (command.tipo) {
    case "start":
      await sendHarvestMessage(ownerChatId, GREETING_TEXT, HARVEST_KEYBOARD);
      return;
    case "ayuda":
      await sendHarvestMessage(ownerChatId, AYUDA_TEXT, HARVEST_KEYBOARD);
      return;
    case "perfiles":
      await sendHarvestMessage(ownerChatId, listarPerfiles(), HARVEST_KEYBOARD);
      return;
    case "estado": {
      const c = await getConversacionActiva(db);
      const txt = c
        ? `Comprador activo: ${getPersona(c.persona_key).arquetipo} (turno ${c.turno_actual}).`
        : "Sin conversación activa. Toca 🆕 Nuevo comprador para empezar.";
      await sendHarvestMessage(ownerChatId, txt, HARVEST_KEYBOARD);
      return;
    }
    case "detener": {
      const n = await marcarTodasDetenidas(db, "detenida por el dueño");
      const txt = n > 0
        ? "Listo, detuve la práctica. Toca 🆕 Nuevo comprador cuando quieras otra."
        : "No tienes ninguna práctica activa.";
      await sendHarvestMessage(ownerChatId, txt, HARVEST_KEYBOARD);
      return;
    }
    case "nuevo": {
      let persona;
      if (command.arg) {
        const p = resolverPersona(command.arg);
        if (!p) {
          await sendHarvestMessage(ownerChatId, `No reconozco "${command.arg}". Toca 📋 Perfiles para ver las opciones.`, HARVEST_KEYBOARD);
          return;
        }
        persona = p;
      } else {
        persona = getPersona(elegirPersonaMenosUsada(await contarConversacionesPorPersona(db)));
      }
      const deps: IniciarDeps = {
        hayActiva: async () => !!(await getConversacionActiva(db)),
        crear: (key) => crearConversacion(db, key, ownerChatId),
        guardarPrimerMensaje: (id, texto) => addHarvestMessage(db, id, "comprador", texto, 1),
        enviar: (texto, rm) => sendHarvestMessage(ownerChatId, texto, rm),
      };
      const res = await iniciarConversacion(deps, persona, HARVEST_KEYBOARD);
      if (res.estado === "ya-activa") {
        await sendHarvestMessage(ownerChatId, "Ya tienes un comprador activo. Toca ⏹ Detener antes de empezar otro.", HARVEST_KEYBOARD);
      }
      return;
    }
  }
}
