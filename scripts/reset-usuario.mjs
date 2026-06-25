// Resetea un usuario de Telegram para repetir una prueba en vivo.
// Uso: node scripts/reset-usuario.mjs <telegram_user_id>
// Borra el estado de la conversación (checkpointer de LangGraph) y el lead.
// La misma lógica está expuesta al bot vía el comando /olvidar
// (packages/agent/src/forget.ts) — mantener la lista de tablas en sync.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const id = process.argv[2];
if (!id || !/^\d+$/.test(id)) {
  console.error("Uso: node scripts/reset-usuario.mjs <telegram_user_id>");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(path.join(root, "apps/web/.env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
if (!env.DATABASE_URL) throw new Error("DATABASE_URL no encontrado en apps/web/.env");

const client = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

// El checkpointer indexa por thread_id (string del id de Telegram).
for (const t of ["checkpoint_writes", "checkpoint_blobs", "checkpoints"]) {
  const r = await client.query(`delete from public.${t} where thread_id = $1`, [id]);
  console.log(`${t}: ${r.rowCount} filas borradas`);
}
for (const t of ["lead_messages", "leads"]) {
  const r = await client.query(`delete from public.${t} where telegram_user_id = $1`, [Number(id)]);
  console.log(`${t}: ${r.rowCount} filas borradas`);
}

await client.end();
console.log(`OK — usuario ${id} reseteado. Ya puedes escribirle al bot de nuevo.`);
