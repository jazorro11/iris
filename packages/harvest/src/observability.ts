import { Langfuse } from "langfuse";
import type { DatasetRecord } from "./types.js";

export const DATASET_NAME = "meraldi-golden-v1";

let cached: Langfuse | null | undefined;

export function getLangfuse(): Langfuse | null {
  if (cached !== undefined) return cached;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    cached = null;
    return null;
  }
  cached = new Langfuse({ publicKey, secretKey, baseUrl: process.env.LANGFUSE_HOST });
  return cached;
}

/** Espeja un registro al Langfuse Dataset. Id determinista = idempotente en re-runs. */
export async function espejarDataset(record: DatasetRecord): Promise<string | null> {
  const lf = getLangfuse();
  if (!lf) return null;
  const id = `${record.conversationId}:${record.turno}`;
  try {
    await lf.createDatasetItem({
      datasetName: DATASET_NAME,
      id,
      input: { mensajeComprador: record.mensajeComprador, contextoPrevio: record.contextoPrevio },
      expectedOutput: record.respuestaDueno,
      metadata: { personaKey: record.personaKey, veta: record.veta, conversationId: record.conversationId, turno: record.turno },
    });
    await lf.flushAsync();
    return id;
  } catch (err) {
    console.error("[harvest] espejarDataset falló (se conserva el registro local):", err);
    return null;
  }
}
