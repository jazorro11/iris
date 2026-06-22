import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTelegramUpdate } from "../parse.js";

test("parseTelegramUpdate extrae user/chat/text de un mensaje", () => {
  const parsed = parseTelegramUpdate({
    update_id: 1,
    message: { message_id: 5, from: { id: 42, username: "ana" }, chat: { id: 99 }, text: "  hola  " },
  });
  assert.deepEqual(parsed, { telegramUserId: 42, chatId: 99, telegramUsername: "ana", text: "hola" });
});

test("parseTelegramUpdate devuelve null si no hay texto", () => {
  assert.equal(parseTelegramUpdate({ update_id: 1, message: { from: { id: 1 }, chat: { id: 1 } } }), null);
});

test("parseTelegramUpdate devuelve null para updates no-mensaje", () => {
  assert.equal(parseTelegramUpdate({ update_id: 1 }), null);
});
