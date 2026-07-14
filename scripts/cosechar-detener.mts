// Detiene toda conversación de cosecha activa. Uso:
//   npx tsx --env-file=apps/web/.env scripts/cosechar-detener.mts
import { createServerClient } from "../packages/db/src/index.ts";
// El barrel de @iris/db (export *) no surfacea sus re-exports bajo tsx; subpath directo.
import { marcarTodasDetenidas } from "../packages/db/src/queries/harvest.ts";

const db = createServerClient();
const n = await marcarTodasDetenidas(db, "kill-switch manual");
console.log(`Detenidas ${n} conversación(es) activa(s).`);
