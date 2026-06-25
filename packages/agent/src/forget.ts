import pg from "pg";

/**
 * Borra TODO el estado persistido de un usuario de Telegram.
 *
 * El estado vive en dos lugares:
 *  - El checkpointer de LangGraph (`checkpoints`, `checkpoint_writes`, `checkpoint_blobs`)
 *    indexado por `thread_id` = id de Telegram como string.
 *  - Las tablas de dominio (`leads`, `lead_messages`) por `telegram_user_id` numérico.
 *
 * Misma lista de tablas que `scripts/reset-usuario.mjs` — mantener en sync.
 */
export const CHECKPOINT_TABLES = [
  "checkpoint_writes",
  "checkpoint_blobs",
  "checkpoints",
] as const;
export const LEAD_TABLES = ["lead_messages", "leads"] as const;

export interface ForgetCount {
  table: string;
  deleted: number;
}

/** Ejecutor mínimo de SQL — permite inyectar un cliente falso en tests. */
export interface QueryRunner {
  query(sql: string, params: unknown[]): Promise<{ rowCount: number | null }>;
}

/** Núcleo testeable: borra las filas usando un runner ya conectado. */
export async function forgetUserWith(
  runner: QueryRunner,
  telegramUserId: number
): Promise<ForgetCount[]> {
  const threadId = String(telegramUserId);
  const counts: ForgetCount[] = [];
  // Nombres de tabla provienen de constantes fijas (no de entrada del usuario);
  // el id va siempre parametrizado.
  for (const table of CHECKPOINT_TABLES) {
    const r = await runner.query(`delete from public.${table} where thread_id = $1`, [threadId]);
    counts.push({ table, deleted: r.rowCount ?? 0 });
  }
  for (const table of LEAD_TABLES) {
    const r = await runner.query(`delete from public.${table} where telegram_user_id = $1`, [
      telegramUserId,
    ]);
    counts.push({ table, deleted: r.rowCount ?? 0 });
  }
  return counts;
}

/** Abre una conexión pg de un solo uso (DATABASE_URL) y borra al usuario. */
export async function forgetUser(
  telegramUserId: number,
  databaseUrl: string | undefined = process.env.DATABASE_URL
): Promise<ForgetCount[]> {
  if (!databaseUrl) throw new Error("DATABASE_URL es requerido para olvidar a un usuario");
  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    return await forgetUserWith(client, telegramUserId);
  } finally {
    await client.end();
  }
}
