import { test } from "node:test";
import assert from "node:assert/strict";
import { espejarDataset } from "../observability.js";

test("espejarDataset no lanza y devuelve null en modo no-op (sin keys)", async () => {
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  const id = await espejarDataset({
    conversationId: "c1", personaKey: "tecnico", turno: 1,
    mensajeComprador: "x", respuestaDueno: "y", contextoPrevio: "z",
    veta: "producto", notasExtraccion: "n",
  });
  assert.equal(id, null);
});
