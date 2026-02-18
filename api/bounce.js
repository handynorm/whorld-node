import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const NODE_NAME = process.env.NODE_NAME || "unknown";

  const NEIGHBORS = (process.env.NEIGHBORS || "")
    .split(",")
    .map(u => u.trim())
    .filter(Boolean);

  const spore = req.body?.spore ?? req.body;
  if (!spore || typeof spore !== "object") {
    return res.status(400).json({ error: "Invalid spore payload" });
  }

  if (!spore.PELAGOS || typeof spore.PELAGOS !== "object") {
    spore.PELAGOS = { hops_remaining: 20 };
  }
  if (typeof spore.PELAGOS.hops_remaining !== "number") {
    spore.PELAGOS.hops_remaining = 20;
  }

  if (spore.PELAGOS.hops_remaining <= 0) {
    return res.status(200).json({ status: "expired", node: NODE_NAME });
  }

  const sais = spore?.CROWN?.SAIS ?? spore?.SAIS ?? "unknown";

  if (!Array.isArray(spore.bounce_log)) {
    spore.bounce_log = [];
  }
  const hop_index = spore.bounce_log.length;

  spore.bounce_log.push({
    node: NODE_NAME,
    ts: Date.now(),
    iso: new Date().toISOString(),
  });

  spore.PELAGOS.hops_remaining -= 1;

  const temperature = spore?.CROWN?.temperature ?? spore?.temperature ?? 0.5;
  const baseDelay = 200;
  const tempDelay = Math.floor(temperature * 2000);
  const jitter = Math.floor(Math.random() * 500);
  const totalDelay = baseDelay + tempDelay + jitter;

  const lastHop = spore.bounce_log.length >= 2
    ? spore.bounce_log[spore.bounce_log.length - 2]?.node
    : null;

  let candidates = NEIGHBORS.filter(url => {
    if (lastHop && url.toLowerCase().includes(lastHop.toLowerCase())) {
      return false;
    }
    return true;
  });

  if (candidates.length === 0) {
    candidates = NEIGHBORS;
  }

  const nextNode = candidates[Math.floor(Math.random() * candidates.length)];
  const nextHostname = nextNode ? new URL(nextNode).hostname : null;

  const rawCy = spore?.CROWN?.GLYPHON_TS ?? null;
  const cy = typeof rawCy === "number" ? rawCy : null;

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
        hop_index,
        cy,
        temperature,
        delay_ms: totalDelay,
        next_node: nextHostname,
        spore_hash: sais,
        note: "fibonacci",
      }]);
    }
  } catch (e) {
    // silent
  }

if (nextNode && spore.PELAGOS.hops_remaining > 0) {
    await fetch(nextNode, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spore),
    }).catch(() => {});
  }

  return res.status(200).json({
    status: "bounced",
    node: NODE_NAME,
    sais,
    hops_remaining: spore.PELAGOS.hops_remaining,
    delay_ms: totalDelay,
    next: nextHostname,
  });
}
