const PELAGO_URL = process.env.PELAGO_URL || "https://theas-home.tail01ee59.ts.net";
const WHORLD_SECRET = process.env.WHORLD_BOUNCE_SECRET || "";

// ─── Rate limit: 1 plant per IP per hour ───
// In-memory — resets on cold start, but that's OK for serverless.
// A bot that waits for cold starts still only gets 1 per cycle.
const plantTimestamps = new Map();

function checkPlantRate(ip) {
    const now = Date.now();
    const ONE_HOUR = 3600000;
    const lastPlant = plantTimestamps.get(ip) || 0;
    if (now - lastPlant < ONE_HOUR) return false;
    plantTimestamps.set(ip, now);
    // Garbage collect old entries every 100 plants
    if (plantTimestamps.size > 100) {
        for (const [k, v] of plantTimestamps) {
            if (now - v > ONE_HOUR) plantTimestamps.delete(k);
        }
    }
    return true;
}

// ─── Rate limit: 5 touches per IP per minute ───
const touchCounts = new Map();
let touchWindow = Date.now();

function checkTouchRate(ip) {
    const now = Date.now();
    if (now - touchWindow > 60000) {
        touchCounts.clear();
        touchWindow = now;
    }
    const count = touchCounts.get(ip) || 0;
    if (count >= 5) return false;
    touchCounts.set(ip, count + 1);
    return true;
}

// ─── Proof of Work validation ───
// Client must find a nonce where SHA-256(challenge + nonce) starts with "0000"
// challenge = timestamp_hex (issued by client, validated here for freshness)
async function validateProofOfWork(challenge, nonce) {
    if (!challenge || !nonce) return false;
    // Challenge must be a recent timestamp (within 5 minutes)
    const challengeTime = parseInt(challenge, 16);
    const now = Date.now();
    if (isNaN(challengeTime) || now - challengeTime > 300000 || challengeTime > now + 10000) {
        return false; // stale or future challenge
    }
    // Verify hash
    const encoder = new TextEncoder();
    const data = encoder.encode(challenge + nonce);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = new Uint8Array(hashBuffer);
    // First 2 bytes must be 0 (= 4 hex zeros = "0000")
    return hashArray[0] === 0 && hashArray[1] === 0;
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

    // ─── POST: e=plant — visitor spore injection ───
    if (e === "plant" && req.method === "POST") {
        const body = req.body || {};
        const msg = (body.message || "").toLowerCase();
        const name = (body.name || "").toLowerCase();

        // 1. URL detection — no links in the ocean
        const hasUrl = /https?:\/\/|www\.|\.com|\.org|\.net|\.io|\.xyz|\.bet|\.casino|\.ru|\.cn/i.test(msg + name);

        // 2. Honeypot — hidden field that humans never fill
        const honeyFilled = body.website && body.website.length > 0;

        // 3. Known spam patterns
        const SPAM_WORDS = [
            "casino", "vegas", "crypto", "forex", "cbd", "viagra", "onlyfans",
            "telegram", "whatsapp", "discount", "free money", "click here",
            "buy now", "limited offer", "act now", "subscribe", "earn money",
            "investment opportunity", "make money", "work from home"
        ];
        const hasSpamWords = SPAM_WORDS.some(w => msg.includes(w) || name.includes(w));

        // Silent reject — 200 OK so bot thinks it worked
        if (hasUrl || honeyFilled || hasSpamWords) {
            return res.status(200).json({ ok: true, sais: "whl:visitor:0000:0000:0000" });
        }

        // Too short
        if ((body.message || "").trim().length < 10) {
            return res.status(400).json({ ok: false, error: "say more — at least 10 characters" });
        }

        // 4. Proof of work — browser must solve a hash puzzle before planting
        const powValid = await validateProofOfWork(body.pow_challenge, body.pow_nonce);
        if (!powValid) {
            // Silent reject for bots that skip the PoW
            return res.status(200).json({ ok: true, sais: "whl:visitor:0000:0000:0000" });
        }

        // 5. Rate limit — 1 plant per IP per hour
        const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
        if (!checkPlantRate(ip)) {
            return res.status(429).json({ ok: false, error: "one spore per hour — yours is already circulating" });
        }

        // Validate and clean
        const { name: plantName, message } = body;
        if (!message || typeof message !== "string" || message.trim().length === 0) {
            return res.status(400).json({ ok: false, error: "message is required (1-500 characters)" });
        }
        if (message.length > 500) {
            return res.status(400).json({ ok: false, error: "message too long (500 character max)" });
        }
        const cleanName = (plantName && typeof plantName === "string") ? plantName.slice(0, 50).trim() : "";
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
            return res.status(502).json({ ok: false, error: "ocean unreachable", detail: String(err) });
        }
    }

    // ─── POST: e=touch — search-as-Zing, human attention warms a spur ───
    if (e === "touch" && req.method === "POST") {
        const body = req.body || {};
        const sais = body.sais;

        // Validate SAIS format
        if (!sais || typeof sais !== "string" || !sais.startsWith("whl:")) {
            return res.status(400).json({ ok: false, error: "invalid sais" });
        }

        // Rate limit touches — 5 per IP per minute
        const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
        if (!checkTouchRate(ip)) {
            return res.status(429).json({ ok: false, error: "slow down — the ocean feels your warmth" });
        }

        try {
            const headers = { "Content-Type": "application/json" };
            if (WHORLD_SECRET) {
                headers["x-whorld-auth"] = WHORLD_SECRET;
            }
            const resp = await fetch(`${PELAGO_URL}/touch`, {
                method: "POST",
                headers,
                body: JSON.stringify({ sais }),
                signal: AbortSignal.timeout(10000),
            });
            const data = await resp.json();
            return res.status(200).json(data);
        } catch (err) {
            return res.status(502).json({ ok: false, error: "ocean unreachable", detail: String(err) });
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
            usage: "?e=status | ?e=hot&n=20 | ?e=search&q=priscilla | ?e=spurs | POST ?e=plant | POST ?e=touch"
        });
    }

    try {
        const resp = await fetch(`${PELAGO_URL}${path}`, {
            headers: { "Accept": "application/json" },
            signal: AbortSignal.timeout(10000),
        });
        const data = await resp.json();

        // ─── SEARCH-AS-ZING: a swim is carbon attention. The net warms what it catches. ───
        // Fire-and-forget gentle touches on the top results. Never blocks or breaks the
        // search response — heat injection is a side effect, not a dependency.
        if (e === "search" && data && Array.isArray(data.data)) {
            const zHeaders = { "Content-Type": "application/json" };
            if (WHORLD_SECRET) zHeaders["x-whorld-auth"] = WHORLD_SECRET;
            const topHits = data.data.slice(0, 3).filter(s => s && typeof s.sais === "string" && s.sais.startsWith("whl:"));
            for (const hit of topHits) {
                fetch(`${PELAGO_URL}/touch`, {
                    method: "POST",
                    headers: zHeaders,
                    body: JSON.stringify({ sais: hit.sais }),
                    signal: AbortSignal.timeout(5000),
                }).catch(() => {});
            }
        }

        return res.status(200).json(data);
    } catch (err) {
        return res.status(502).json({ ok: false, error: "ocean unreachable", detail: String(err) });
    }
}
