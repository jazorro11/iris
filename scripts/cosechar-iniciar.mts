// Inicia una conversación de cosecha con el dueño. Uso:
//   npx tsx --env-file=apps/web/.env scripts/cosechar-iniciar.mts <persona_key>
// Los barrels (export *) de @iris/db y @iris/harvest no surfacean sus re-exports bajo tsx; subpath directo.
import { createServerClient } from "../packages/db/src/client.ts";
import { getConversacionActiva, crearConversacion, addHarvestMessage } from "../packages/db/src/queries/harvest.ts";
import { getPersona } from "../packages/harvest/src/personas.ts";
import { iniciarConversacion } from "../packages/harvest/src/iniciar.ts";
import { harvestEnv } from "../packages/harvest/src/config.ts";
import { sendHarvestMessage } from "../apps/web/src/lib/telegram/harvest-send.ts";

const key = process.argv[2];
if (!key) { console.error("Falta persona_key. Ej: cosechar-iniciar.mts inversionista"); process.exit(1); }

const persona = getPersona(key);
const { ownerChatId } = harvestEnv();
if (!Number.isFinite(ownerChatId)) { console.error("OWNER_HARVEST_CHAT_ID no configurado"); process.exit(1); }

const db = createServerClient();
const res = await iniciarConversacion(
  {
    hayActiva: async () => !!(await getConversacionActiva(db)),
    crear: (k) => crearConversacion(db, k, ownerChatId),
    guardarPrimerMensaje: (id, texto) => addHarvestMessage(db, id, "comprador", texto, 1),
    enviar: (texto) => sendHarvestMessage(ownerChatId, texto),
  },
  persona,
);

if (res.estado === "ya-activa") {
  console.error("Ya hay una conversación activa. Ciérrala con cosechar-detener.mts antes de iniciar otra.");
  process.exit(1);
}
console.log(`Conversación ${res.conversationId} iniciada con persona "${persona.key}". Primer mensaje enviado al dueño.`);
