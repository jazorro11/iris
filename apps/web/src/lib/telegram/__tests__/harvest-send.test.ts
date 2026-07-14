import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sendHarvestMessage } from "../harvest-send.js";

const realFetch = globalThis.fetch;
const realToken = process.env.HARVEST_BOT_TOKEN;
afterEach(() => { globalThis.fetch = realFetch; process.env.HARVEST_BOT_TOKEN = realToken; });

function stubFetch() {
  process.env.HARVEST_BOT_TOKEN = "test-token";
  let body: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
  return () => body;
}

test("sin replyMarkup no incluye reply_markup en el body", async () => {
  const getBody = stubFetch();
  await sendHarvestMessage(123, "hola");
  const body = getBody()!;
  assert.equal(body.chat_id, 123);
  assert.equal(body.text, "hola");
  assert.equal("reply_markup" in body, false);
});

test("con replyMarkup lo adjunta al body", async () => {
  const getBody = stubFetch();
  await sendHarvestMessage(123, "hola", { keyboard: [] });
  assert.deepEqual(getBody()!.reply_markup, { keyboard: [] });
});
