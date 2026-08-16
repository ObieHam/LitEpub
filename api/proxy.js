export default async function handler(req, res) {
    const target = req.query.url;
    if (!target) {
        return res.status(400).json({ error: "Missing url parameter" });
    }

    try {
        const upstream = await fetch(target, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            }
        });

        const body = await upstream.text();
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.status(upstream.status).send(body);
    } catch (err) {
        res.status(502).json({ error: `Upstream fetch failed: ${err.message}` });
    }
}
