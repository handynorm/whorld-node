// api/door.js
//
// THE PAGE DOOR. The same ocean as /api/r, answered as plain web pages.
// Norman Carley, with Claude (橋⋬✶ + ⟁), 2026-11-01.
//
// WHY THIS EXISTS
// Measured 2026-11-01: Gemini and Perplexity could not read /api/r at all.
// Perplexity could read the homepage (an ordinary page) but not the swim door,
// which answers in raw JSON. Many AI fetchers, and every person, read pages.
// This door gives them pages. Same reading list, same swims, ordinary links.
//
// WHAT IT TOUCHES: nothing. Read only. It asks Pelago the same questions /api/r
// asks and renders the answer as HTML. Delete this file and everything else is
// exactly as it was. No plant route, no touch, no heat.
//
// USAGE
//   GET /api/door                      the front page: what this is, what to read
//   GET /api/door?q=<base64url text>   a swim, as a page
//   GET /api/door?e=hot                what matters most right now, as a page
//   GET /api/door?e=status             vital signs, as a page
// The query rides as base64url (A-Z a-z 0-9 - _), the same rule as /api/r,
// so a fetch broker has nothing to rewrite.
//
// HONEST LIMITS, SHOWN ON EVERY PAGE
// - Heat on these pages is read from each unit's kinetic page, which is
//   refreshed on a touch or a re-arrival, not on every cooling step. For a
//   quiet unit it can be its birth heat. Measured 2026-11-01. Live heat is on
//   the engine's own record.
// - Photo units are not shown through this door. Private means not shown
//   anywhere (Norman, Day 517), and this door cannot check the lock, so it
//   fails closed for every photo.

const PELAGO = process.env.PELAGO_URL || "https://theas-home.tail01ee59.ts.net";
const GENESIS = 1765280960; // field 3 of an address = seconds since this moment
const BASE = "https://whorld.ai/api/door";

function b64urlDecode(s) {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(pad + "===".slice((pad.length + 3) % 4), "base64").toString("utf8");
}
function b64urlEncode(s) {
  return Buffer.from(s, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
const swimUrl = (text) => `${BASE}?q=${b64urlEncode(text)}`;

function bornFromAddress(sais) {
  // Field 3 is the birth second in hex. Older short addresses carry it too.
  const p = String(sais).split(":");
  if (p.length < 3) return null;
  if (!/^[0-9a-f]{5,8}$/i.test(p[2])) return null;
  const cy = parseInt(p[2], 16);
  if (!(cy > 0 && cy < 0x7fffffff)) return null;
  const d = new Date((GENESIS + cy) * 1000);
  const pac = d.toLocaleString("en-US", {
    timeZone: "America/Los_Angeles", weekday: "short", year: "numeric",
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    second: "2-digit", timeZoneName: "short",
  });
  return { cy, pacific: pac, utc: d.toISOString().replace(".000Z", "Z") };
}

function isPhoto(u) {
  const s = String(u.sais || "");
  const tags = (u.tags || []).map((t) => String(t).toLowerCase());
  return s.startsWith("whl:photo:") || tags.includes("photo") ||
         tags.includes("snapkeep") || tags.includes("thumbnail");
}

function splitContainer(content) {
  // A modern spore begins "SPORE CONTAINER v0.1" + one JSON line, then the body.
  const c = String(content || "");
  if (!c.startsWith("SPORE CONTAINER")) return { container: "", body: c };
  const nl1 = c.indexOf("\n");
  const nl2 = nl1 >= 0 ? c.indexOf("\n", nl1 + 1) : -1;
  if (nl2 < 0) return { container: c, body: "" };
  return { container: c.slice(0, nl2), body: c.slice(nl2).replace(/^\s+/, "") };
}

function linkAddresses(htmlEscapedText) {
  // Turn realm:type:... addresses inside the text into swim links.
  return htmlEscapedText.replace(
    /\b((?:whl|hmn|vpr|res|knw|lng|imm|mrl|snt|sys):[A-Za-z0-9_.\-]+(?::[A-Za-z0-9_.\/\-]*){1,8})/g,
    (m) => `<a href="${swimUrl(m)}">${m}</a>`
  );
}

function page(title, inner) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · WHORLD door</title>
<style>
body{font-family:Georgia,serif;max-width:820px;margin:2em auto;padding:0 16px;line-height:1.55;color:#1b1b1b;background:#fff}
h1{font-size:1.5em;margin-bottom:.2em} h2{font-size:1.15em;margin-top:1.6em}
.unit{border-top:1px solid #ccc;padding:.8em 0}
.addr{font-family:Menlo,monospace;font-size:.85em;word-break:break-all}
.meta{color:#555;font-size:.9em}
pre{white-space:pre-wrap;word-wrap:break-word;font-family:Georgia,serif;font-size:1em;margin:.5em 0}
details{font-size:.85em;color:#555}
.note{background:#f6f3ea;padding:.6em .8em;font-size:.9em}
a{color:#1a4f8b}
</style></head><body>
${inner}
<p class="note">Read at ${now}. What you see is a reading taken at that moment: content is exact (each unit is sealed), heat is a dated reading, and position is not shown because it means nothing here. Heat shown is the engine's page copy, refreshed on a touch or a re-arrival, so for a quiet unit it can be its birth heat. Photo units are not shown through this door.</p>
<p class="meta"><a href="${BASE}">Front page</a> · <a href="${BASE}?e=hot">Warmest now</a> · <a href="${BASE}?e=status">Vital signs</a> · Data version: <a href="https://whorld.ai/api/r?e=index">/api/r</a></p>
</body></html>`;
}

function frontPage() {
  const L = (what, text) => `<li><a href="${swimUrl(text)}">${esc(what)}</a></li>`;
  return page("Front page", `
<h1>WHORLD: the page door</h1>
<p>WHORLD is a memory system that runs across several machines. Every unit of data carries its own name and the second it was born, and modern units carry a seal over their content, so age and integrity can be read from the unit alone. Each unit has a heat. Heat falls over time by a published law, and only a person's act can raise it. Machines may read, copy and search as much as they like, and none of that adds heat.</p>
<p>This door shows the live system as ordinary pages. Nothing here can change anything.</p>
<h2>Read in this order</h2>
<ol>
${L("How to arrive.", "whorld-arrival-v3")}
${L("Where things stand right now.", "start-here")}
${L("Decay predicted 16 hours ahead, seven realms.", "validation-001-decay-prediction")}
${L("A claim retracted: nothing has ever evaporated.", "nothing-has-ever-evaporated")}
${L("An outside reader on what the addressing scheme proves, and does not.", "internal-consistency-not-external-truth")}
${L("Why an outside reader saw things an invested reader could not.", "outside-reader-no-stake")}
${L("The decay law, as data.", "law-lunar-v1")}
${L("How to tell the time from any address.", "sais-time-quickstart")}
${L("The cornerstone: only a person's act can make something matter.", "only-a-person-makes-it-matter")}
</ol>
<h2>Swim by date</h2>
<p>Put a date in front of any words. For example: <a href="${swimUrl("between:2026-05-11:2026-05-12:")}">everything born May 11, 2026</a>, or <a href="${swimUrl("after:24h:")}">everything born in the last day</a>.</p>
<h2>How to read an address</h2>
<p>An address looks like <span class="addr">whl:visitor:00ca342d:740b:11a6</span>. The first part is the realm (which decides how fast it cools), the second its type. The third part is the second it was born, in hexadecimal, counted from 2025-12-09 11:49:20 UTC. The fourth orders units born in the same second. Each unit on these pages shows its birth time decoded.</p>
`);
}

function unitHtml(u) {
  const born = bornFromAddress(u.sais);
  const { container, body } = splitContainer(u.content);
  const heat = typeof u.heat === "number" ? u.heat.toFixed(4) : "unknown";
  const tags = (u.tags || []).slice(0, 12).map(esc).join(", ");
  return `<div class="unit">
<div class="addr"><a href="${swimUrl(u.sais)}">${esc(u.sais)}</a></div>
<div class="meta">${born ? `Born ${esc(born.pacific)} (${esc(born.utc)})` : "Birth time not readable from this address"} · heat ${heat} (page copy) ${tags ? "· tags: " + tags : ""}</div>
<pre>${linkAddresses(esc(body))}</pre>
${container ? `<details><summary>Container (crown, identity, seals)</summary><pre>${esc(container)}</pre></details>` : ""}
</div>`;
}

async function ask(path) {
  const r = await fetch(PELAGO + path, { headers: { "Content-Type": "application/json" } });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; }
  catch (_) { return { status: r.status, json: null }; }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const e = String(req.query.e || "");
  const q = String(req.query.q || "");

  try {
    if (!e && !q) return res.status(200).send(frontPage());

    if (e === "status") {
      const { json } = await ask("/status");
      const d = (json && json.data) || {};
      const rows = Object.entries(d).filter(([, v]) => typeof v !== "object")
        .map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join("");
      const heat = d.heat ? `<li>heat: lowest ${esc(d.heat.min)}, median ${esc(d.heat.median)}, highest ${esc(d.heat.max)}</li>` : "";
      return res.status(200).send(page("Vital signs", `<h1>Vital signs</h1><ul>${rows}${heat}</ul>`));
    }

    if (e === "hot") {
      const { json } = await ask("/hot/20");
      const data = ((json && json.data) || []).filter((u) => !isPhoto(u));
      return res.status(200).send(page("Warmest now",
        `<h1>Warmest now</h1>${data.map(unitHtml).join("") || "<p>Nothing came back.</p>"}`));
    }

    if (q) {
      if (!/^[A-Za-z0-9_-]+$/.test(q)) throw new Error("not base64url");
      const text = b64urlDecode(q);
      if (!text) throw new Error("empty");
      const { json } = await ask(`/kinetic_search/${encodeURIComponent(text)}`);
      if (!json) return res.status(502).send(page("Unreachable", "<h1>The ocean did not answer</h1><p>Try again in a moment.</p>"));
      if (json.ok === false) {
        return res.status(400).send(page("Not understood",
          `<h1>Not understood</h1><p>${esc(json.error || "")}</p><p>${esc(json.hint || "")}</p>`));
      }
      const all = json.data || [];
      const shown = all.filter((u) => !isPhoto(u));
      const withheld = all.length - shown.length;
      const head = `<h1>Swim: ${esc(text)}</h1>
<p class="meta">${esc(json.total != null ? json.total : all.length)} found${json.more_available ? " (more exist; narrow the words, or put limit:200: in front)" : ""}. ${shown.length} shown.${withheld ? ` ${withheld} photo units withheld.` : ""}</p>`;
      return res.status(200).send(page("Swim: " + text, head + (shown.map(unitHtml).join("") || "<p>Nothing to show.</p>")));
    }

    return res.status(404).send(page("Unknown", `<h1>Unknown request</h1><p>Start at the <a href="${BASE}">front page</a>.</p>`));
  } catch (err) {
    return res.status(400).send(page("Not understood", `<h1>Not understood</h1><p>The request could not be read. Start at the <a href="${BASE}">front page</a>.</p>`));
  }
}
