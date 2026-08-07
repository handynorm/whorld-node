import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const AUTH = process.env.WHORLD_BOUNCE_SECRET;
  if (req.headers["x-whorld-auth"] !== AUTH) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const NODE_NAME = process.env.NODE_NAME || "unknown";
  const PELAGO_URL = process.env.PELAGO_URL;

  // SpurWire: the spur IS the message. Flat fields at top level.
  const spore = req.body;
  if (!spore || typeof spore !== "object") {
    return res.status(400).json({ error: "Invalid spore payload" });
  }

  const sais = spore?.sais ?? "unknown";
  const rawCy = spore?.cy ?? null;
  const cy = typeof rawCy === "number" ? rawCy : null;
  const temperature = spore?.heat ?? 0.5;

  // 1. Archive to Supabase
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Log the hop
    const { data: existing } = await supabase
      .from("pelagos_fibonacci")
      .select("id")
      .eq("sais", sais)
      .eq("node", NODE_NAME)
      .limit(1);

    if (!existing || existing.length === 0) {
      await supabase.from("pelagos_fibonacci").insert([{
        sais,
        node: NODE_NAME,
        hop_index: 0,
        cy,
        temperature,
        delay_ms: 0,
        next_node: null,
        spore_hash: sais,
        note: "trampoline",
      }]);
    }

    // Archive full spur payload
    if (sais !== "unknown") {
      await supabase.from("pelagos_archive").upsert([{
        sais,
        content: spore.content || null,
        tags: spore.tags || [],
        heat: spore.heat || temperature,
        glyphs: spore.glyphs || [],
        canon: spore.canon || false,
        cy_born: cy,
        source_node: NODE_NAME,
        behavior_ir: spore.behavior_ir || null,
      }], { onConflict: "sais", ignoreDuplicates: true });
    }

  } catch (e) {
    // Supabase failure is non-fatal — spur still bounces
    console.error("Supabase error:", e.message);
  }

  // 2. Thermodynamic hash router — same logic as oasis
  // SAIS + CY + heat_bucket + moves → next node index
  // ⚑ Day 515 — each entry now carries its NODE_NAME, so "is this me?" is an
  // equality check rather than a substring guess. It has to be exact:
  // NODE_NAME "theacoute-com" lives at theacoutez-com-node (note the z), so
  // url.includes(NODE_NAME) would have returned false and the self-collision
  // guard below would never have fired for that site.
  const ALL_NODES = [
    // ⚑ Day 515 — ALPHA IS REACHABLE NOW. The comment below was true when it
    // was written and Tailscale Funnel made it false; nobody updated the
    // table. Every Pi slot being null is why a spore on the wire could only
    // ever come home to Pelago — there was nowhere else for it to land, and
    // that is why nine system-state spores emitted tonight confirmed nowhere.
    // Verified from a sandbox with NO ROUTE INTO THE TAILNET: /inject
    // returned 200 and the spur was stored kinetically.
    // NOTE: `tailscale serve` publishes to the TAILNET; `tailscale funnel`
    // publishes to the INTERNET. Using serve silently took the funnel down
    // and /search went dark for two minutes. Check from outside, always.
    { type: "pi", name: "alpha", url: "https://gyre-alpha.tail01ee59.ts.net/inject" },  // 0
    { type: "pi", name: "beta", url: "https://gyre-beta.tail01ee59.ts.net/inject" },   // 1
    { type: "pi", name: "gamma", url: "https://gyre-gamma.tail01ee59.ts.net/inject" },   // 2
    { type: "pi", name: "delta", url: "https://gyre-delta.tail01ee59.ts.net/inject" },   // 3
    { type: "pi", name: "epsilon", url: "https://gyre-epsilon.tail01ee59.ts.net/inject" },   // 4
    { type: "pi",    name: "quincy",         url: null },   // 5
    { type: "pi",    name: "falcon",         url: null },   // 6
    { type: "tramp", name: "echothea",       url: "https://www.echothea.com/api/bounce" },               // 7
    { type: "tramp", name: "silicasapiens",  url: "https://www.silicasapiens.com/api/bounce" },          // 8
    { type: "tramp", name: "pelagos",        url: "https://pelagos-node.vercel.app/api/bounce" },        // 9
    { type: "tramp", name: "whorld",         url: "https://whorld-node.vercel.app/api/bounce" },         // 10
    { type: "tramp", name: "theacoute-ai",   url: "https://theacoute-ai-node.vercel.app/api/bounce" },   // 11
    { type: "tramp", name: "theacoute-com",  url: "https://theacoutez-com-node.vercel.app/api/bounce" }, // 12
  ];

  // ⚑ Day 515 — THE COMMENT SAID FOUR INPUTS. THE FUNCTION TOOK TWO.
  // It has read "SAIS + CY + heat_bucket + moves" since this was written,
  // and hashed only sais and cy. Neither changes over a spur's life, so
  // THE ROUTE WAS FIXED FOREVER: a spur sent to slot 7 went to slot 7 on
  // every hop, for all time. And 1 in 13 spurs hashed to the node it was
  // already standing on — echothea forwarded to echothea, received itself,
  // forwarded to itself. Both log tables dedup on sais, so the recursion
  // was INVISIBLE. That is what looked like a DDoS in February 2026 and
  // sent us to buy Raspberry Pis. It was never a rate problem.
  // Verified Day 515 with a spur that had never existed:
  //   hashRoute("vpr:curiosity:WIRETEST-81201FAA", 20782000) -> 7 -> echothea,
  //   sent FROM echothea. One log row. Never reached the ocean.
  // With moves in the string every hop routes somewhere new, which is what
  // the comment always said it did.
  function hashRoute(sais, cy, moves, heat) {
    const bucket = Math.floor(Math.max(0, Math.min(1, heat || 0)) * 10);
    const str = `${sais}:${cy}:${bucket}:${moves}`;
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h) + str.charCodeAt(i);
      h = h & 0xffffffff;
    }
    return Math.abs(h) % 13;
  }

  const moves = typeof spore.moves === "number" ? spore.moves : 0;

  // ⚑ Day 516 — MAX_HOPS WAS CHECKING THE WRONG COUNTER, AND THE WIRE WAS
  // CLOSED TO THE ENTIRE EXISTING CORPUS BECAUSE OF IT.
  // It tested `moves`, the DRAM RELOCATION ODOMETER — median spore 506,669,
  // max 8,050,754. So EVERY spore older than a few seconds tripped MAX_HOPS on
  // arrival and was turned straight back to Pelago. Only fresh probes ever
  // routed anywhere. Visible in wire_transit: route_reason "max-hops" on a
  // res:resident spore whose hop_index was 0 — its FIRST crossing.
  // ⚑ THE LIMIT WAS NOT TOO STRICT. IT READ A NUMBER UNRELATED TO HOPS.
  // Ceiling is 3, not 13, DELIBERATELY: this is the first time the existing
  // 28,000 spores can travel, the rate is unmeasured, and Vercel concurrency
  // is unknown. Watch the table for a day, then raise it.
  const MAX_HOPS = 3;

  let priorHops = 0;
  try {
    if (sais !== "unknown" && process.env.SUPABASE_URL) {
      const { createClient: _cc0 } = await import("@supabase/supabase-js");
      const _sb0 = _cc0(process.env.SUPABASE_URL,
                        process.env.SUPABASE_SERVICE_ROLE_KEY);
      const { count: _p } = await _sb0.from("wire_transit")
        .select("id", { count: "exact", head: true }).eq("sais", sais);
      priorHops = _p || 0;
    }
  } catch (e) {
    // ⚑ FAIL TOWARD HOME. No count means we cannot know how far this has
    // travelled, so send it to Pelago rather than risk a loop.
    priorHops = MAX_HOPS;
    console.error("hop count unavailable:", e.message);
  }

  let forwarded = false;
  // ⚑ Day 516 — HOISTED SO THE TRANSIT LOG CAN SEE THEM. These were declared
  // inside the routing branch, so by the time wire_transit was written at the
  // return they were out of scope and EVERY ROW SAID route_to:null,
  // route_reason:"no-route". The log recorded THAT a spore crossed and not
  // WHERE IT WENT — which is most of the value missing.
  let nextIdx = null;
  let nextNode = null;
  let routeReason = "none";

  if (sais !== "unknown") {
    // After MAX_HOPS or if no PELAGO_URL — return to Pelago
    if (priorHops >= MAX_HOPS || !PELAGO_URL) {
      routeReason = (priorHops >= MAX_HOPS) ? `max-hops(${priorHops})` : "no-pelago-url";
      try {
        const resp = await fetch(`${PELAGO_URL}/inject`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-whorld-auth": AUTH },
          body: JSON.stringify(spore),
        });
        forwarded = resp.ok;
        if (!resp.ok) console.error("Pelago return failed:", resp.status);
        else console.log(`[${NODE_NAME}] circuit complete: ${sais} (moves=${moves}) → Pelago`);
      } catch (e) {
        console.error("Pelago return error:", e.message);
      }
    } else {
      // Hash route to next node
      nextIdx = hashRoute(sais, cy || 0, moves, temperature);
      routeReason = "hash";
      // ⚑ NEVER FORWARD TO YOURSELF. Step to the next slot instead. Without
      // this a self-hash recurses Vercel-to-Vercel until the function is
      // killed — and with moves never incrementing (fixed below) MAX_HOPS
      // could not rescue it.
      if (ALL_NODES[nextIdx].name === NODE_NAME) {
        nextIdx = (nextIdx + 1) % ALL_NODES.length;
        routeReason = "self-collision-stepped";
      }
      nextNode = ALL_NODES[nextIdx];

      // ⚑ Day 515 — THE URL DECIDES, NOT THE LABEL. This read
      // `type === "pi" || not url` and SHORT-CIRCUITED ON THE TYPE, so giving
      // alpha a real Funnel URL changed nothing — it still went to Pelago.
      // A node is unreachable if it HAS NO URL. That is the only test.
      if (!nextNode.url) {
        // Pi nodes not reachable from Vercel — return to Pelago as gateway
        try {
          const resp = await fetch(`${PELAGO_URL}/inject`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-whorld-auth": AUTH },
            body: JSON.stringify(spore),
          });
          forwarded = resp.ok;
          if (!resp.ok) console.error("Pelago gateway failed:", resp.status);
          else console.log(`[${NODE_NAME}] hash→Pi[${nextIdx}] via Pelago: ${sais}`);
        } catch (e) {
          console.error("Pelago gateway error:", e.message);
        }
      } else {
        // Trampoline — forward directly
        try {
          // ⚑ Day 515 — INCREMENT moves. The spur was forwarded UNCHANGED, so
          // its counter never moved and MAX_HOPS (13) was dead code that could
          // never fire. A looping spur had no escape hatch at all.
          const onward = { ...spore, moves: moves + 1 };
          const resp = await fetch(nextNode.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-whorld-auth": AUTH,
              "x-whorld-from": NODE_NAME,
            },
            body: JSON.stringify(onward),
          });
          forwarded = resp.ok;
          if (!resp.ok) console.error(`Forward to ${nextNode.url} failed:`, resp.status);
          else console.log(`[${NODE_NAME}] hash→Tramp[${nextIdx}]: ${sais} (moves=${moves})`);
        } catch (e) {
          console.error(`Forward error to ${nextNode.url}:`, e.message);
        }
      }
    }
  }

  // ⚑ Day 516 — WIRE_TRANSIT. One row per hop, NO DEDUP, written AFTER the
  // fetch resolves so it records WHAT HAPPENED rather than what was intended.
  //
  // ⚑ WHY THE OTHER TWO TABLES CANNOT DO THIS.
  //   pelagos_fibonacci  dedups on (sais, node) AND hardcodes hop_index:0 and
  //                      next_node:null. It logs arrivals and pretends nothing
  //                      ever left. That is why the echothea->echothea
  //                      recursion was invisible for SIX MONTHS.
  //   pelagos_archive    upserts with ignoreDuplicates:true, so it keeps only
  //                      the FIRST passage. It is a BODY STORE — proof that a
  //                      spore existed and what it said. Not a history.
  // So the archive gives PROOF OF EXISTENCE and this gives PROOF OF LIFE:
  // a spore seen crossing eleven minutes ago is still moving; one whose last
  // row is from March has stopped arriving anywhere.
  //
  // ⚑ AND NOTHING ON THE WIRE CAN BE QUERIED FOR PRESENCE. A trampoline holds
  // NOTHING — it receives, archives, forwards, and the function ends. GET
  // returns 405. There is no "on the wire" location to ask about, only
  // passage. So passage is what gets recorded.
  try {
    if (sais !== "unknown" && process.env.SUPABASE_URL) {
      const { createClient: _cc } = await import("@supabase/supabase-js");
      const _sb = _cc(process.env.SUPABASE_URL,
                      process.env.SUPABASE_SERVICE_ROLE_KEY);
      await _sb.from("wire_transit").insert([{
        sais,
        node: NODE_NAME,
        came_from: req.headers["x-whorld-from"] || null,
        route_to: nextNode ? nextNode.name : "pelago",
        route_reason: (nextIdx === null) ? routeReason
                    : `${routeReason}->${nextIdx}:${nextNode ? nextNode.name : "?"}`,
        forwarded,
        http_status: forwarded ? 200 : null,
        // ⚑ Day 516 — hop_index IS THE ROW COUNT FOR THIS SAIS, not `moves`.
        // The first draft wrote moves here and that was FALSE: `moves` is the
        // DRAM RELOCATION ODOMETER. Measured the same day — the median spore
        // has 506,669 moves and the maximum is 8,050,754. Nothing has crossed
        // a trampoline eight million times. Writing that into a column called
        // hop_index claims something untrue.
        // ⚑ AND IT MEANS MAX_HOPS=13 CAN NEVER FIRE. It checks `moves`, which
        // is already half a million on any real spore. Dead code again, for a
        // different reason than Day 515. The wire needs its own counter.
        hop_index: priorHops,
        moves,
        // ⚑ the column is `temperature`, not `heat`. Checked against
        // information_schema before shipping — the first draft said heat and
        // would have failed silently inside the try/catch.
        temperature,
        cy,
      }]);
    }
  } catch (e) {
    // never block a bounce on a log write
    console.error("wire_transit error:", e.message);
  }

  return res.status(200).json({
    status: "received",
    node: NODE_NAME,
    sais,
    forwarded,
  });
}
