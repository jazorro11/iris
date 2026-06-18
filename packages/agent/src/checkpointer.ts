import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

let _saver: PostgresSaver | null = null;

/** Singleton PostgresSaver respaldado por DATABASE_URL (conexión directa, no-pooler). */
export async function getCheckpointer(): Promise<PostgresSaver> {
  if (!_saver) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL es requerido para el checkpointing de LangGraph");
    _saver = PostgresSaver.fromConnString(url);
    await _saver.setup();
  }
  return _saver;
}
