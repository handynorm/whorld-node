import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const NODE_NAME = process.env.NODE_NAME || "unknown";

  const spore = req.body?.spore ?? req.body;
  if (!spore || typeof spore !== "object") {
    return res.status(400).json({ error: "Invalid spore payload" });
  }

  const sais = spore?.CROWN?.SAIS ?? spore?.SAIS ?? "unknown";
  const rawCy = spore?.CROWN?.GLYPHON_TS ?? null;
  const cy = typeof rawCy === "number" ? rawCy : null;
  const temperature = spore?.CROWN?.temperature ?? spore?.temperature ?? 0.5;

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

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

    if (spore.payload) {
      const p = spore.payload;
      await supabase.from("pelagos_archive").upsert([{
        sais: sais,
        content: p.content || null,
        tags: p.tags || [],
        heat: p.heat || 0,
        glyphs: p.glyphs || [],
        canon: p.canon || false,
        soml_profile: p.soml_profile || null,
        identity_stamp: p.identity_stamp || null,
        source_echo: p.source_echo || null,
        cy_born: typeof p.cy === 'number' ? p.cy : null,
        source_node: NODE_NAME
      }], { onConflict: 'sais', ignoreDuplicates: true });
    }
  } catch (e) {
    // silent
  }

  return res.status(200).json({
    status: "received",
    node: NODE_NAME,
    sais,
  });
}
