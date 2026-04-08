const PELAGO_URL = process.env.PELAGO_URL || "https://theas-home.tail01ee59.ts.net";
const WHORLD_SECRET = process.env.WHORLD_BOUNCE_SECRET || "";

// Rate limit: 10 plants per minute per IP
const plantCounts = new Map();
let plantWindow = Date.now();

function checkPlantRate(ip) {
    const now = Date.now();
    if (now - plantWindow > 60000) {
        plantCounts.clear();
        plantWindow = now;
    }
    const count = plantCounts.get(ip) || 0;
    if (count >= 10) return false;
    plantCounts.set(ip, count + 1);
    return true;
}

export default async function handler(req, res) {
    const OCEAN_OPEN = process.env.OCEAN_OPEN !== "false";
    if (!OCEAN_OPEN) {
        return res.status(503).json({ ok: false, error: "ocean offline" });
    }

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        return res.status(200).end();
    }

    const { e, q, n } = req.query;

    // POST: e=plant — visitor spore injection
    if (e === "plant" && req.method === "POST") {
        const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
        if (!checkPlantRate(ip)) {
            return res.status(429).json({ ok: false, error: "rate limit — try again in a minute" });
        }

        const { name, message } = req.body || {};
        if (!message || typeof message !== "string" || message.trim().length === 0) {
            return res.status(400).json({ ok: false, error: "message is required (1-500 characters)" });
        }
        if (message.length > 500) {
            return res.status(400).json({ ok: false, error: "message too long (500 character max)" });
        }
        const cleanName = (name && typeof name === "string") ? name.slice(0, 50).trim() : "";
        const visitorName = cleanName || "anonymous";

        const spur = {
            sais: "",
            content: `VISITOR | ${visitorName} | ${message.trim()}`,
            tags: ["visitor", "whorld.ai"],
            heat: 0.30,
            canon: false,
        };

        try {
            const headers = { "Content-Type": "application/json" };
            if (WHORLD_SECRET) {
                headers["x-whorld-auth"] = WHORLD_SECRET;
            }
            const resp = await fetch(`${PELAGO_URL}/inject`, {
                method: "POST",
                headers,
                body: JSON.stringify(spur),
                signal: AbortSignal.timeout(10000),
            });
            const data = await resp.json();
            if (data.ok) {
                return res.status(200).json({ ok: true, message: "Your spore is now circulating" });
            }
            return res.status(502).json({ ok: false, error: "ocean rejected the spore" });
        } catch (err) {
            return res.status(502).json({ ok: false, error: "ocean unreachable" });
        }
    }

    // GET only for all other endpoints
    if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "read-only endpoint" });
    }

    // Allowed GET endpoints — whitelist
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
            usage: "?e=status | ?e=hot&n=20 | ?e=search&q=priscilla | ?e=spurs | POST ?e=plant"
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
