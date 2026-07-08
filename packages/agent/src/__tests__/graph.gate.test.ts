import { test } from "node:test";
import assert from "node:assert/strict";
import { decideBriefIntent } from "../graph.js";

test("handoff manda sobre todo", () => {
  assert.equal(decideBriefIntent({ handoff: true, estado: "en_aclaracion", tieneStones: false, rondas: 1 }), "handoff");
});

test("con piedras que mostrar → asesorar aunque falten datos", () => {
  assert.equal(decideBriefIntent({ handoff: false, estado: "en_aclaracion", tieneStones: true, rondas: 1 }), "asesorar");
});

test("estado completo → asesorar", () => {
  assert.equal(decideBriefIntent({ handoff: false, estado: "completo", tieneStones: false, rondas: 1 }), "asesorar");
});

test("válvula de escape: tras MAX_RONDAS incompleto y sin piedras → asesorar", () => {
  assert.equal(decideBriefIntent({ handoff: false, estado: "en_aclaracion", tieneStones: false, rondas: 4 }), "asesorar");
});

test("incompleto, sin piedras, pocas rondas → aclarar", () => {
  assert.equal(decideBriefIntent({ handoff: false, estado: "en_aclaracion", tieneStones: false, rondas: 1 }), "aclarar");
});
