import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRequest, EXTRACTION_SYSTEM_PROMPT, type StructuredModel } from "../extractor.js";

function fakeModel(fixture: unknown, captured: { input?: unknown }): StructuredModel {
  return {
    withStructuredOutput() {
      return {
        invoke: async (input: unknown) => {
          captured.input = input;
          return fixture;
        },
      };
    },
  };
}

test("extractRequest devuelve la solicitud validada y pasa el system prompt", async () => {
  const captured: { input?: unknown } = {};
  const model = fakeModel({ proposito: "joyeria", color: { tono: "verde" } }, captured);
  const result = await extractRequest(model, "quiero una esmeralda verde para un anillo");
  assert.equal(result.proposito, "joyeria");
  assert.equal(result.color?.tono, "verde");
  const msgs = captured.input as Array<{ role: string; content: string }>;
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs[0].content, EXTRACTION_SYSTEM_PROMPT);
  assert.equal(msgs[1].content, "quiero una esmeralda verde para un anillo");
});

test("extractRequest rechaza salidas con enums inválidos", async () => {
  const model = fakeModel({ proposito: "no_existe" }, {});
  await assert.rejects(() => extractRequest(model, "texto"));
});

test("EXTRACTION_SYSTEM_PROMPT instruye extraer solo lo explícito", () => {
  assert.match(EXTRACTION_SYSTEM_PROMPT, /expl[ií]cito|no inventes|no asumas/i);
});
