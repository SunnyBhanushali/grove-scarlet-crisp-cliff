/* Restore progress overlay. Intercepts Settings → Backup → Restore file pick
   so a 5–10 MB parse never fails silently. */
(function () {
  if (window.__apmsRestore) return;

  var STYLE_ID = "apms-restore-overlay-css";
  var ROOT_ID = "apms-restore-overlay";

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent =
      "#" + ROOT_ID + "{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(26,22,18,.55);padding:1.25rem;font-family:'IBM Plex Sans',system-ui,sans-serif;color:#1a1612}" +
      "#" + ROOT_ID + "[hidden]{display:none!important}" +
      "#" + ROOT_ID + " .card{width:min(28rem,100%);background:#f4efe6;border:1px solid #d9d0c3;border-radius:1rem;padding:1.35rem 1.4rem 1.2rem;box-shadow:0 24px 60px rgba(26,22,18,.28)}" +
      "#" + ROOT_ID + " h2{font-family:Fraunces,Georgia,serif;font-size:1.35rem;font-weight:600;margin:0 0 .35rem;letter-spacing:-.02em}" +
      "#" + ROOT_ID + " .step{font-size:.92rem;line-height:1.45;color:#4a453e;margin:0 0 .9rem;min-height:2.6rem}" +
      "#" + ROOT_ID + " .bar{height:.55rem;background:#e6dfd2;border-radius:999px;overflow:hidden}" +
      "#" + ROOT_ID + " .fill{height:100%;width:0;background:#1f3d34;border-radius:999px;transition:width .28s ease}" +
      "#" + ROOT_ID + " .pct{margin:.45rem 0 0;font-size:.75rem;letter-spacing:.04em;text-transform:uppercase;color:#6b6660}" +
      "#" + ROOT_ID + " .ok h2{color:#1f3d34}" +
      "#" + ROOT_ID + " .fail h2{color:#8a2b1e}" +
      "#" + ROOT_ID + " .actions{display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem}" +
      "#" + ROOT_ID + " button{font:inherit;cursor:pointer;border:0;border-radius:.55rem;padding:.55rem 1rem;background:#1f3d34;color:#f4efe6}" +
      "#" + ROOT_ID + " button.ghost{background:transparent;color:#1a1612;border:1px solid #d9d0c3}" +
      "@media (prefers-reduced-motion:reduce){#" + ROOT_ID + " .fill{transition:none}}";
    document.head.appendChild(el);
  }

  function root() {
    var el = document.getElementById(ROOT_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = ROOT_ID;
    el.hidden = true;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "apms-restore-title");
    el.innerHTML =
      '<div class="card">' +
      '<h2 id="apms-restore-title">Restoring</h2>' +
      '<p class="step" id="apms-restore-step">Reading file…</p>' +
      '<div class="bar" aria-hidden="true"><div class="fill" id="apms-restore-fill"></div></div>' +
      '<p class="pct" id="apms-restore-pct">0%</p>' +
      '<div class="actions" id="apms-restore-actions" hidden>' +
      '<button type="button" id="apms-restore-close">Close</button>' +
      "</div></div>";
    document.body.appendChild(el);
    el.querySelector("#apms-restore-close").addEventListener("click", function () {
      var reload = el.getAttribute("data-reload") === "1";
      hide();
      if (reload) location.reload();
    });
    return el;
  }

  function setBar(pct) {
    var n = Math.max(0, Math.min(100, Math.round(pct)));
    var fill = document.getElementById("apms-restore-fill");
    var label = document.getElementById("apms-restore-pct");
    if (fill) fill.style.width = n + "%";
    if (label) label.textContent = n + "%";
  }

  function setStep(text) {
    var step = document.getElementById("apms-restore-step");
    if (step) step.textContent = text;
  }

  function open(text, pct) {
    css();
    var el = root();
    el.hidden = false;
    el.className = "";
    el.removeAttribute("data-reload");
    document.getElementById("apms-restore-title").textContent = "Restoring";
    document.getElementById("apms-restore-actions").hidden = true;
    setStep(text || "Reading file…");
    setBar(pct || 6);
  }

  function hide() {
    var el = document.getElementById(ROOT_ID);
    if (el) el.hidden = true;
  }

  function finish(ok, title, text, reload) {
    var el = root();
    el.className = ok ? "ok" : "fail";
    if (reload) el.setAttribute("data-reload", "1");
    else el.removeAttribute("data-reload");
    document.getElementById("apms-restore-title").textContent = title;
    setStep(text);
    setBar(ok ? 100 : Number(document.getElementById("apms-restore-fill")?.style.width) || 12);
    document.getElementById("apms-restore-actions").hidden = false;
    document.getElementById("apms-restore-close").textContent = reload ? "Reload" : "Close";
  }

  function paint() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        setTimeout(resolve, 40);
      });
    });
  }

  function unwrap(parsed) {
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.state && typeof parsed.state === "object" && !Array.isArray(parsed.state)) return parsed.state;
    if (Array.isArray(parsed.people) && parsed.roles && typeof parsed.roles === "object") return parsed;
    return null;
  }

  function readFile(file, onPct) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onprogress = function (ev) {
        if (ev.lengthComputable && ev.total) onPct(8 + (ev.loaded / ev.total) * 24);
      };
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("Could not read that file.")); };
      reader.readAsText(file);
    });
  }

  async function run(file) {
    if (!file) return;
    open("Reading " + (file.name || "backup") + "…", 8);
    await paint();
    var raw;
    try {
      raw = await readFile(file, setBar);
    } catch (err) {
      finish(false, "Restore failed", err instanceof Error ? err.message : "Could not read that file.");
      return;
    }
    setStep("Checking snapshot…");
    setBar(36);
    await paint();
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      finish(false, "Restore failed", "That file is not valid JSON.");
      return;
    }
    var snap = unwrap(parsed);
    if (!snap || !Array.isArray(snap.people) || !snap.people.length) {
      finish(false, "Restore failed", "That file is not an Aliens APMS snapshot.");
      return;
    }
    var nPeople = snap.people.length;
    setStep("Writing " + nPeople + " people to the server… this can take a minute.");
    setBar(48);
    var tick = setInterval(function () {
      var cur = parseFloat(document.getElementById("apms-restore-fill")?.style.width || "48");
      if (cur < 88) setBar(cur + 2);
    }, 400);
    try {
      var res = await fetch("/api/company-restore", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: raw,
      });
      var body = await res.json().catch(function () { return {}; });
      clearInterval(tick);
      if (!res.ok || body.ok === false) {
        finish(
          false,
          "Restore failed",
          body.error || body.message || ("Server returned " + res.status + "."),
        );
        return;
      }
      setBar(96);
      setStep("Imported into tables. Verifying…");
      var people = Number(body.people) || nPeople;
      var months = Number(body.monthRecords) || 0;
      var rewards = Number(body.rewardRecords) || 0;
      finish(
        true,
        "Restored",
        (body.message || ("Restored " + people + " people.")) +
          (months ? " " + months + " month records." : "") +
          (rewards ? " " + rewards + " reward records." : "") +
          " Reload to see it.",
        true,
      );
    } catch (err) {
      clearInterval(tick);
      finish(
        false,
        "Restore failed",
        err instanceof Error ? err.message : "The save did not reach the server. Stay signed in and try again.",
      );
    }
  }

  document.addEventListener(
    "change",
    function (ev) {
      var t = ev.target;
      if (!t || t.id !== "backup-restore-file") return;
      var file = t.files && t.files[0];
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      t.value = "";
      if (file) run(file);
    },
    true,
  );

  window.__apmsRestore = { open: open, progress: function (t, p) { setStep(t); setBar(p); }, ok: function (t) { finish(true, "Restored", t, true); }, fail: function (t) { finish(false, "Restore failed", t); }, run: run };
})();
