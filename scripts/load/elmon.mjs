/**
 * PERF: preloaded into the server under test (`node --import ./scripts/load/elmon.mjs …`).
 * Not part of the product. Every second appends one JSON line to $ELMON_FILE:
 * event-loop delay (p50/p99/max ms over that second), process CPU (% of one
 * core, user+system), RSS and heap.
 */
import { monitorEventLoopDelay } from "node:perf_hooks";
import { appendFileSync } from "node:fs";

const file = process.env.ELMON_FILE;
if (file) {
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();
  let lastCpu = process.cpuUsage();
  let lastT = performance.now();
  const t = setInterval(() => {
    const now = performance.now();
    const cpu = process.cpuUsage();
    const used = (cpu.user - lastCpu.user + cpu.system - lastCpu.system) / 1000;
    const pct = (100 * used) / (now - lastT);
    lastCpu = cpu;
    lastT = now;
    const m = process.memoryUsage();
    try {
      appendFileSync(
        file,
        JSON.stringify({
          t: Date.now(),
          lagP50: +(h.percentile(50) / 1e6).toFixed(1),
          lagP99: +(h.percentile(99) / 1e6).toFixed(1),
          lagMax: +(h.max / 1e6).toFixed(1),
          cpu: +pct.toFixed(1),
          rss: Math.round(m.rss / 1e6),
          heap: Math.round(m.heapUsed / 1e6),
        }) + "\n",
      );
    } catch {
      /* ignore */
    }
    h.reset();
  }, 1000);
  t.unref();
}
