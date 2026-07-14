import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHarvestMessage } from "../telegramParse.js";

test("texto solo → respuestaDueno = texto, sin foto", () => {
  const r = parseHarvestMessage({ text: "hola" });
  assert.deepEqual(r, { respuestaDueno: "hola", fotoFileId: null });
});

test("foto con caption y varios tamaños → toma el file_id del último tamaño", () => {
  const r = parseHarvestMessage({
    caption: "Muzo 1.26ct $5800",
    photo: [
      { file_id: "small_id" },
      { file_id: "medium_id" },
      { file_id: "large_id" },
    ],
  });
  assert.equal(r?.respuestaDueno, "[foto] Muzo 1.26ct $5800");
  assert.equal(r?.fotoFileId, "large_id");
});

test("foto sin caption → respuestaDueno marcador, conserva fotoFileId", () => {
  const r = parseHarvestMessage({ photo: [{ file_id: "only_id" }] });
  assert.deepEqual(r, { respuestaDueno: "[foto sin texto]", fotoFileId: "only_id" });
});

test("mensaje vacío → null", () => {
  const r = parseHarvestMessage({});
  assert.equal(r, null);
});
