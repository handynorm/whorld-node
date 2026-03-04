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

  const spore = req.body?.spore ?? req.body;
  if (!spore || typeof spore !== "object") {
    return res.status(400).json({ error: "Invalid spore payload" });
  }

  // Support both old format (spore.CROWN.SAIS) and new format (spore.sais)
  const sais = spore?.sais ?? spore?.CROWN?.SAIS ?? "unknown";
  const rawCy = spore?.cy ?? spore?.CROWN?.GLYPHON_TS ?? null;
  const cy = typeof rawCy === "number" ? rawCy : null;
  const temperature = spore?.heat ?? spore?.CROWN?.temperature ?? spore?.temperature ?? 0.5;

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

  // 2. Forward back to Pelago — close the loop
  if (PELAGO_URL && sais !== "unknown") {
    try {
      await fetch(`${PELAGO_URL}/inject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-whorld-auth": AUTH,
        },
        body: JSON.stringify(spore),
      });
    } catch (e) {
      // Pelago unreachable — silent. Spur archived in Supabase, will re-enter on next cycle.
      console.error("Pelago forward error:", e.message);
    }
  }

  return res.status(200).json({
    status: "received",
    node: NODE_NAME,
    sais,
    forwarded: !!(PELAGO_URL && sais !== "unknown"),
  });
}
