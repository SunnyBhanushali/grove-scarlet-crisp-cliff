import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HR_RESET_MESSAGE,
  hasPublicMailbox,
  passwordResetClientPayload,
} from "./password-reset-payload.ts";

describe("passwordResetClientPayload", () => {
  it("unknown login is ok only", () => {
    assert.deepEqual(
      passwordResetClientPayload({
        found: false,
        hasPublicEmail: false,
        mailed: false,
        live: true,
        temp: "secret",
        previewLink: "https://x/login?reset=1",
      }),
      { ok: true },
    );
  });

  it("no real email / @aliens.local → needHr, never preview", () => {
    const r = passwordResetClientPayload({
      found: true,
      hasPublicEmail: false,
      mailed: false,
      live: true,
      temp: "secret",
      previewLink: "https://x/login?reset=1",
    });
    assert.equal(r.needHr, true);
    assert.equal(r.message, HR_RESET_MESSAGE);
    assert.equal("previewLink" in r, false);
    assert.equal("previewPassword" in r, false);
  });

  it("SMTP ok → emailed+sent, no preview", () => {
    const r = passwordResetClientPayload({
      found: true,
      hasPublicEmail: true,
      mailed: true,
      live: true,
      temp: "secret",
    });
    assert.deepEqual(r, { ok: true, emailed: true, sent: true });
  });

  it("SMTP fail on live → needHr, never previewLink", () => {
    const r = passwordResetClientPayload({
      found: true,
      hasPublicEmail: true,
      mailed: false,
      live: true,
      temp: "secret",
      previewLink: "https://app.alienstattoo.in/login?reset=abc",
    });
    assert.equal(r.needHr, true);
    assert.equal("previewLink" in r, false);
    assert.equal("previewPassword" in r, false);
  });

  it("SMTP fail off live → preview allowed", () => {
    const r = passwordResetClientPayload({
      found: true,
      hasPublicEmail: true,
      mailed: false,
      live: false,
      temp: "Abcd-efgh-12",
      previewLink: "http://127.0.0.1/login?reset=x",
    });
    assert.equal(r.previewPassword, "Abcd-efgh-12");
    assert.ok(r.previewLink);
    assert.equal(r.needHr, undefined);
  });
});

describe("hasPublicMailbox", () => {
  it("rejects empty and @aliens.local", () => {
    assert.equal(hasPublicMailbox(""), false);
    assert.equal(hasPublicMailbox("sunny.b@aliens.local"), false);
    assert.equal(hasPublicMailbox("not-an-email"), false);
  });
  it("accepts real mailboxes", () => {
    assert.equal(hasPublicMailbox("hr@alienstattoos.com"), true);
  });
});
