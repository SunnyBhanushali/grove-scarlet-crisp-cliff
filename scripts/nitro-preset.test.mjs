import assert from "node:assert/strict";
import test from "node:test";
import { NODE_SERVER_PRESET, resolveNitroPreset } from "./nitro-preset.mjs";

test("always node-server even when the platform injects vercel", () => {
  assert.equal(resolveNitroPreset({}), NODE_SERVER_PRESET);
  assert.equal(resolveNitroPreset({ NITRO_PRESET: "vercel" }), NODE_SERVER_PRESET);
  assert.equal(resolveNitroPreset({ NITRO_PRESET: "netlify" }), NODE_SERVER_PRESET);
  assert.equal(resolveNitroPreset({ NITRO_PRESET: "node-server" }), NODE_SERVER_PRESET);
});
