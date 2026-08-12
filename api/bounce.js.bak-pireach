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
    { type: "pi",    name: "alpha",          url: null },   // 0 — Pi, unreachable from Vercel
    { type: "pi",    name: "beta",           url: null },   // 1
    { type: "pi",    name: "gamma",          url: null },   // 2
    { type: "pi",    name: "delta",          url: null },   // 3
    { type: "pi",    name: "epsilon",        url: null },   // 4
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
  const MAX_HOPS = 13;

  let forwarded = false;

  if (sais !== "unknown") {
    // After MAX_HOPS or if no PELAGO_URL — return to Pelago
    if (moves >= MAX_HOPS || !PELAGO_URL) {
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
      let nextIdx = hashRoute(sais, cy || 0, moves, temperature);
      let routeReason = "hash";
      // ⚑ NEVER FORWARD TO YOURSELF. Step to the next slot instead. Without
      // this a self-hash recurses Vercel-to-Vercel until the function is
      // killed — and with moves never incrementing (fixed below) MAX_HOPS
      // could not rescue it.
      if (ALL_NODES[nextIdx].name === NODE_NAME) {
        nextIdx = (nextIdx + 1) % ALL_NODES.length;
        routeReason = "self-collision-stepped";
      }
      const nextNode = ALL_NODES[nextIdx];

      if (nextNode.type === "pi" || !nextNode.url) {
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

  return res.status(200).json({
    status: "received",
    node: NODE_NAME,
    sais,
    forwarded,
  });
}
