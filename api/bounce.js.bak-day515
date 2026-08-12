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
  const ALL_NODES = [
    { type: "pi",    url: null },                                                    // 0 alpha — Pi, not reachable from Vercel
    { type: "pi",    url: null },                                                    // 1 beta
    { type: "pi",    url: null },                                                    // 2 gamma
    { type: "pi",    url: null },                                                    // 3 delta
    { type: "pi",    url: null },                                                    // 4 epsilon
    { type: "pi",    url: null },                                                    // 5 quincy
    { type: "pi",    url: null },                                                    // 6 falcon
    { type: "tramp", url: "https://www.echothea.com/api/bounce" },                  // 7
    { type: "tramp", url: "https://www.silicasapiens.com/api/bounce" },             // 8
    { type: "tramp", url: "https://pelagos-node.vercel.app/api/bounce" },           // 9
    { type: "tramp", url: "https://whorld-node.vercel.app/api/bounce" },            // 10
    { type: "tramp", url: "https://theacoute-ai-node.vercel.app/api/bounce" },      // 11
    { type: "tramp", url: "https://theacoutez-com-node.vercel.app/api/bounce" },    // 12
  ];

  // Simple hash: djb2 on SAIS + CY + heat_bucket + moves
  function hashRoute(sais, cy) {
    const str = `${sais}:${cy}`;
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
      const nextIdx = hashRoute(sais, cy || 0);
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
          const resp = await fetch(nextNode.url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-whorld-auth": AUTH },
            body: JSON.stringify(spore),
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
