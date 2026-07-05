import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, INTENT_SYSTEM_PROMPT, DEFAULT_INTENT, type IntentFlags } from "../intent.js";
import type { StructuredModel } from "../extractor.js";

function fakeModel(fixture: unknown, captured: { input?: unknown }): StructuredModel {
  return {
    withStructuredOutput() {
      return { invoke: async (input: unknown) => { captured.input = input; return fixture; } };
    },
  };
}

test("classifyIntent devuelve las banderas validadas y pasa el system prompt", async () => {
  const captured: { input?: unknown } = {};
  const model = fakeModel({ handoff: true, preguntaProfunda: false, idioma: "es" }, captured);
  const out = await classifyIntent(model, "quiero comprar esta, ¿cómo pago?");
  assert.deepEqual(out, { handoff: true, preguntaProfunda: false, idioma: "es" });
  const msgs = captured.input as Array<{ role: string; content: string }>;
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs[0].content, INTENT_SYSTEM_PROMPT);
  assert.equal(msgs[1].content, "quiero comprar esta, ¿cómo pago?");
});

test("classifyIntent rechaza salidas mal formadas", async () => {
  const model = fakeModel({ handoff: "sí" }, {});
  await assert.rejects(() => classifyIntent(model, "texto"));
});

test("DEFAULT_INTENT es todo-false", () => {
  assert.deepEqual(DEFAULT_INTENT, { handoff: false, preguntaProfunda: false, idioma: "es" } satisfies IntentFlags);
});

test("INTENT_SYSTEM_PROMPT describe handoff y preguntaProfunda", () => {
  assert.match(INTENT_SYSTEM_PROMPT, /handoff/i);
  assert.match(INTENT_SYSTEM_PROMPT, /profunda|profund/i);
});
