/**
 * Minimal Postgres wire-protocol client (trust auth only) for running
 * database-backed tests where the `pg` package is unavailable.
 * Supports parameterized queries via the extended protocol. Not for production.
 *
 *   const db = await connect({ host: "127.0.0.1", port: 5433, user: "postgres", database: "x" });
 *   const rows = await db.query("select $1::int as n", [1]);
 *   await db.end();
 */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- untyped test-only wire client (imported by src/lib/test-db.ts)
import net from "node:net";

const enc = new TextEncoder();
const dec = new TextDecoder();

function cstr(s) {
  return Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
}

function msg(type, body) {
  const len = Buffer.alloc(4);
  len.writeInt32BE(body.length + 4);
  return type ? Buffer.concat([Buffer.from(type), len, body]) : Buffer.concat([len, body]);
}

const OID = { bool: 16, int2: 21, int4: 23, int8: 20, float4: 700, float8: 701, numeric: 1700, json: 114, jsonb: 3802 };

function convert(text, oid) {
  if (text === null) return null;
  switch (oid) {
    case OID.bool:
      return text === "t";
    case OID.int2:
    case OID.int4:
    case OID.int8:
    case OID.float4:
    case OID.float8:
    case OID.numeric:
      return Number(text);
    case OID.json:
    case OID.jsonb:
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    default:
      return text;
  }
}

/** Same encoding as node-postgres: JS arrays become Postgres array literals. */
function pgArray(list) {
  return (
    "{" +
    list
      .map((x) => {
        if (x === null || x === undefined) return "NULL";
        if (Array.isArray(x)) return pgArray(x);
        const t = typeof x === "object" ? JSON.stringify(x) : String(x);
        return '"' + t.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
      })
      .join(",") +
    "}"
  );
}

export async function connect({ host = "127.0.0.1", port = 5432, user = "postgres", database = "postgres" } = {}) {
  const sock = net.createConnection({ host, port });
  await new Promise((res, rej) => {
    sock.once("connect", res);
    sock.once("error", rej);
  });
  let buf = Buffer.alloc(0);
  const inbox = [];
  let waiter = null;
  function deliver(m) {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(m);
    } else inbox.push(m);
  }
  sock.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 5) {
      const type = String.fromCharCode(buf[0]);
      const len = buf.readInt32BE(1);
      if (buf.length < len + 1) break;
      const body = Buffer.from(buf.subarray(5, len + 1));
      buf = buf.subarray(len + 1);
      deliver({ type, body });
    }
  });
  sock.on("error", (e) => deliver({ type: "X", body: Buffer.from(String(e.message)) }));
  sock.on("close", () => deliver({ type: "X", body: Buffer.from("closed") }));

  function nextMessage() {
    if (inbox.length) return Promise.resolve(inbox.shift());
    return new Promise((res) => {
      waiter = res;
    });
  }

  // Startup
  const params = Buffer.concat([cstr("user"), cstr(user), cstr("database"), cstr(database), cstr("client_encoding"), cstr("UTF8"), Buffer.from([0])]);
  const ver = Buffer.alloc(4);
  ver.writeInt32BE(196608);
  sock.write(msg(null, Buffer.concat([ver, params])));
  for (;;) {
    const { type, body } = await nextMessage();
    if (type === "R") {
      const code = body.readInt32BE(0);
      if (code !== 0) throw new Error("mini-pg: only trust auth supported (got code " + code + ")");
    } else if (type === "E") {
      throw new Error("mini-pg startup: " + parseError(body));
    } else if (type === "Z") break;
  }

  let chain = Promise.resolve();

  function parseError(body) {
    const parts = {};
    let i = 0;
    while (i < body.length && body[i] !== 0) {
      const f = String.fromCharCode(body[i]);
      const end = body.indexOf(0, i + 1);
      parts[f] = body.subarray(i + 1, end).toString("utf8");
      i = end + 1;
    }
    return (parts.S || "ERROR") + ": " + (parts.M || "") + (parts.D ? " — " + parts.D : "");
  }

  async function runQuery(text, values) {
    // Parse
    const paramTypes = Buffer.alloc(2);
    paramTypes.writeInt16BE(0);
    sock.write(msg("P", Buffer.concat([cstr(""), cstr(text), paramTypes])));
    // Bind
    const n = values.length;
    const parts = [cstr(""), cstr("")];
    const fmtCount = Buffer.alloc(2);
    fmtCount.writeInt16BE(0);
    parts.push(fmtCount);
    const pc = Buffer.alloc(2);
    pc.writeInt16BE(n);
    parts.push(pc);
    for (const v of values) {
      if (v === null || v === undefined) {
        const b = Buffer.alloc(4);
        b.writeInt32BE(-1);
        parts.push(b);
      } else {
        const s = Array.isArray(v) ? pgArray(v) : typeof v === "object" ? JSON.stringify(v) : String(v);
        const data = Buffer.from(s, "utf8");
        const b = Buffer.alloc(4);
        b.writeInt32BE(data.length);
        parts.push(b, data);
      }
    }
    const rfc = Buffer.alloc(2);
    rfc.writeInt16BE(0);
    parts.push(rfc);
    sock.write(msg("B", Buffer.concat(parts)));
    sock.write(msg("D", Buffer.concat([Buffer.from("P"), cstr("")])));
    const maxRows = Buffer.alloc(4);
    maxRows.writeInt32BE(0);
    sock.write(msg("E", Buffer.concat([cstr(""), maxRows])));
    sock.write(msg("S", Buffer.alloc(0)));

    let fields = [];
    const rows = [];
    let error = null;
    for (;;) {
      const { type, body } = await nextMessage();
      if (type === "T") {
        const count = body.readInt16BE(0);
        let off = 2;
        fields = [];
        for (let i = 0; i < count; i++) {
          const end = body.indexOf(0, off);
          const name = body.subarray(off, end).toString("utf8");
          off = end + 1;
          const oid = body.readInt32BE(off + 6);
          off += 18;
          fields.push({ name, oid });
        }
      } else if (type === "D") {
        const count = body.readInt16BE(0);
        let off = 2;
        const row = {};
        for (let i = 0; i < count; i++) {
          const len = body.readInt32BE(off);
          off += 4;
          let val = null;
          if (len >= 0) {
            val = body.subarray(off, off + len).toString("utf8");
            off += len;
          }
          row[fields[i].name] = convert(val, fields[i].oid);
        }
        rows.push(row);
      } else if (type === "E") {
        error = new Error(parseError(body));
      } else if (type === "X") {
        error = new Error("socket: " + body.toString());
        break;
      } else if (type === "Z") {
        break;
      }
    }
    if (error) throw error;
    return rows;
  }

  return {
    query(text, values = []) {
      const run = () => runQuery(text, values);
      const p = chain.then(run, run);
      chain = p.then(
        () => undefined,
        () => undefined,
      );
      return p;
    },
    async exec(text) {
      // Simple protocol for multi-statement scripts
      sock.write(msg("Q", cstr(text)));
      let error = null;
      for (;;) {
        const { type, body } = await nextMessage();
        if (type === "E") error = new Error(parseError(body));
        else if (type === "Z") break;
      }
      if (error) throw error;
    },
    end() {
      sock.write(msg("X", Buffer.alloc(0)));
      sock.end();
    },
  };
}

export function testDbConfig() {
  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5433),
    user: process.env.PGUSER || "postgres",
    database: process.env.PGDATABASE || "aliens_apms_test",
  };
}
