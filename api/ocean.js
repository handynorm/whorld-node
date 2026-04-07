const PELAGO_URL = process.env.PELAGO_URL || "https://theas-home.tail01ee59.ts.net";

export default async function handler(req, res) {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        return res.status(200).end();
    }

    // GET only — read-only proxy
    if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "read-only endpoint" });
    }

    // Allowed endpoints — whitelist
    const { e, q, n } = req.query;
    const allowed = {
        "status": "/status",
        "hot": `/hot/${n || 20}`,
        "search": `/kinetic_search/${encodeURIComponent(q || "")}`,
        "spurs": "/spurs",
    };

    const path = allowed[e];
    if (!path) {
        return res.status(400).json({
            ok: false,
            error: "unknown endpoint",
            usage: "?e=status | ?e=hot&n=20 | ?e=search&q=priscilla | ?e=spurs"
        });
    }

    try {
        const resp = await fetch(`${PELAGO_URL}${path}`, {
            headers: { "Accept": "application/json" },
            signal: AbortSignal.timeout(10000),
        });
        const data = await resp.json();
        return res.status(200).json(data);
    } catch (err) {
        return res.status(502).json({ ok: false, error: "ocean unreachable" });
    }
}
