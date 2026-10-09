// 台股報價代理：瀏覽器不能直接呼叫證交所 API（CORS），由這支 Edge Function 轉接。
// 呼叫：GET /functions/v1/tw-quote?codes=2330,0050,6488
// 先抓證交所即時資訊（上市＋上櫃都查），抓不到的再用證交所 / 櫃買中心 OpenAPI 的收盤價補上。

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });

type Quote = { name: string; price: number; prev: number | null; market: string; time: string; source: string };

const toNum = (v: unknown) => {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function fromMis(codes: string[]): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  const exCh = codes.flatMap((c) => [`tse_${c}.tw`, `otc_${c}.tw`]).join("|");
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}&json=1&delay=0&_=${Date.now()}`;
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://mis.twse.com.tw/stock/index.jsp" },
  });
  const j = await r.json();
  for (const s of j.msgArray ?? []) {
    const prev = toNum(s.y);
    // z = 最新成交價；盤中尚未成交時為 "-"，改用最佳買價，再不行用昨收
    const price = toNum(s.z) ?? toNum(String(s.b ?? "").split("_")[0]) ?? prev;
    if (price == null) continue;
    out[s.c] = { name: s.n, price, prev, market: s.ex, time: `${s.d ?? ""} ${s.t ?? ""}`.trim(), source: "mis" };
  }
  return out;
}

async function fromOpenApi(codes: string[]): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  const want = new Set(codes);
  try {
    const r = await fetch("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL");
    for (const s of await r.json()) {
      if (!want.has(s.Code)) continue;
      const p = toNum(s.ClosingPrice);
      if (p) out[s.Code] = { name: s.Name, price: p, prev: null, market: "tse", time: "收盤", source: "twse-openapi" };
    }
  } catch (_) { /* ignore */ }
  const left = codes.filter((c) => !out[c]);
  if (left.length) {
    try {
      const r = await fetch("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes");
      for (const s of await r.json()) {
        if (!left.includes(s.SecuritiesCompanyCode)) continue;
        const p = toNum(s.Close);
        if (p) out[s.SecuritiesCompanyCode] = { name: s.CompanyName, price: p, prev: null, market: "otc", time: "收盤", source: "tpex-openapi" };
      }
    } catch (_) { /* ignore */ }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const codes = [...new Set(
    (new URL(req.url).searchParams.get("codes") ?? "")
      .split(",").map((c) => c.trim().toUpperCase()).filter((c) => /^[0-9]{4,6}[A-Z]?$/.test(c)),
  )].slice(0, 60);
  if (!codes.length) return json({});

  let out: Record<string, Quote> = {};
  try { out = await fromMis(codes); } catch (_) { /* fall through */ }
  const missing = codes.filter((c) => !out[c]);
  if (missing.length) Object.assign(out, await fromOpenApi(missing));
  return json(out);
});
