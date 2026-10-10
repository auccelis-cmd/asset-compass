'use strict';
/* 資產羅盤 Asset Compass
 * 銀行帳戶 · 信用卡（結算日即扣款日，自動從扣款帳戶扣除）· 台股 · 加密貨幣（手動持倉＋鏈上錢包）
 */

const APP_VERSION = '2026.10.10t';
const CFG = window.ASSET_CONFIG || {};
const CLOUD = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
let sb = null, user = null;

const TABLES = ['accounts', 'balance_log', 'cards', 'transactions', 'settlements', 'stocks', 'crypto_holdings', 'wallets', 'snapshots', 'receivables', 'liabilities'];
const OPTIONAL_TABLES = ['receivables', 'liabilities']; // 後來新增的表：還沒建立時不讓整個 App 壞掉
const S = {
  accounts: [], balance_log: [], cards: [], transactions: [], settlements: [],
  stocks: [], crypto_holdings: [], wallets: [], snapshots: [], receivables: [], liabilities: [], missingTables: [],
  quotes: {}, prices: {}, fx: { TWD: 1 }, walletBal: {},
  tab: ({ stocks: 'invest', crypto: 'invest' })[localStorage.getItem('ac_tab')] || localStorage.getItem('ac_tab') || 'overview',
  invSub: localStorage.getItem('ac_inv') || 'stocks', cardSel: 0,
  hide: localStorage.getItem('ac_hide') === '1',
};

/* ---------------- utils ---------------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const todayDate = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const todayStr = () => ymd(new Date());
const md = s => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);
const CUR_SYM = { TWD: 'NT$', USD: 'US$', JPY: '¥', EUR: '€', CNY: 'CN¥', HKD: 'HK$', KRW: '₩', GBP: '£', AUD: 'A$' };

function money(v, cur = 'TWD', dp) {
  if (S.hide) return '••••';
  if (!Number.isFinite(v)) return '—';
  const d = dp ?? (cur === 'JPY' || cur === 'TWD' || cur === 'KRW' ? 0 : 2);
  return (v < 0 ? '-' : '') + (CUR_SYM[cur] || cur + ' ') + Math.abs(v).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
}
const qtyFmt = v => S.hide ? '••' : Number(v).toLocaleString('zh-TW', { maximumFractionDigits: 8 });
const pctFmt = v => Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : '—';
const toTWD = (amt, cur) => (!cur || cur === 'TWD') ? amt : (S.fx[cur] ? amt / S.fx[cur] : NaN);
const fromTWD = (amt, cur) => (!cur || cur === 'TWD') ? amt : (S.fx[cur] ? amt * S.fx[cur] : NaN);

function cacheGet(k, maxAge) {
  try { const o = JSON.parse(localStorage.getItem('ac_c_' + k)); if (o && Date.now() - o.t < maxAge) return o.v; } catch (_) { }
  return null;
}
function cacheSet(k, v) { try { localStorage.setItem('ac_c_' + k, JSON.stringify({ t: Date.now(), v })); } catch (_) { } }

let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, ms);
}

/* ---------------- data layer ---------------- */
const LKEY = 'asset_compass_local_v1';
const local = {
  load() { try { return JSON.parse(localStorage.getItem(LKEY)) || {}; } catch (_) { return {}; } },
  save(o) { localStorage.setItem(LKEY, JSON.stringify(o)); },
};
/* 資料庫還沒加新欄位時，自動拿掉那個欄位重試，避免整筆存不進去 */
async function withColumnFallback(obj, run) {
  let o = { ...obj };
  for (let i = 0; i < 4; i++) {
    const { data, error } = await run(o);
    if (!error) return data;
    const m = /Could not find the '([^']+)' column/.exec(error.message || '') || /column "?([a-z_]+)"? .*does not exist/.exec(error.message || '');
    if (!m || !(m[1] in o)) throw error;
    console.warn('missing column, retry without', m[1]); S.missingCols = [...new Set([...(S.missingCols || []), m[1]])];
    delete o[m[1]];
  }
  throw new Error('儲存失敗');
}
const DB = {
  async list(t) {
    if (!CLOUD) return local.load()[t] || [];
    const { data, error } = await sb.from(t).select('*');
    if (error) {
      if (OPTIONAL_TABLES.includes(t)) { if (!S.missingTables.includes(t)) S.missingTables.push(t); return []; }
      throw error;
    }
    S.missingTables = S.missingTables.filter(x => x !== t);
    return data;
  },
  async insert(t, row) {
    row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row };
    if (!CLOUD) { const o = local.load(); (o[t] ||= []).push(row); local.save(o); return row; }
    row.user_id = user.id;
    return withColumnFallback(row, r => sb.from(t).insert(r).select().single());
  },
  async update(t, id, patch) {
    if (!CLOUD) { const o = local.load(); const r = (o[t] || []).find(x => x.id === id); Object.assign(r, patch); local.save(o); return r; }
    return withColumnFallback(patch, p => sb.from(t).update(p).eq('id', id).select().single());
  },
  async remove(t, id) {
    if (!CLOUD) { const o = local.load(); o[t] = (o[t] || []).filter(x => x.id !== id); local.save(o); return; }
    const { error } = await sb.from(t).delete().eq('id', id);
    if (error) throw error;
  },
};
async function add(t, row) { const r = await DB.insert(t, row); S[t].push(r); return r; }
async function upd(t, id, patch) { const r = await DB.update(t, id, patch); const i = S[t].findIndex(x => x.id === id); if (i >= 0) S[t][i] = { ...S[t][i], ...r }; return S[t][i]; }
async function del(t, id) { await DB.remove(t, id); S[t] = S[t].filter(x => x.id !== id); }
async function loadAll() {
  const res = await Promise.all(TABLES.map(t => DB.list(t)));
  TABLES.forEach((t, i) => S[t] = res[i] || []);
}

/* ---------------- credit card cycles ----------------
 * closing_day = 每月結帳日（小月沒有該日則取月底）；due_day = 每月扣款日（空白 = 結帳日當天）
 * 帳單週期 = 上一個結帳日隔天 ~ 本次結帳日；扣款日 = 結帳日之後第一個 due_day。
 * 扣款日當天開啟 App，自動把那期帳單從扣款帳戶扣掉（同日結帳扣款的卡，結帳日隔天才扣，等當天消費都進來）。
 */
function mkDay(y, m, day) { const last = new Date(y, m + 1, 0).getDate(); return new Date(y, m, Math.min(day, last)); }
function cycleEndOnOrAfter(day, ref) {
  let e = mkDay(ref.getFullYear(), ref.getMonth(), day);
  if (ymd(e) < ymd(ref)) e = mkDay(ref.getFullYear(), ref.getMonth() + 1, day);
  return e;
}
function nextCycleAfter(day, s) { const d = parseYmd(s); d.setDate(d.getDate() + 1); return cycleEndOnOrAfter(day, d); }
function prevCycleEnd(day, e) { return mkDay(e.getFullYear(), e.getMonth() - 1, day); }
const sameDayDebit = c => !c.due_day || +c.due_day === +c.closing_day;
function dueFor(c, E) { // E: 'YYYY-MM-DD' 結帳日 → 扣款日 Date
  if (sameDayDebit(c)) return parseYmd(E);
  return nextCycleAfter(+c.due_day, E);
}
function debitReached(c, E, today = todayStr()) {
  return sameDayDebit(c) ? E < today : ymd(dueFor(c, E)) <= today;
}
function initialSettled(c) { // 新增卡片時：最近一期「已經扣過款」的結帳日
  const t = todayDate();
  let e = cycleEndOnOrAfter(+c.closing_day, t);
  if (!(ymd(e) < ymd(t))) e = prevCycleEnd(+c.closing_day, e);
  for (let i = 0; i < 3 && !debitReached(c, ymd(e)); i++) e = prevCycleEnd(+c.closing_day, e);
  return ymd(e);
}
/* 改結帳日的過渡期：cycle_start ~ first_close 之間原本的結帳日都不算（例如 9/10 起的消費全部併入 10/29 帳單） */
const isSkippedClose = (c, E) => !!(c.first_close && c.cycle_start && E >= String(c.cycle_start).slice(0, 10) && E < String(c.first_close).slice(0, 10));
function closeOnOrAfter(c, ref) { let e = cycleEndOnOrAfter(+c.closing_day, ref), g = 0; while (isSkippedClose(c, ymd(e)) && g++ < 12) e = nextCycleAfter(+c.closing_day, ymd(e)); return e; }
function closeAfter(c, E) { let e = nextCycleAfter(+c.closing_day, E), g = 0; while (isSkippedClose(c, ymd(e)) && g++ < 12) e = nextCycleAfter(+c.closing_day, ymd(e)); return e; }
function closeBefore(c, e) { let p = prevCycleEnd(+c.closing_day, e), g = 0; while (isSkippedClose(c, ymd(p)) && g++ < 12) p = prevCycleEnd(+c.closing_day, p); return p; }
const txnDate = t => ymd(new Date(t.txn_at));
const billAmt = t => num(t.amount_twd) + num(t.fee); // 帳單金額 = 消費 + 國外交易手續費
const FEE_RE = /手續費|foreign\s*(transaction)?\s*fee|fx\s*fee/i;
const NO_REWARD_RE = /手續費|現金回饋|回饋金|折抵|年費|利息|違約金/i;
const isFeeRow = t => FEE_RE.test(t.merchant || '');
const feeRate = c => (c && c.fx_fee != null && c.fx_fee !== '') ? num(c.fx_fee) : 1.5;
const unsettled = cardId => S.transactions.filter(t => t.card_id === cardId && !t.settled_cycle);
const byTimeDesc = (a, b) => b.txn_at.localeCompare(a.txn_at);
const daysUntil = d => Math.round((d - todayDate()) / 864e5);

/* 一張卡的狀態：open = 還在累計的本期；billed = 已結帳、等扣款的帳單；next = 下一次扣款 */
function cardState(c) {
  const today = todayDate();
  const openEnd = closeOnOrAfter(c, today);
  const prevClose = closeBefore(c, openEnd);
  const openStart = new Date(prevClose); openStart.setDate(openStart.getDate() + 1);
  const OE = ymd(openEnd);
  if (c.cycle_start && OE === String(c.first_close || '').slice(0, 10)) { const cs = parseYmd(c.cycle_start); if (cs > openStart) openStart.setTime(cs.getTime()); }
  const all = unsettled(c.id);
  const lastClosed = ymd(prevClose);
  const billedItems = all.filter(t => txnDate(t) <= lastClosed).sort(byTimeDesc);
  const openItems = all.filter(t => txnDate(t) > lastClosed && txnDate(t) <= OE).sort(byTimeDesc);
  const open = { start: ymd(openStart), end: OE, items: openItems, total: sum(openItems, billAmt), due: dueFor(c, OE) };
  const billed = billedItems.length ? { end: lastClosed, items: billedItems, total: sum(billedItems, billAmt), due: dueFor(c, lastClosed) } : null;
  const nb = billed || open;
  const next = { date: nb.due, days: daysUntil(nb.due), amount: nb.total, final: !!billed, closeDays: daysUntil(openEnd) };
  return { open, billed, next };
}

let settling = false;
async function runSettlements() {
  if (settling) return; settling = true;
  const done = [];
  try {
    for (const c of S.cards) {
      if (!c.last_settled) { await upd('cards', c.id, { last_settled: initialSettled(c) }); continue; }
      let e = closeAfter(c, String(c.last_settled).slice(0, 10)), guard = 0;
      while (debitReached(c, ymd(e)) && guard++ < 36) {
        const E = ymd(e), D = ymd(dueFor(c, E));
        const items = unsettled(c.id).filter(t => txnDate(t) <= E);
        const amt = Math.round(sum(items, billAmt) * 100) / 100;
        if (items.length) {
          let ok = true;
          try {
            await add('settlements', { card_id: c.id, cycle_end: E, amount: amt, account_id: c.debit_account_id || null });
          } catch (err) { ok = false; console.warn('settlement exists', err); } // 另一台裝置已扣過
          if (ok) {
            const acc = S.accounts.find(a => a.id === c.debit_account_id);
            if (acc) {
              const delta = -fromTWD(amt, acc.currency);
              const after = Math.round((num(acc.balance) + delta) * 100) / 100;
              await upd('accounts', acc.id, { balance: after });
              await add('balance_log', { account_id: acc.id, delta, balance_after: after, note: `${c.name} ${md(E)} 帳單，${md(D)} 扣款` });
            }
            for (const t of items) await upd('transactions', t.id, { settled_cycle: E });
            done.push(`${c.name} ${md(D)} 扣款 ${money(amt)}`);
          }
        }
        await upd('cards', c.id, { last_settled: E });
        e = closeAfter(c, E);
      }
    }
  } finally { settling = false; }
  if (CLOUD && done.length) await loadAll();
  if (done.length) toast('已自動入帳：' + done.join('、'), 5000);
}

/* ---------------- market data ---------------- */
async function loadFX(force) {
  const c = !force && cacheGet('fx', 6 * 3600e3);
  if (c) { S.fx = c; return; }
  try {
    const j = await (await fetch('https://open.er-api.com/v6/latest/TWD')).json();
    if (j.rates) { S.fx = j.rates; cacheSet('fx', j.rates); }
  } catch (e) { console.warn('fx', e); }
}

const KNOWN_CG = { BTC: 'bitcoin', ETH: 'ethereum', USDT: 'tether', USDC: 'usd-coin', BNB: 'binancecoin', SOL: 'solana', XRP: 'ripple', DOGE: 'dogecoin', ADA: 'cardano', TRX: 'tron', TON: 'the-open-network', POL: 'polygon-ecosystem-token', AVAX: 'avalanche-2', LINK: 'chainlink', DOT: 'polkadot', SUI: 'sui', FDUSD: 'first-digital-usd', DAI: 'dai' };
async function findCgId(symbol) {
  const s = symbol.toUpperCase();
  if (KNOWN_CG[s]) return KNOWN_CG[s];
  try {
    const j = await (await fetch('https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(symbol))).json();
    const hits = (j.coins || []).filter(c => c.symbol.toUpperCase() === s).sort((a, b) => (a.market_cap_rank || 1e9) - (b.market_cap_rank || 1e9));
    return hits[0]?.id || null;
  } catch (_) { return null; }
}
function allCgIds() {
  const ids = S.crypto_holdings.map(h => h.cg_id);
  for (const k in S.walletBal) for (const b of S.walletBal[k].items || []) ids.push(b.cg);
  return [...new Set(ids.filter(Boolean))].sort();
}
async function loadPrices(force) {
  const ids = allCgIds(); if (!ids.length) return;
  const key = 'cg_' + ids.join(',');
  const c = !force && cacheGet(key, 120e3);
  if (c) { S.prices = c; return; }
  try {
    const j = await (await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=twd&include_24hr_change=true`)).json();
    const p = {}; for (const id in j) p[id] = { twd: j[id].twd, chg: j[id].twd_24h_change };
    if (Object.keys(p).length) { S.prices = p; cacheSet(key, p); }
  } catch (e) { toast('加密貨幣報價暫時抓不到（CoinGecko 限流時稍等一分鐘）'); }
}

async function loadQuotes(force) {
  const codes = [...new Set(S.stocks.map(s => String(s.code).trim().toUpperCase()))].filter(Boolean).sort();
  if (!codes.length || !CLOUD) return;
  const key = 'twq_' + codes.join(',');
  const c = !force && cacheGet(key, 60e3);
  if (c) { S.quotes = c; return; }
  try {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${CFG.supabaseUrl}/functions/v1/tw-quote?codes=${codes.join(',')}`, {
      headers: { Authorization: 'Bearer ' + session.access_token, apikey: CFG.supabaseAnonKey },
    });
    if (!r.ok) throw new Error(r.status);
    S.quotes = await r.json(); cacheSet(key, S.quotes);
  } catch (e) { toast('台股報價暫時抓不到，先用成本價計算'); }
}

/* ---------------- on-chain wallets (只讀公開地址) ---------------- */
const CHAINS = {
  eth: { label: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com', native: ['ETH', 'ethereum'],
    tokens: [['USDT', 'tether', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6], ['USDC', 'usd-coin', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6]] },
  bsc: { label: 'BNB Chain', rpc: 'https://bsc-rpc.publicnode.com', native: ['BNB', 'binancecoin'],
    tokens: [['USDT', 'tether', '0x55d398326f99059fF775485246999027B3197955', 18], ['USDC', 'usd-coin', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18]] },
  arb: { label: 'Arbitrum', rpc: 'https://arbitrum-one-rpc.publicnode.com', native: ['ETH', 'ethereum'],
    tokens: [['USDC', 'usd-coin', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6], ['USDT', 'tether', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 6]] },
  base: { label: 'Base', rpc: 'https://base-rpc.publicnode.com', native: ['ETH', 'ethereum'],
    tokens: [['USDC', 'usd-coin', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6]] },
  polygon: { label: 'Polygon', rpc: 'https://polygon-bor-rpc.publicnode.com', native: ['POL', 'polygon-ecosystem-token'],
    tokens: [['USDC', 'usd-coin', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 6], ['USDT', 'tether', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 6]] },
};
async function rpc(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
}
function fromHex(h, dec) {
  if (!h || h === '0x') return 0;
  const b = BigInt(h), base = 10n ** BigInt(dec);
  return Number(b / base) + Number(b % base) / Number(base);
}
async function scanEvm(addr) {
  const out = [];
  const data = '0x70a08231' + addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  await Promise.all(Object.values(CHAINS).map(async c => {
    try {
      const q = fromHex(await rpc(c.rpc, 'eth_getBalance', [addr, 'latest']), 18);
      if (q > 1e-9) out.push({ symbol: c.native[0], cg: c.native[1], qty: q, chain: c.label });
      for (const [sym, cg, ca, dec] of c.tokens) {
        const tq = fromHex(await rpc(c.rpc, 'eth_call', [{ to: ca, data }, 'latest']), dec);
        if (tq > 1e-9) out.push({ symbol: sym, cg, qty: tq, chain: c.label });
      }
    } catch (e) { console.warn(c.label, e); }
  }));
  return out;
}
async function scanBtc(addr) {
  const j = await (await fetch('https://mempool.space/api/address/' + encodeURIComponent(addr))).json();
  const sats = (j.chain_stats.funded_txo_sum - j.chain_stats.spent_txo_sum) + (j.mempool_stats.funded_txo_sum - j.mempool_stats.spent_txo_sum);
  return [{ symbol: 'BTC', cg: 'bitcoin', qty: sats / 1e8, chain: 'Bitcoin' }];
}
async function loadWallets(force) {
  const saved = cacheGet('wallets', force ? 0 : 10 * 60e3) || {};
  await Promise.all(S.wallets.map(async w => {
    if (saved[w.id] && !force) { S.walletBal[w.id] = saved[w.id]; return; }
    try {
      const items = w.chain === 'btc' ? await scanBtc(w.address) : await scanEvm(w.address);
      S.walletBal[w.id] = { items, at: Date.now() };
    } catch (e) { S.walletBal[w.id] = { items: [], err: true, at: Date.now() }; }
  }));
  cacheSet('wallets', S.walletBal);
}

/* ---------------- totals ---------------- */
/* 同一代號的多筆買進合併成一列：股數相加，成本用加權平均（賣出的負股數不影響均價） */
function stockRows() {
  const groups = {};
  for (const s of S.stocks) {
    const code = String(s.code).trim().toUpperCase();
    (groups[code] ||= []).push(s);
  }
  return Object.entries(groups).map(([code, lots]) => {
    const q = S.quotes[code];
    const price = q?.price ?? null;
    const shares = sum(lots, l => num(l.shares));
    const buys = lots.filter(l => num(l.shares) > 0 && l.avg_cost != null && l.avg_cost !== '');
    const buyShares = sum(buys, l => num(l.shares));
    const cost = buyShares ? sum(buys, l => num(l.shares) * num(l.avg_cost)) / buyShares : 0;
    const costTotal = cost * shares;
    const value = price != null ? price * shares : costTotal;
    const pl = price != null && cost ? (price - cost) * shares : null;
    const day = q?.prev ? (price - q.prev) / q.prev * 100 : null;
    lots.sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
    return { code, lots, q, price, shares, avg_cost: cost, costTotal, value, pl, plPct: cost && price != null ? (price - cost) / cost * 100 : null, day, name: lots.find(l => l.name)?.name || q?.name || '' };
  }).filter(r => r.shares !== 0 || r.lots.length).sort((a, b) => b.value - a.value);
}
function cryptoRows() {
  const map = {};
  const addRow = (sym, cg, qty, where) => {
    const k = cg || sym; map[k] ||= { symbol: sym, cg, qty: 0, where: [] };
    map[k].qty += qty; map[k].where.push(where);
  };
  for (const h of S.crypto_holdings) addRow(h.symbol.toUpperCase(), h.cg_id, num(h.qty), h.venue || '手動');
  for (const w of S.wallets) for (const b of S.walletBal[w.id]?.items || []) addRow(b.symbol, b.cg, b.qty, `${w.label || '錢包'}·${b.chain}`);
  return Object.values(map).map(r => {
    const p = S.prices[r.cg];
    return { ...r, price: p?.twd ?? null, chg: p?.chg ?? null, value: p?.twd != null ? p.twd * r.qty : null };
  }).sort((a, b) => (b.value || 0) - (a.value || 0));
}
function totals() {
  const bank = sum(S.accounts, a => { const v = toTWD(num(a.balance), a.currency); return Number.isFinite(v) ? v : 0; });
  const stock = sum(stockRows(), r => r.value || 0);
  const crypto = sum(cryptoRows(), r => r.value || 0);
  const debt = sum(S.transactions.filter(t => !t.settled_cycle), billAmt);
  const recv = sum(S.receivables.filter(r => !r.received_at), r => num(r.amount));
  const liab = sum(S.liabilities, l => Math.max(0, num(l.balance)));
  return { bank, stock, crypto, recv, debt, liab, net: bank + stock + crypto + recv - debt - liab };
}
async function saveSnapshot() {
  const t = totals(); const date = todayStr();
  const row = { date, net: Math.round(t.net), bank: Math.round(t.bank), stock: Math.round(t.stock), crypto: Math.round(t.crypto), debt: Math.round(t.debt + t.liab) };
  const ex = S.snapshots.find(s => String(s.date).slice(0, 10) === date);
  try {
    if (ex) await upd('snapshots', ex.id, row); else await add('snapshots', row);
  } catch (e) { console.warn('snapshot', e); }
}

/* ---------------- 信用卡回饋 ----------------
 * card.rewards = [{ id, label, kind:'base'|'bonus', where, pay, rate, cap, min, keywords, tiers, unit, on }]
 *  base：同一筆交易取「符合條件中回饋率最高」的一條；bonus：所有符合的加碼都疊加，各自依帳單週期封頂。
 *  tiers：依「這張卡上個月消費總額」決定加碼率與上限，例：[{min:1,rate:1,cap:300},{min:10001,rate:2,cap:600}]
 * 回饋點數一律以 1 點 = NT$1 估算。
 */
const WHERE = {
  all: ['不限地區', () => true],
  domestic: ['國內（台幣）', t => txnCur(t) === 'TWD'],
  overseas: ['海外（外幣）', t => txnCur(t) !== 'TWD'],
  japan: ['日本（日幣）', t => txnCur(t) === 'JPY'],
  'overseas-ex-jp': ['日本以外的海外', t => txnCur(t) !== 'TWD' && txnCur(t) !== 'JPY'],
  'dbs-regions': ['日韓泰星美歐', t => ['JPY', 'KRW', 'THB', 'SGD', 'USD', 'EUR', 'GBP', 'CAD', 'CHF', 'SEK', 'DKK', 'NOK', 'CZK', 'MXN'].includes(txnCur(t))],
};
const PAYS = {
  any: ['不限支付方式', () => true],
  mobile: ['任一行動支付', p => ['applepay', 'googlepay', 'linepay', 'samsungpay'].includes(p)],
  tap: ['Apple／Google Pay 感應', p => p === 'applepay' || p === 'googlepay'],
  applepay: ['Apple Pay', p => p === 'applepay'],
  linepay: ['LINE Pay', p => p === 'linepay'],
  card: ['實體卡／網購輸入卡號', p => p === 'card'],
};
const PAY_OPTIONS = [['card', '實體卡／網購'], ['applepay', 'Apple Pay'], ['linepay', 'LINE Pay'], ['googlepay', 'Google Pay'], ['samsungpay', 'Samsung Pay'], ['other', '其他']];
const txnCur = t => (t.currency || 'TWD').toUpperCase();
const txnPay = t => t.pay || (t.source === 'shortcut' ? 'applepay' : /line\s*pay/i.test(t.merchant || '') ? 'linepay' : 'card');
const ruleId = () => 'r' + Math.random().toString(36).slice(2, 8);
const pct = v => (Math.round(v * 100) / 100) + '%';

function ruleMatches(r, t) {
  if (r.on === false || t.source === 'installment' || NO_REWARD_RE.test(t.merchant || '')) return false; // 分期、手續費不享回饋
  if (!(WHERE[r.where || 'all'] || WHERE.all)[1](t)) return false;
  if (!(PAYS[r.pay || 'any'] || PAYS.any)[1](txnPay(t))) return false;
  if (r.min && Math.abs(num(t.amount_twd)) < r.min) return false;
  if (r.keywords) {
    const m = (t.merchant || '').toLowerCase();
    if (!r.keywords.split(/[,，、\s]+/).filter(Boolean).some(k => m.includes(k.toLowerCase()))) return false;
  }
  return true;
}
function monthKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
/* 分級加碼：預設依「上個月在這張卡的消費」自動判斷；r.manual = { '2026-10': 2 } 可手動指定某月的等級（0 起算） */
function tierIndex(r, spendPrev, mk) {
  if (!r.tiers?.length) return -1;
  if (r.manual && r.manual[mk] != null && r.manual[mk] !== '') return Math.min(+r.manual[mk], r.tiers.length - 1);
  let idx = -1;
  r.tiers.forEach((x, i) => { if (spendPrev >= x.min) idx = i; });
  return idx;
}
function tierFor(r, spendPrev, mk) {
  if (!r.tiers?.length) return { rate: num(r.rate), cap: num(r.cap), tier: -1 };
  const i = tierIndex(r, spendPrev, mk);
  return i >= 0 ? { rate: num(r.tiers[i].rate), cap: num(r.tiers[i].cap), tier: i } : { rate: 0, cap: 0, tier: -1 };
}
const prevMonthKey = d => monthKey(new Date(d.getFullYear(), d.getMonth() - 1, 1));
const ruleDesc = r => {
  const parts = [];
  if (r.tiers?.length) parts.push('依上月消費分級：' + r.tiers.map(x => `${x.min.toLocaleString()} 元起 ${pct(x.rate)}${x.cap ? `／上限 ${x.cap}` : ''}`).join('，'));
  else parts.push((r.kind === 'bonus' ? '加碼 ' : '') + pct(num(r.rate)) + (r.cap ? `，每期上限 ${num(r.cap).toLocaleString()}` : '，無上限'));
  if ((r.where || 'all') !== 'all') parts.push(WHERE[r.where]?.[0]);
  if ((r.pay || 'any') !== 'any') parts.push(PAYS[r.pay]?.[0]);
  if (r.min) parts.push(`單筆滿 ${r.min}`);
  if (r.cap_period === 'month') parts.push('上限依日曆月計算');
  if (r.round_txn) parts.push('逐筆四捨五入');
  if (r.manual && Object.keys(r.manual).length) parts.push('有手動指定等級');
  if (r.keywords) parts.push(`商家含「${r.keywords}」`);
  return parts.filter(Boolean).join('・');
};

/* 算一張卡全部交易的回饋。extra = 試算用的假交易 */
function cardRewards(c, extra) {
  const rules = c.rewards || [];
  const txns = S.transactions.filter(t => t.card_id === c.id);
  if (extra) txns.push(extra);
  txns.sort((a, b) => a.txn_at.localeCompare(b.txn_at));
  const monthSpend = {};
  for (const t of txns) { if (NO_REWARD_RE.test(t.merchant || '') || t.source === 'installment') continue; const k = monthKey(new Date(t.txn_at)); monthSpend[k] = (monthSpend[k] || 0) + Math.max(0, num(t.amount_twd)); }
  const per = {}, cycles = {}, capUsed = {};
  for (const t of txns) {
    const amt = num(t.amount_twd);
    const d = new Date(t.txn_at);
    const mk = monthKey(d);
    const cyc = ymd(closeOnOrAfter(c, parseYmd(ymd(d))));
    const prev = monthSpend[prevMonthKey(d)] || 0;
    const C = cycles[cyc] ||= { total: 0, rules: {} };
    const parts = [];
    const bases = rules.filter(r => r.kind !== 'bonus' && ruleMatches(r, t)).map(r => ({ r, ...tierFor(r, prev, mk) }));
    const base = bases.sort((a, b) => b.rate - a.rate)[0];
    const apply = (x) => {
      const R = C.rules[x.r.id] ||= { earned: 0, cap: x.cap };
      R.cap = x.cap;
      const ck = x.r.id + '|' + (x.r.cap_period === 'month' ? mk : cyc);
      const used = capUsed[ck] || 0;
      let v = amt * x.rate / 100;
      if (x.r.round_txn) v = Math.round(v); // 逐筆四捨五入（例如 MaiCoin U幣）
      if (v > 0 && x.cap) v = Math.max(0, Math.min(v, x.cap - used));
      if (v <= 0 && amt > 0) return;
      capUsed[ck] = used + v;
      R.earned += v; C.total += v; parts.push({ id: x.r.id, label: x.r.label, v });
    };
    if (base) apply(base);
    if (amt > 0) rules.filter(r => r.kind === 'bonus' && ruleMatches(r, t)).forEach(r => { const tr = tierFor(r, prev, mk); if (tr.rate) apply({ r, ...tr }); });
    per[t.id] = { v: sum(parts, p => p.v), parts };
  }
  return { per, cycles, capUsed, monthSpend };
}
function allRewards() {
  const per = {}, byCard = {};
  for (const c of S.cards) { const r = cardRewards(c); byCard[c.id] = r; Object.assign(per, r.per); }
  S.rew = { per, byCard };
  return S.rew;
}
const rewOf = id => S.rew?.per[id]?.v || 0;
function cycleReward(c, end) { return S.rew?.byCard[c.id]?.cycles[end] || { total: 0, rules: {} }; }

/* 刷哪張最划算 */
const SCENES = [
  ['國內一般消費', { currency: 'TWD', pay: 'card' }],
  ['國內 Apple Pay', { currency: 'TWD', pay: 'applepay' }],
  ['LINE Pay', { currency: 'TWD', pay: 'linepay', merchant: 'LINE Pay' }],
  ['日本 Apple Pay 感應', { currency: 'JPY', pay: 'applepay' }],
  ['日本實體刷卡', { currency: 'JPY', pay: 'card' }],
  ['其他海外消費', { currency: 'USD', pay: 'card' }],
];
function recommend(sceneIdx, amountTwd) {
  const [, sc] = SCENES[sceneIdx];
  const now = new Date().toISOString();
  return S.cards.map(c => {
    const fake = { id: '__sim', card_id: c.id, amount: amountTwd, amount_twd: amountTwd, txn_at: now, ...sc };
    const r = cardRewards(c, fake).per.__sim || { v: 0, parts: [] };
    return { c, v: r.v, parts: r.parts };
  }).sort((a, b) => b.v - a.v);
}

/* 建議回饋規則（依 2026 年各卡公開權益整理，需自行確認登錄、等級、新戶資格） */
const REWARD_PRESETS = {
  吉鶴: [
    { label: '國內一般', kind: 'base', where: 'domestic', rate: 1, unit: '現金回饋' },
    { label: '日本實體（日幣）', kind: 'base', where: 'japan', rate: 2.5, unit: '現金回饋' },
    { label: '其他海外', kind: 'base', where: 'overseas-ex-jp', rate: 1, unit: '現金回饋' },
    { label: '日本 Apple／Google Pay 加碼（需登錄）', kind: 'bonus', where: 'japan', pay: 'tap', rate: 1.5, cap: 600, min: 100, unit: '現金回饋' },
  ],
  MaiCoin: [
    { label: '一般消費', kind: 'base', rate: 0.5, unit: 'U幣', round_txn: true },
    { label: '等級加碼（依上月消費）', kind: 'bonus', unit: 'U幣', cap_period: 'month', tiers: [{ min: 1, rate: 1, cap: 300 }, { min: 10001, rate: 2, cap: 600 }, { min: 30001, rate: 4, cap: 1200 }] },
  ],
  星展: [
    { label: '國內一般', kind: 'base', where: 'domestic', rate: 1, unit: '現金積點' },
    { label: '海外一般', kind: 'base', where: 'overseas', rate: 1.5, unit: '現金積點' },
    { label: '日韓泰星美歐實體加碼', kind: 'bonus', where: 'dbs-regions', rate: 3.5, cap: 800, unit: '現金積點' },
  ],
  DAWHO: [
    { label: '國內一般', kind: 'base', where: 'domestic', rate: 1, unit: '現金回饋' },
    { label: '海外一般', kind: 'base', where: 'overseas', rate: 2, unit: '現金回饋' },
    { label: '大戶等級加碼', kind: 'bonus', rate: 2.5, cap: 400, unit: '現金回饋' },
    { label: '大戶 Plus 加碼（達標才開）', kind: 'bonus', rate: 4, cap: 1000, unit: '現金回饋', on: false },
  ],
  DAWAY: [
    { label: '國內一般', kind: 'base', where: 'domestic', rate: 0.5, unit: 'LINE POINTS' },
    { label: '海外一般', kind: 'base', where: 'overseas', rate: 2.5, unit: 'LINE POINTS' },
    { label: 'DAWAY GO＋LINE Pay 加碼', kind: 'bonus', pay: 'linepay', rate: 1.5, cap: 300, unit: 'LINE POINTS' },
    { label: '新戶 LINE Pay 加碼（新戶才開）', kind: 'bonus', pay: 'linepay', rate: 6, cap: 500, unit: 'LINE POINTS', on: false },
  ],
};
function presetRewardsFor(card) {
  const n = `${card.name} ${card.wallet_name || ''}`;
  const key = Object.keys(REWARD_PRESETS).find(k => n.toLowerCase().includes(k.toLowerCase()));
  return key ? REWARD_PRESETS[key].map(r => ({ id: ruleId(), on: true, ...r })) : null;
}

function rewardPanel(c, st) {
  const rules = c.rewards || [];
  const R = cycleReward(c, st.open.end);
  const B = st.billed ? cycleReward(c, st.billed.end) : null;
  const unit = [...new Set(rules.map(r => r.unit).filter(Boolean))].join('／') || '回饋';
  const CR = S.rew?.byCard[c.id] || { capUsed: {}, monthSpend: {} };
  const now = new Date(), mk = monthKey(now), pmk = prevMonthKey(now);
  const meters = rules.filter(r => r.on !== false && (r.cap || r.tiers)).map(r => {
    let earned, cap, note = '';
    if (r.tiers?.length) {
      const tr = tierFor(r, CR.monthSpend[pmk] || 0, mk);
      cap = tr.cap;
      const manual = r.manual && r.manual[mk] != null && r.manual[mk] !== '';
      note = tr.tier >= 0 ? `本月 Lv${tr.tier + 1}（加碼 ${pct(tr.rate)}）${manual ? '・手動指定' : `・依 App 記錄的上月消費 ${money(CR.monthSpend[pmk] || 0)}`}` : '上月沒有消費紀錄，本月不加碼（可點規則手動指定等級）';
    } else cap = num(r.cap);
    if (r.cap_period === 'month') earned = CR.capUsed[r.id + '|' + mk] || 0;
    else earned = (R.rules[r.id] || { earned: 0 }).earned;
    return `<div class="rmeter"><div class="rm-top"><span>${esc(r.label)}${r.cap_period === 'month' ? `（${now.getMonth() + 1} 月）` : ''}</span><span class="num">${Math.round(earned)}${cap ? ` / ${cap}` : ''}</span></div>
      ${cap ? `<div class="meter"><i style="width:${Math.min(100, earned / cap * 100).toFixed(1)}%"></i></div>` : ''}${note ? `<div class="meta">${note}</div>` : ''}</div>`;
  }).join('');
  const list = rules.map((r, i) => `<div class="row click rule${r.on === false ? ' off' : ''}" data-act="edit-rule" data-card="${c.id}" data-i="${i}">
      <div class="grow"><div class="title">${esc(r.label)}</div><div class="meta">${esc(ruleDesc(r))}</div></div>
      <button class="tgl${r.on === false ? '' : ' on'}" data-act="toggle-rule" data-card="${c.id}" data-i="${i}" aria-pressed="${r.on !== false}" aria-label="啟用"><i></i></button></div>`).join('');
  const hasPreset = !!presetRewardsFor(c);
  return `<h2>回饋</h2><section class="panel">
    <div class="rew-head"><div><small>本期預估回饋</small><b>${money(R.total)}</b><span class="meta"> ${esc(unit)}</span></div>
      ${B ? `<div class="r"><small>${md(st.billed.end)} 帳單回饋</small><b>${money(B.total)}</b></div>` : ''}</div>
    ${meters ? `<div class="rmeters">${meters}</div>` : ''}
  </section>
  <section class="panel">${list || '<div class="empty">還沒有回饋規則</div>'}
    <div class="actions"><button class="btn small" data-act="add-rule" data-card="${c.id}">新增規則</button>
    ${hasPreset ? `<button class="btn small ghost" data-act="preset-rules" data-card="${c.id}">${rules.length ? '重設為建議規則' : '套用建議規則'}</button>` : ''}</div>
  </section>`;
}

function formRule(c, i) {
  const rules = (c.rewards || []).slice();
  const r = i != null ? rules[i] : { kind: 'bonus', where: 'all', pay: 'any', unit: rules[0]?.unit || '現金回饋' };
  const tierStr = (r.tiers || []).map(x => `${x.min}:${x.rate}:${x.cap || 0}`).join(', ');
  openForm({
    title: i != null ? '編輯回饋規則' : '新增回饋規則', data: { ...r, tiers: tierStr, on: r.on !== false, cap_period: r.cap_period || 'cycle',
      lv_cur: r.manual?.[monthKey(new Date())] ?? '', lv_prev: r.manual?.[prevMonthKey(new Date())] ?? '' },
    note: '<p class="muted" style="margin-top:-6px;font-size:13px">基本回饋取符合條件中最高的一條；加碼會疊加在基本回饋上，各自依帳單週期封頂。</p>',
    fields: [
      { k: 'label', label: '名稱', req: 1, ph: '例：LINE Pay 加碼' },
      { k: 'kind', label: '類型', type: 'select', options: [['base', '基本回饋'], ['bonus', '加碼回饋']] },
      { k: 'rate', label: '回饋率（%）', type: 'number', hint: '有填分級時以分級為準' },
      { k: 'cap', label: '每期回饋上限（點／元，0 = 無上限）', type: 'number' },
      { k: 'where', label: '適用地區', type: 'select', options: Object.entries(WHERE).map(([k, v]) => [k, v[0]]) },
      { k: 'pay', label: '支付方式', type: 'select', options: Object.entries(PAYS).map(([k, v]) => [k, v[0]]) },
      { k: 'min', label: '單筆最低金額（選填）', type: 'number' },
      { k: 'keywords', label: '商家關鍵字（選填，逗號分隔）', ph: '例：全聯, 7-ELEVEN' },
      { k: 'tiers', label: '依上月消費分級（選填）', ph: '1:1:300, 10001:2:600, 30001:4:1200', hint: '格式「上月消費門檻:回饋率:上限」，用逗號隔開' },
      ...(r.tiers?.length ? [
        { k: 'lv_cur', label: `${new Date().getMonth() + 1} 月等級`, type: 'select', options: [['', '自動（依上月消費）'], ...r.tiers.map((x, i) => [String(i), `Lv${i + 1}（${pct(x.rate)}，上限 ${x.cap}）`])], hint: 'App 沒有完整的上月紀錄時，照銀行顯示的等級手動指定' },
        { k: 'lv_prev', label: `${(new Date().getMonth() + 11) % 12 + 1} 月等級`, type: 'select', options: [['', '自動（依上月消費）'], ...r.tiers.map((x, i) => [String(i), `Lv${i + 1}（${pct(x.rate)}，上限 ${x.cap}）`])] },
      ] : []),
      { k: 'cap_period', label: '回饋上限怎麼算', type: 'select', options: [['cycle', '每個帳單週期'], ['month', '每個日曆月（1 日到月底）']] },
      { k: 'round_txn', label: '每筆回饋四捨五入到整數', type: 'check' },
      { k: 'unit', label: '回饋形式', ph: '現金回饋、LINE POINTS、U幣…' },
      { k: 'on', label: '啟用這條規則', type: 'check' },
    ],
    onSave: async v => {
      const tiers = (v.tiers || '').split(/[,，]/).map(s => s.trim()).filter(Boolean).map(s => { const [min, rate, cap] = s.split(':').map(Number); return { min: min || 0, rate: rate || 0, cap: cap || 0 }; }).filter(x => x.rate);
      const manual = { ...(r.manual || {}) };
      const setLv = (k, val) => { if (val === '' || val == null) delete manual[k]; else manual[k] = +val; };
      if ('lv_cur' in v) setLv(monthKey(new Date()), v.lv_cur);
      if ('lv_prev' in v) setLv(prevMonthKey(new Date()), v.lv_prev);
      const nr = { id: r.id || ruleId(), label: v.label, kind: v.kind, where: v.where, pay: v.pay, rate: v.rate || 0, cap: v.cap || 0, min: v.min || 0, keywords: v.keywords, unit: v.unit, on: v.on,
        cap_period: v.cap_period === 'month' ? 'month' : 'cycle', round_txn: !!v.round_txn, ...(tiers.length ? { tiers } : {}), ...(Object.keys(manual).length ? { manual } : {}) };
      if (i != null) rules[i] = nr; else rules.push(nr);
      await upd('cards', c.id, { rewards: rules });
    },
    onDelete: i != null && (async () => { rules.splice(i, 1); await upd('cards', c.id, { rewards: rules }); }),
  });
}

function openRecommend() {
  const m = $('#modal');
  const draw = () => {
    const si = +($('#recScene')?.value || 0), amt = Math.max(1, num($('#recAmt')?.value) || 1000);
    const res = recommend(si, amt);
    $('#recOut').innerHTML = res.length ? res.map((x, k) => `<div class="row">
        <span class="rank${k === 0 ? ' top' : ''}">${k + 1}</span>
        <div class="grow"><div class="title">${esc(x.c.name)}</div><div class="meta one">${x.parts.map(p => `${esc(p.label)} ${Math.round(p.v * 10) / 10}`).join('＋') || '沒有符合的回饋'}</div></div>
        <div class="right"><div class="amt">${money(x.v, 'TWD', x.v < 100 ? 1 : 0)}</div><div class="meta">${pct(x.v / amt * 100)}</div></div></div>`).join('')
      : '<div class="empty">先新增信用卡和回饋規則</div>';
  };
  m.innerHTML = `<div class="sheet"><h3>這筆刷哪張？</h3>
    <label>消費情境<select id="recScene">${SCENES.map(([n], i) => `<option value="${i}">${n}</option>`).join('')}</select></label>
    <label>金額（台幣）<input id="recAmt" type="number" inputmode="decimal" value="1000"></label>
    <p class="meta" style="margin:-4px 0 6px">已扣掉各卡本期已用掉的回饋上限</p>
    <div id="recOut"></div>
    <div class="actions"><button class="btn ghost" data-f="close">關閉</button></div></div>`;
  m.hidden = false;
  const close = () => { m.hidden = true; m.innerHTML = ''; };
  m.onclick = e => { if (e.target === m || e.target.dataset.f === 'close') close(); };
  $('#recScene').onchange = draw; $('#recAmt').oninput = draw;
  draw();
}

/* 提早繳款：把已出帳單標成已繳，不再等扣款日 */
function formPaidBill(c) {
  const st = cardState(c), bl = st.billed; if (!bl) return;
  const acc = S.accounts.find(a => a.id === c.debit_account_id);
  openForm({
    title: `${c.name}：${md(bl.end)} 帳單已繳`, note: `<p class="muted" style="margin-top:-6px">${money(bl.total)}，原訂 ${md(ymd(bl.due))} 扣款</p>`,
    data: { mode: 'mark' },
    fields: [{ k: 'mode', label: '帳戶餘額要怎麼處理？', type: 'select', options: [
      ['mark', '只標記已繳（我填的帳戶餘額已經是繳完後的）'],
      ...(acc ? [['deduct', `從 ${acc.name} 扣除 ${money(bl.total)}`]] : []),
    ] }],
    onSave: async v => {
      const E = bl.end, amt = Math.round(bl.total * 100) / 100;
      try { await add('settlements', { card_id: c.id, cycle_end: E, amount: amt, account_id: acc?.id || null }); } catch (_) { /* 已有紀錄 */ }
      if (v.mode === 'deduct' && acc) {
        const delta = -fromTWD(amt, acc.currency), after = Math.round((num(acc.balance) + delta) * 100) / 100;
        await upd('accounts', acc.id, { balance: after });
        await add('balance_log', { account_id: acc.id, delta, balance_after: after, note: `${c.name} ${md(E)} 帳單（提早繳款）` });
      }
      for (const t of bl.items) await upd('transactions', t.id, { settled_cycle: E });
      if (!c.last_settled || String(c.last_settled).slice(0, 10) < E) await upd('cards', c.id, { last_settled: E });
      toast(`已標記 ${md(E)} 帳單繳清，下次扣款 ${md(ymd(st.open.due))}`);
    },
  });
}

/* ---------------- 匯入刷卡紀錄（CSV） ----------------
 * 欄位：日期,卡片,商家,金額,幣別,台幣金額,海外,支付方式,手續費
 * 只有前四欄必填；卡片名稱可以只寫一部分（例如 MaiCoin、星展）。
 */
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
const HEAD = { 日期: 'date', 入帳日: 'date', 消費日: 'date', 卡片: 'card', 信用卡: 'card', 商家: 'merchant', 摘要: 'merchant', 說明: 'merchant', 金額: 'amount', 幣別: 'currency', 台幣金額: 'twd', 海外: 'overseas', 支付方式: 'pay', 手續費: 'fee' };
function matchCard(txt) {
  const n = String(txt || '').toLowerCase().replace(/\s/g, '');
  if (!n) return null;
  return S.cards.find(c => [c.name, c.wallet_name].filter(Boolean).some(k => { const kk = k.toLowerCase().replace(/\s/g, ''); return n.includes(kk) || kk.includes(n); })) || null;
}
function parseImport(text) {
  const rows = parseCSV(text); if (!rows.length) return { items: [], errors: ['沒有資料'] };
  const head = rows[0].map(h => HEAD[h.trim()] || h.trim().toLowerCase());
  const hasHead = head.includes('date') && head.includes('amount');
  const keys = hasHead ? head : ['date', 'card', 'merchant', 'amount', 'currency', 'twd', 'overseas', 'pay', 'fee'];
  const items = [], errors = [];
  (hasHead ? rows.slice(1) : rows).forEach((r, i) => {
    const o = {}; keys.forEach((k, j) => o[k] = (r[j] || '').trim());
    const line = i + (hasHead ? 2 : 1);
    const dm = o.date.replace(/[年月.]/g, '/').replace(/日/g, '').match(/(\d{2,4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (!dm) { errors.push(`第 ${line} 行：看不懂日期「${o.date}」`); return; }
    let y = +dm[1]; if (y < 1911 && y > 99) y += 1911; if (y < 100) y += 2000; // 民國年
    const amount = parseFloat(String(o.amount).replace(/[,\s$NT元]/g, ''));
    if (!Number.isFinite(amount)) { errors.push(`第 ${line} 行：看不懂金額「${o.amount}」`); return; }
    const card = matchCard(o.card);
    if (!card) { errors.push(`第 ${line} 行：對不到卡片「${o.card}」`); return; }
    const currency = (o.currency || 'TWD').toUpperCase();
    const twd = o.twd ? parseFloat(o.twd.replace(/,/g, '')) : currency === 'TWD' ? amount : Math.round(toTWD(amount, currency) * 100) / 100;
    const overseas = /^(1|y|yes|true|是|v|✓|海外)$/i.test(o.overseas || '') || currency !== 'TWD';
    const at = new Date(y, +dm[2] - 1, +dm[3], 12);
    const feeRow = FEE_RE.test(o.merchant);
    const fee = o.fee !== undefined && o.fee !== '' ? parseFloat(o.fee) : (overseas && !feeRow ? Math.round(Math.abs(twd) * feeRate(card) / 100) * Math.sign(twd || 1) : 0);
    const pay = ({ 'apple pay': 'applepay', applepay: 'applepay', 'line pay': 'linepay', linepay: 'linepay', 'google pay': 'googlepay' })[(o.pay || '').toLowerCase()] || (/line\s*pay/i.test(o.merchant) ? 'linepay' : 'card');
    items.push({ card, row: { card_id: card.id, card_label: card.name, merchant: o.merchant, amount, currency, amount_twd: twd, fee, pay, txn_at: at.toISOString(), source: 'import' } });
  });
  return { items, errors };
}
function isDup(r) {
  return S.transactions.some(t => t.card_id === r.card_id && txnDate(t) === ymd(new Date(r.txn_at)) && Math.abs(num(t.amount_twd) - num(r.amount_twd)) < 0.01 && (t.merchant || '').trim() === (r.merchant || '').trim());
}
function openImport() {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h3>匯入刷卡紀錄</h3>
    <p class="meta" style="margin-top:-8px">選 Claude 整理好的 CSV 檔，或直接貼上內容。第一行是標題：日期,卡片,商家,金額,幣別,台幣金額,海外,支付方式</p>
    <label class="btn" style="margin:6px 0 10px;color:var(--text)">選擇 CSV 檔<input type="file" accept=".csv,text/csv,text/plain" id="impFile" hidden></label>
    <label>或貼上內容<textarea id="impText" rows="6" style="font-size:13px;font-family:ui-monospace,Menlo,monospace" placeholder="日期,卡片,商家,金額\n2026/10/04,MaiCoin,APPLE.COM/BILL,1180"></textarea></label>
    <div id="impPrev" class="meta"></div>
    <div class="actions"><button class="btn ghost" data-f="close">取消</button><button class="btn primary" id="impGo" disabled>匯入</button></div></div>`;
  m.hidden = false;
  const close = () => { m.hidden = true; m.innerHTML = ''; };
  m.onclick = e => { if (e.target === m || e.target.dataset.f === 'close') close(); };
  let parsed = null;
  const preview = () => {
    parsed = parseImport($('#impText').value);
    const fresh = parsed.items.filter(x => !isDup(x.row));
    const past = fresh.filter(x => x.card.last_settled && ymd(new Date(x.row.txn_at)) <= String(x.card.last_settled).slice(0, 10)).length;
    const byCard = {}; fresh.forEach(x => byCard[x.card.name] = (byCard[x.card.name] || 0) + billAmt(x.row));
    $('#impPrev').innerHTML = `${fresh.length ? `可匯入 <b>${fresh.length}</b> 筆：${Object.entries(byCard).map(([k, v]) => `${esc(k)} ${money(v)}`).join('、')}` : '還沒有可匯入的資料'}
      ${parsed.items.length - fresh.length ? `<br>略過 ${parsed.items.length - fresh.length} 筆重複` : ''}
      ${past ? `<br>${past} 筆落在已扣款的帳單週期，會直接標記為已繳` : ''}
      ${parsed.errors.length ? `<br><span class="neg">${parsed.errors.slice(0, 6).map(esc).join('<br>')}${parsed.errors.length > 6 ? `<br>…還有 ${parsed.errors.length - 6} 個問題` : ''}</span>` : ''}`;
    $('#impGo').disabled = !fresh.length;
  };
  $('#impText').oninput = preview;
  $('#impFile').onchange = async e => { $('#impText').value = await e.target.files[0].text(); preview(); };
  $('#impGo').onclick = async () => {
    const fresh = parsed.items.filter(x => !isDup(x.row));
    $('#impGo').disabled = true; $('#impGo').textContent = '匯入中…';
    let n = 0;
    try {
      for (const x of fresh) {
        const r = { ...x.row };
        if (x.card.last_settled && ymd(new Date(r.txn_at)) <= String(x.card.last_settled).slice(0, 10)) r.settled_cycle = 'past';
        await add('transactions', r); n++;
      }
      close(); render(); toast(`已匯入 ${n} 筆刷卡紀錄`);
    } catch (err) { toast(`匯入到第 ${n + 1} 筆時失敗：${err.message}`); $('#impGo').disabled = false; $('#impGo').textContent = '匯入'; }
  };
}

/* ---------------- 帳戶轉帳 ---------------- */
function formTransfer(from) {
  if (S.accounts.length < 2) { toast('至少要有兩個帳戶才能轉帳'); return; }
  const opts = S.accounts.map(a => [a.id, `${a.name}（${money(num(a.balance), a.currency)}）`]);
  openForm({
    title: '帳戶轉帳', data: { from: from?.id || S.accounts[0].id, to: S.accounts.find(a => a.id !== (from?.id || S.accounts[0].id))?.id, date: todayStr() },
    fields: [
      { k: 'from', label: '轉出帳戶', type: 'select', options: opts },
      { k: 'to', label: '轉入帳戶', type: 'select', options: opts },
      { k: 'amount', label: '轉出金額（轉出帳戶的幣別）', type: 'number', req: 1 },
      { k: 'to_amount', label: '轉入金額（幣別不同時填，例如換匯後實際入帳）', type: 'number', hint: '留空：同幣別等於轉出金額；不同幣別依即時匯率換算' },
      { k: 'fee', label: '手續費（從轉出帳戶扣，選填）', type: 'number', hint: '跨行轉帳常見 NT$10–15' },
      { k: 'note', label: '備註', ph: '例：存到大戶、換美金' },
    ],
    onSave: async v => {
      const A = S.accounts.find(a => a.id === v.from), B = S.accounts.find(a => a.id === v.to);
      if (!A || !B || A.id === B.id) throw new Error('轉出和轉入要選不同帳戶');
      if (!(v.amount > 0)) throw new Error('金額要大於 0');
      const inAmt = v.to_amount != null ? v.to_amount : (A.currency === B.currency ? v.amount : Math.round(fromTWD(toTWD(v.amount, A.currency), B.currency) * 100) / 100);
      if (!Number.isFinite(inAmt)) throw new Error('抓不到匯率，請手動填轉入金額');
      const fee = num(v.fee);
      const aAfter = Math.round((num(A.balance) - v.amount - fee) * 100) / 100;
      const bAfter = Math.round((num(B.balance) + inAmt) * 100) / 100;
      const tag = v.note ? `・${v.note}` : '';
      await upd('accounts', A.id, { balance: aAfter });
      await add('balance_log', { account_id: A.id, delta: -(v.amount + fee), balance_after: aAfter, note: `轉帳 → ${B.name}${fee ? `（含手續費 ${fee}）` : ''}${tag}` });
      await upd('accounts', B.id, { balance: bAfter });
      await add('balance_log', { account_id: B.id, delta: inAmt, balance_after: bAfter, note: `轉帳 ← ${A.name}${tag}` });
      toast(`已從 ${A.name} 轉 ${money(v.amount, A.currency)} 到 ${B.name}`);
    },
  });
}

/* ---------------- 應收款與分期／負債 ---------------- */
function addMonths(dateStr, n, day) { const d = parseYmd(dateStr); return mkDay(d.getFullYear(), d.getMonth() + n, day || d.getDate()); }
/* 捷徑記進來的外幣交易，自動補上預估的國外交易手續費 */
async function autoFees() {
  for (const t of S.transactions) {
    if (t.fee != null || t.settled_cycle || t.source !== 'shortcut' || (t.currency || 'TWD') === 'TWD' || isFeeRow(t)) continue;
    const c = S.cards.find(x => x.id === t.card_id);
    await upd('transactions', t.id, { fee: Math.round(Math.abs(num(t.amount_twd)) * feeRate(c) / 100) });
  }
}
let installing = false;
async function runInstallments() {
  if (installing || !S.liabilities.length) return; installing = true;
  const done = [];
  try {
    const today = todayStr();
    for (const L of S.liabilities) {
      let next = L.next_date && String(L.next_date).slice(0, 10), left = +L.periods_left || 0, bal = num(L.balance);
      const amt = num(L.monthly), day = next ? parseYmd(next).getDate() : 0;
      if (!next || !amt || left <= 0) continue;
      let changed = false, guard = 0;
      while (next <= today && left > 0 && guard++ < 60) {
        const pay = Math.min(amt, bal > 0 ? bal : amt);
        const k = (+L.periods_total || 0) ? (+L.periods_total - left + 1) : null;
        const label = `${L.name}${k ? ` 第 ${k}/${L.periods_total} 期` : ' 分期'}`;
        if (L.card_id) {
          const card = S.cards.find(c => c.id === L.card_id);
          const at = parseYmd(next); at.setHours(12);
          const row = { card_id: L.card_id, merchant: label, amount: pay, currency: 'TWD', amount_twd: pay, pay: 'card', source: 'installment', txn_at: at.toISOString(), card_label: card?.name || '' };
          if (card?.last_settled && next <= String(card.last_settled).slice(0, 10)) row.settled_cycle = 'past';
          await add('transactions', row);
        } else if (L.account_id) {
          const acc = S.accounts.find(a => a.id === L.account_id);
          if (acc) {
            const after = Math.round((num(acc.balance) - fromTWD(pay, acc.currency)) * 100) / 100;
            await upd('accounts', acc.id, { balance: after });
            await add('balance_log', { account_id: acc.id, delta: -fromTWD(pay, acc.currency), balance_after: after, note: label });
          }
        }
        bal = Math.max(0, Math.round((bal - pay) * 100) / 100); left--; changed = true;
        done.push(label);
        next = ymd(addMonths(next, 1, day));
      }
      if (changed) await upd('liabilities', L.id, { balance: bal, periods_left: left, next_date: next });
    }
  } finally { installing = false; }
  if (done.length) toast('分期已入帳：' + done.join('、'), 5000);
}

function recvSection() {
  const open = S.receivables.filter(r => !r.received_at).sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9')));
  const doneList = S.receivables.filter(r => r.received_at).sort((a, b) => String(b.received_at).localeCompare(String(a.received_at))).slice(0, 5);
  const row = r => `<div class="row click" data-act="edit-recv" data-id="${r.id}">
      <div class="grow"><div class="title">${esc(r.name)}</div><div class="meta">${r.received_at ? `${new Date(r.received_at).toLocaleDateString('zh-TW')} 已收到` : r.due_date ? `預計 ${md(r.due_date)} 收到${daysUntil(parseYmd(r.due_date)) < 0 ? '・<span class="warn">已過期</span>' : ''}` : '未定收款日'}${r.note ? '・' + esc(r.note) : ''}</div></div>
      <div class="right"><div class="amt${r.received_at ? ' soft' : ''}">${money(num(r.amount))}</div>${r.received_at ? '' : `<button class="btn small" data-act="got-recv" data-id="${r.id}" style="margin-top:4px">已收到</button>`}</div></div>`;
  return `<h2>應收款 <button class="btn small" data-act="add-recv">＋ 新增</button></h2>
    <section class="panel">${open.map(row).join('') || '<div class="empty">別人欠你、還沒入帳的錢記在這裡</div>'}
    ${doneList.length ? `<div class="meta" style="margin:12px 0 2px">最近收到</div>${doneList.map(row).join('')}` : ''}</section>`;
}
function liabSection() {
  const rows = S.liabilities.slice().sort((a, b) => num(b.balance) - num(a.balance)).map(L => {
    const card = S.cards.find(c => c.id === L.card_id), acc = S.accounts.find(a => a.id === L.account_id);
    const total = +L.periods_total || 0, left = +L.periods_left || 0;
    const prog = total ? (total - left) / total * 100 : null;
    const how = card ? `掛在 ${esc(card.name)}` : acc ? `從 ${esc(acc.name)} 扣` : '手動';
    return `<div class="row click" data-act="edit-liab" data-id="${L.id}">
      <div class="grow"><div class="title">${esc(L.name)}</div>
        <div class="meta">${L.monthly ? `每期 ${money(num(L.monthly))}・` : ''}${left ? `剩 ${left} 期・` : ''}${L.next_date && left ? `下次 ${md(L.next_date)}・` : ''}${how}</div>
        ${prog != null ? `<div class="meter"><i style="width:${prog.toFixed(1)}%"></i></div>` : ''}</div>
      <div class="right"><div class="amt">${money(num(L.balance))}</div><div class="meta">${left ? '未繳' : '已繳清'}</div></div></div>`;
  }).join('');
  return `<h2>分期／負債 <button class="btn small" data-act="add-liab">＋ 新增</button></h2>
    <section class="panel">${rows || '<div class="empty">信用卡分期、學貸、車貸等。設定每期金額與下次扣款日，到期會自動記進信用卡或扣帳戶</div>'}</section>`;
}
function formRecv(r) {
  openForm({
    title: r ? '編輯應收款' : '新增應收款', data: r ? { ...r, got: !!r.received_at } : {},
    fields: [
      { k: 'name', label: '項目', req: 1, ph: '例：朋友代墊機票、公司報帳' },
      { k: 'amount', label: '金額（台幣）', type: 'number', req: 1 },
      { k: 'due_date', label: '預計收到日期（選填）', type: 'date' },
      { k: 'note', label: '備註' },
      ...(r ? [{ k: 'got', label: '已經收到', type: 'check' }] : []),
    ],
    onSave: async v => {
      const row = { name: v.name, amount: v.amount, due_date: v.due_date || null, note: v.note };
      if (r) { row.received_at = v.got ? (r.received_at || new Date().toISOString()) : null; await upd('receivables', r.id, row); }
      else await add('receivables', row);
    },
    onDelete: r && (() => del('receivables', r.id)),
  });
}
function formReceive(r) {
  openForm({
    title: `收到：${r.name}`, note: `<p class="muted" style="margin-top:-6px">${money(num(r.amount))}</p>`,
    data: { amount: r.amount, account_id: S.accounts[0]?.id || '' },
    fields: [
      { k: 'account_id', label: '存進哪個帳戶', type: 'select', options: [['', '（不存入帳戶，只標記已收到）'], ...S.accounts.map(a => [a.id, a.name])] },
      { k: 'amount', label: '實際收到金額（台幣）', type: 'number', req: 1 },
    ],
    onSave: async v => {
      const acc = S.accounts.find(a => a.id === v.account_id);
      if (acc) {
        const delta = fromTWD(v.amount, acc.currency), after = Math.round((num(acc.balance) + delta) * 100) / 100;
        await upd('accounts', acc.id, { balance: after });
        await add('balance_log', { account_id: acc.id, delta, balance_after: after, note: `收到 ${r.name}` });
      }
      await upd('receivables', r.id, { received_at: new Date().toISOString(), amount: v.amount, account_id: acc?.id || null });
      toast('已標記收到' + (acc ? `，存入 ${acc.name}` : ''));
    },
  });
}
function formLiab(L, preset = {}) {
  openForm({
    title: L ? '編輯分期／負債' : '新增分期／負債', data: L || { kind: 'installment', ...preset },
    note: '<p class="muted" style="margin-top:-6px;font-size:13px">每到「下次扣款日」，App 會自動把這期金額記到指定信用卡（跟著帳單扣款），或直接從指定帳戶扣除，並減少剩餘金額。</p>',
    fields: [
      { k: 'name', label: '項目', req: 1, ph: '例：線上英文課程' },
      { k: 'kind', label: '類型', type: 'select', options: [['installment', '信用卡分期'], ['loan', '貸款'], ['other', '其他負債']] },
      { k: 'monthly', label: '每期金額', type: 'number', hint: '留空 = 不自動入帳，只記錄剩餘金額' },
      { k: 'periods_total', label: '總期數', type: 'number', ph: '例：12' },
      { k: 'periods_left', label: '剩餘期數', type: 'number', ph: '例：9' },
      { k: 'balance', label: '剩餘未繳金額', type: 'number', hint: '留空會用「每期金額 × 剩餘期數」計算' },
      { k: 'next_date', label: '下次扣款日', type: 'date', hint: '之後每個月同一天自動入帳' },
      { k: 'card_id', label: '掛在哪張信用卡', type: 'select', options: [['', '（不是信用卡分期）'], ...S.cards.map(c => [c.id, c.name])] },
      { k: 'account_id', label: '或從哪個帳戶扣（非信用卡時）', type: 'select', options: [['', '（不自動扣）'], ...S.accounts.map(a => [a.id, a.name])] },
      { k: 'note', label: '備註' },
    ],
    onSave: async v => {
      const row = { ...v, card_id: v.card_id || null, account_id: v.card_id ? null : (v.account_id || null), next_date: v.next_date || null,
        periods_total: v.periods_total ? Math.round(v.periods_total) : null, periods_left: v.periods_left != null ? Math.round(v.periods_left) : (v.periods_total ? Math.round(v.periods_total) : null) };
      if (row.balance == null) row.balance = num(v.monthly) * (row.periods_left || 0);
      if (L) await upd('liabilities', L.id, row); else await add('liabilities', row);
      await runInstallments();
    },
    onDelete: L && (() => del('liabilities', L.id)),
  });
}
function allocationPanel(t) {
  const parts = [['流動資金', t.bank, 'var(--c-bank)'], ['台股', t.stock, 'var(--c-stock)'], ['加密貨幣', t.crypto, 'var(--c-crypto)'], ['應收款', t.recv, 'var(--c-recv)']].filter(p => p[1] > 0);
  const assets = sum(parts, p => p[1]);
  if (assets <= 0) return '';
  const debts = t.debt + t.liab;
  const ratio = debts / assets * 100;
  return `<h2>資產分配</h2><section class="panel">
    <div class="alloc">${parts.map(([n, v, c]) => `<div style="flex:${v};--c:${c}"><b>${Math.round(v / assets * 100)}%</b><span>${n}</span></div>`).join('')}</div>
    <div class="debt-line"><span>負債比</span><div class="meter"><i style="width:${Math.min(100, ratio).toFixed(1)}%;background:var(--c-debt)"></i></div><b class="${ratio > 50 ? 'neg' : ''}">${ratio.toFixed(1)}%</b></div>
    <div class="meta">負債 ${money(debts)}（未扣卡費 ${money(t.debt)}${t.liab ? `、分期／貸款 ${money(t.liab)}` : ''}）÷ 資產 ${money(assets)}</div>
  </section>`;
}

/* ---------------- themes ---------------- */
const THEMES = [
  ['champagne', '奶油白・香檳金', ['#fcfaf5', '#d29b3c', '#2c2a35']],
  ['mist', '米白・霧藍', ['#f8f7f3', '#4f7fd6', '#e0a63e']],
  ['oat', '燕麥奶茶', ['#f4ece1', '#c97a3d', '#3a2b21']],
  ['forest', '米白・墨綠金', ['#f8f6ef', '#1f7a5a', '#d4a13e']],
];
function applyTheme(t) {
  const th = THEMES.find(x => x[0] === t) || THEMES[0];
  document.documentElement.dataset.theme = th[0];
  try { localStorage.setItem('ac_theme', th[0]); } catch (_) { }
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', th[2][0]);
}

/* ---------------- views ---------------- */
const VIEWS = {};

function txnRow(t) {
  const c = S.cards.find(x => x.id === t.card_id);
  const foreign = t.currency && t.currency !== 'TWD';
  return `<div class="row click" data-act="edit-txn" data-id="${t.id}">
    <div class="grow"><div class="title">${esc(t.merchant || '（未填商家）')}</div>
      <div class="meta">${new Date(t.txn_at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${c ? esc(c.name) : `<span class="warn">${esc(t.card_label || '未對應卡片')}</span>`}
      ${t.source === 'shortcut' ? ' · <span class="chip">捷徑</span>' : ''}${t.settled_cycle ? ' · <span class="chip">已扣款</span>' : ''}</div></div>
    <div class="right"><div class="num">${money(billAmt(t))}</div>${foreign ? `<div class="meta num">${money(num(t.amount), t.currency)}</div>` : ''}${num(t.fee) ? `<div class="meta">含手續費 ${money(num(t.fee))}</div>` : ''}${rewOf(t.id) > 0.05 ? `<div class="meta rew">回饋 ${money(rewOf(t.id), 'TWD', rewOf(t.id) < 10 ? 1 : 0)}</div>` : ''}</div></div>`;
}

VIEWS.bank = () => {
  const rows = S.accounts.map(a => {
    const twd = toTWD(num(a.balance), a.currency);
    return `<div class="row click" data-act="edit-acc" data-id="${a.id}">
      <div class="grow"><div class="title">${esc(a.name)}</div><div class="meta">${esc(a.bank || '')} ${a.currency !== 'TWD' ? `<span class="chip">${esc(a.currency)}</span>` : ''}</div></div>
      <div class="right"><div class="num">${money(num(a.balance), a.currency)}</div>${a.currency !== 'TWD' ? `<div class="meta num">≈ ${money(twd)}</div>` : ''}
      <button class="btn small" data-act="adjust-acc" data-id="${a.id}" style="margin-top:6px">調整</button></div></div>`;
  }).join('');
  const logs = S.balance_log.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 15).map(l => {
    const a = S.accounts.find(x => x.id === l.account_id);
    return `<div class="row"><div class="grow"><div class="title">${esc(l.note || '餘額調整')}</div><div class="meta">${new Date(l.created_at).toLocaleDateString('zh-TW')} · ${esc(a?.name || '')}</div></div>
      <div class="right num ${num(l.delta) < 0 ? 'neg' : 'pos'}">${num(l.delta) > 0 ? '+' : ''}${money(num(l.delta), a?.currency)}</div></div>`;
  }).join('');
  return `${S.missingTables.length ? `<div class="banner warn">應收款／負債的資料表還沒建立：請到 Supabase 的 SQL Editor 執行 README 裡「應收款與負債」那段 SQL。</div>` : ''}
    <h2>銀行帳戶 <button class="btn small" data-act="transfer">⇄ 轉帳</button><button class="btn small" data-act="add-acc">＋ 新增帳戶</button></h2>
    <section class="panel">${rows || '<div class="empty">新增你的第一個帳戶（台幣、外幣帳戶都可以）</div>'}</section>
    ${recvSection()}
    ${liabSection()}
    <h2>異動紀錄</h2><section class="panel">${logs || '<div class="empty">信用卡自動扣款、手動調整都會記在這裡</div>'}</section>`;
};

VIEWS.stocks = () => {
  const rows = stockRows();
  const total = sum(rows, r => r.value), cost = sum(rows, r => r.costTotal);
  const pl = sum(rows.filter(r => r.pl != null), r => r.pl);
  const body = rows.map(r => `<tr class="click" data-act="open-stock" data-code="${esc(r.code)}">
      <td><b>${esc(r.code)}</b> <span class="muted">${esc(r.name)}</span><div class="faint" style="font-size:11.5px">${qtyFmt(r.shares)} 股・均價 ${r.avg_cost ? (Math.round(r.avg_cost * 100) / 100).toLocaleString('zh-TW') : '—'}${r.lots.length > 1 ? `・${r.lots.length} 筆` : ''}</div></td>
      <td>${r.price != null ? r.price.toLocaleString('zh-TW') : '<span class="faint">—</span>'}<div class="${r.day > 0 ? 'pos' : r.day < 0 ? 'neg' : 'faint'}" style="font-size:11.5px">${r.day != null ? pctFmt(r.day) : ''}</div></td>
      <td>${money(r.value)}</td>
      <td class="${r.pl > 0 ? 'pos' : r.pl < 0 ? 'neg' : ''}">${r.pl != null ? money(r.pl) : '—'}<div style="font-size:11.5px">${r.plPct != null ? pctFmt(r.plPct) : ''}</div></td>
    </tr>`).join('');
  return `<h2>台股 <button class="btn small" data-act="add-stock">＋ 記一筆買進</button></h2>
    ${!CLOUD ? '<div class="banner warn">本機試用模式抓不到台股報價（需要 Supabase 的 tw-quote 函式），目前用成本價計算。</div>' : ''}
    <section class="panel hero" style="padding:16px 18px">
      <div class="label">台股市值</div><div class="big" style="font-size:28px">${money(total)}</div>
      <div class="sub"><span>成本 <b class="num">${money(cost)}</b></span><span>未實現損益 <b class="num ${pl >= 0 ? 'pos' : 'neg'}">${money(pl)}</b></span></div>
    </section>
    <section class="panel scroll-x" style="margin-top:10px">${rows.length ? `<table class="t"><thead><tr><th>股票</th><th>現價</th><th>市值</th><th>損益</th></tr></thead><tbody>${body}</tbody></table>` : '<div class="empty">每次買進記一筆，同一檔股票會自動合併計算股數與均價</div>'}</section>
    <p class="faint" style="font-size:12px">盤中為證交所即時資訊（約延遲數秒到 20 秒），抓不到時改用最近收盤價。</p>`;
};

VIEWS.crypto = () => {
  const rows = cryptoRows();
  const total = sum(rows, r => r.value || 0);
  const assetRows = rows.map(r => `<div class="row">
      <div class="grow"><div class="title">${esc(r.symbol)} <span class="muted num" style="font-weight:400">${qtyFmt(r.qty)}</span></div><div class="meta">${esc(r.where.join('、'))}</div></div>
      <div class="right"><div class="num">${r.value != null ? money(r.value) : '<span class="faint">無報價</span>'}</div><div class="meta num ${r.chg > 0 ? 'pos' : r.chg < 0 ? 'neg' : ''}">${r.chg != null ? '24h ' + pctFmt(r.chg) : ''}</div></div></div>`).join('');
  const hold = S.crypto_holdings.slice().sort((a, b) => (a.venue || '').localeCompare(b.venue || '')).map(h => `<div class="row click" data-act="edit-hold" data-id="${h.id}">
      <div class="grow"><div class="title">${esc(h.symbol.toUpperCase())}</div><div class="meta">${esc(h.venue || '')}${h.cg_id ? '' : ' · <span class="warn">找不到報價代號</span>'}</div></div>
      <div class="right num">${qtyFmt(num(h.qty))}</div></div>`).join('');
  const wal = S.wallets.map(w => {
    const b = S.walletBal[w.id];
    const v = sum(b?.items || [], i => (S.prices[i.cg]?.twd || 0) * i.qty);
    return `<div class="row click" data-act="edit-wallet" data-id="${w.id}">
      <div class="grow"><div class="title">${esc(w.label || '錢包')} <span class="chip">${w.chain === 'btc' ? 'Bitcoin' : 'EVM 多鏈'}</span></div>
        <div class="meta mono">${esc(w.address.slice(0, 8))}…${esc(w.address.slice(-6))}${b ? ' · ' + (b.err ? '<span class="warn">讀取失敗</span>' : (b.items.map(i => `${esc(i.symbol)}@${esc(i.chain)}`).join('、') || '無餘額')) : ' · 讀取中'}</div></div>
      <div class="right num">${money(v)}</div></div>`;
  }).join('');
  return `<section class="panel hero" style="padding:16px 18px">
      <div class="label">加密貨幣總值</div><div class="big" style="font-size:28px">${money(total)}</div>
      <div class="sub"><span>報價：CoinGecko（新台幣）</span></div></section>
    <h2>依幣種</h2><section class="panel">${assetRows || '<div class="empty">新增交易所持倉或錢包地址</div>'}</section>
    <h2>交易所／手動持倉 <button class="btn small" data-act="add-hold">＋ 新增</button></h2>
    <section class="panel">${hold || '<div class="empty">Binance、BitoPro、MAX 等交易所的持倉數量填在這裡</div>'}</section>
    <h2>鏈上錢包 <button class="btn small" data-act="add-wallet">＋ 新增地址</button></h2>
    <section class="panel">${wal || '<div class="empty">貼上 MetaMask／Binance Wallet 的公開地址，自動讀 ETH、BNB、Arbitrum、Base、Polygon 的原生幣與 USDT／USDC</div>'}</section>
    <p class="faint" style="font-size:12px">只需要公開地址（0x… 或 bc1…），永遠不要在任何網頁輸入助記詞或私鑰。</p>`;
};

/* ---- 羅盤：本月刻度盤 ---- */
const DEG = Math.PI / 180;
const polar = (r, a) => [r * Math.cos(a * DEG), r * Math.sin(a * DEG)];
const f1 = n => n.toFixed(1);
function arcPath(r, a0, a1) {
  const [x0, y0] = polar(r, a0), [x1, y1] = polar(r, a1);
  return `M${f1(x0)} ${f1(y0)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${f1(x1)} ${f1(y1)}`;
}
const STAR = 'M0 -7 L1.8 -1.8 L7 0 L1.8 1.8 L0 7 L-1.8 1.8 L-7 0 L-1.8 -1.8Z';
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function compassSVG(t) {
  const now = new Date();
  const N = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayAng = d => (d - 1) / N * 360 - 90;
  const todayAng = dayAng(now.getDate() + (now.getHours() * 60 + now.getMinutes()) / 1440);
  let ticks = '', labels = '';
  for (let d = 1; d <= N; d++) {
    const a = dayAng(d), major = d === 1 || d % 5 === 0;
    const [x0, y0] = polar(major ? 138 : 143, a), [x1, y1] = polar(149, a);
    ticks += `<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" class="tk${major ? ' major' : ''}"/>`;
    if (major) { const [lx, ly] = polar(126, a); labels += `<text x="${f1(lx)}" y="${f1(ly)}" class="dial-num">${d}</text>`; }
  }
  const perDay = {};
  const stars = S.cards.map(c => {
    const d = Math.min(+(c.due_day || c.closing_day), N), k = perDay[d] = (perDay[d] || 0) + 1;
    const [x, y] = polar(158 + (k - 1) * 13, dayAng(d));
    return `<path transform="translate(${f1(x)} ${f1(y)})" d="${STAR}" fill="${esc(c.color || '#b8893a')}" class="card-star"><title>${esc(c.name)}：每月 ${d} 日扣款</title></path>`;
  }).join('');
  const closeDays = [...new Set(S.cards.filter(c => !sameDayDebit(c)).map(c => Math.min(+c.closing_day, N)))];
  const closes = closeDays.map(d => { const [x, y] = polar(158, dayAng(d)); return `<circle cx="${f1(x)}" cy="${f1(y)}" r="3.6" class="close-mark"><title>${d} 日結帳</title></circle>`; }).join('');
  const assets = t.bank + t.stock + t.crypto + t.recv;
  let ring = '';
  if (assets > 0) {
    let a = -90; const gap = 2.4;
    for (const [v, cls] of [[t.bank, 'c-bank'], [t.stock, 'c-stock'], [t.crypto, 'c-crypto'], [t.recv, 'c-recv']]) {
      if (v <= 0) continue;
      const sweep = v / assets * 360;
      if (sweep >= 359.9) ring += `<circle r="108" class="seg ${cls}"/>`;
      else if (sweep > gap + .5) ring += `<path d="${arcPath(108, a + gap / 2, a + sweep - gap / 2)}" class="seg ${cls}"/>`;
      a += sweep;
    }
  } else ring = '<circle r="108" class="seg-empty"/>';
  const dSweep = assets > 0 ? Math.min(359, (t.debt + t.liab) / assets * 360) : 0;
  const debt = dSweep > .5 ? `<path d="${arcPath(98, -90, -90 + dSweep)}" class="seg c-debt thin"/>` : '';
  const val = money(t.net);
  const fs = val.length > 13 ? 22 : val.length > 11 ? 26 : 31;
  const na = todayAng + 90;
  const anim = !S.swept && !reduceMotion()
    ? `<animateTransform attributeName="transform" type="rotate" from="${f1(na - 150)}" to="${f1(na)}" dur="1.6s" calcMode="spline" keyTimes="0;1" keySplines=".16 .9 .3 1" fill="freeze"/>` : '';
  S.swept = true;
  return `<svg class="compass" viewBox="-180 -180 360 360" role="img" aria-label="本月羅盤：外圈是日期，星號是信用卡扣款日，空心圓是結帳日，指針是今天">
    <circle r="170" class="halo"/><circle r="150" class="rim"/><circle r="117" class="rim inner"/>
    ${ticks}${labels}${ring}${debt}
    <g class="needle" transform="rotate(${f1(na)})">${anim}
      <line y1="-84" y2="-62" class="needle-tail"/><path d="M0 -146 L4.5 -100 L0 -86 L-4.5 -100Z" class="needle-head"/></g>
    ${closes}${stars}
    <text y="-34" class="c-label">淨資產</text>
    <text y="${Math.round(fs / 3) + 2}" class="c-value" style="font-size:${fs}px">${esc(val)}</text>
    <text y="40" class="c-sub">${now.getMonth() + 1} 月 ${now.getDate()} 日</text>
  </svg>`;
}

VIEWS.overview = () => {
  const t = totals();
  const snaps = S.snapshots.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-90);
  let spark = '';
  if (snaps.length > 1) {
    const vals = snaps.map(s => num(s.net)); const mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 1;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1) * 300).toFixed(1)},${(30 - (v - mn) / rng * 26).toFixed(1)}`).join(' ');
    const delta = vals.at(-1) - vals[0];
    spark = `<div class="trend"><svg viewBox="0 0 300 32" preserveAspectRatio="none"><polyline points="${pts}"/></svg>
      <span>${snaps.length} 天來 <b class="${delta >= 0 ? 'pos' : 'neg'}">${delta >= 0 ? '+' : ''}${money(delta)}</b></span></div>`;
  }
  const proj = {}; S.accounts.forEach(a => proj[a.id] = num(a.balance));
  const upcoming = S.cards.map(c => ({ c, st: cardState(c) })).sort((a, b) => a.st.next.date - b.st.next.date);
  const upRows = upcoming.map(({ c, st }) => {
    const acc = S.accounts.find(a => a.id === c.debit_account_id);
    const n = st.next;
    let after = null;
    if (acc) { proj[acc.id] -= fromTWD(n.amount, acc.currency); after = proj[acc.id]; }
    const when = n.days === 0 ? '<span class="warn">今天扣款</span>' : `${n.days} 天後扣款`;
    const status = n.final ? '帳單已出' : `累計中，${n.closeDays === 0 ? '今天' : n.closeDays + ' 天後'}結帳`;
    return `<div class="row click" data-act="open-card" data-id="${c.id}">
      <div class="date-glyph" style="--cc:${esc(c.color || '#b8893a')}"><b>${n.date.getDate()}</b><small>${n.date.getMonth() + 1} 月</small></div>
      <div class="grow"><div class="title">${esc(c.name)}</div>
        <div class="meta one">${when}・${status}</div></div>
      <div class="right"><div class="amt${n.final ? '' : ' soft'}">${money(n.amount)}</div>
        ${acc ? `<div class="meta ${after < 0 ? 'neg' : ''}">扣後剩 ${money(after, acc.currency)}</div>` : '<div class="meta warn">未設扣款帳戶</div>'}</div></div>`;
  }).join('');
  const recent = S.transactions.slice().sort((a, b) => b.txn_at.localeCompare(a.txn_at)).slice(0, 5);
  const leg = (cls, name, v) => `<div><i class="${cls}"></i><span>${name}</span><b>${money(v)}</b></div>`;
  return `
  <section class="dial">${compassSVG(t)}
    <div class="dial-legend">${leg('c-bank', '銀行', t.bank)}${leg('c-stock', '台股', t.stock)}${leg('c-crypto', '加密貨幣', t.crypto)}${t.recv ? leg('c-recv', '應收款', t.recv) : ''}${leg('c-debt', '未扣卡費', -t.debt)}${t.liab ? leg('c-liab', '分期／負債', -t.liab) : ''}</div>
    ${spark}
  </section>
  ${S.cards.some(c => (c.rewards || []).length) ? `<button class="rew-strip" data-act="recommend"><span>本期預估回饋</span><b>${money(sum(S.cards, c => cycleReward(c, cardState(c).open.end).total))}</b><small>刷哪張最划算 ›</small></button>` : ''}
  ${allocationPanel(t)}
  <h2>接下來的扣款</h2>
  <section class="panel">${upRows || ((CFG.presetCards || []).length ? `<button class="empty-cta" data-act="preset-cards">加入我的 ${CFG.presetCards.length} 張信用卡</button>` : '<button class="empty-cta" data-act="add-card">新增第一張信用卡，扣款日會出現在羅盤外圈</button>')}</section>
  <h2>最近刷卡</h2>
  <section class="panel">${recent.map(txnRow).join('') || '<button class="empty-cta" data-act="add-txn">記下第一筆刷卡</button>'}</section>`;
};

/* ---- 信用卡：卡面輪播 ---- */
function seedRand(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}
function constellation(id) {
  const r = seedRand(id);
  const pts = Array.from({ length: 6 }, (_, i) => [135 + i * 28 + r() * 16, 70 + r() * 80]);
  const line = pts.map(p => p.map(f1).join(',')).join(' ');
  const dots = pts.map(([x, y], i) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${i % 3 === 0 ? 2.4 : 1.5}"/>`).join('');
  return `<svg class="cc-sky" viewBox="0 0 320 200" aria-hidden="true"><polyline points="${line}"/>${dots}</svg>`;
}
function cardFace(c, i) {
  const st = cardState(c), n = st.next;
  return `<div class="cc" style="--cc:${esc(c.color || '#c9a96e')}">
    ${constellation(c.id)}
    <span class="cc-top"><span class="cc-name">${esc(c.name)}</span><svg class="cc-chip" viewBox="0 0 34 26" aria-hidden="true"><rect x=".5" y=".5" width="33" height="25" rx="5"/><path d="M0 9h11M0 17h11M23 9h11M23 17h11M11 0v26M23 0v26"/></svg></span>
    <span class="cc-mid"><small>${n.final ? `${md(st.billed.end)} 帳單・${md(ymd(n.date))} 扣款` : '本期累計'}</small><b>${money(n.final ? st.billed.total : st.open.total)}</b>${(c.rewards || []).length ? `<em class="cc-rew">本期回饋約 ${money(cycleReward(c, st.open.end).total)}</em>` : ''}</span>
    <span class="cc-bot"><span>${sameDayDebit(c) ? `每月 ${c.closing_day} 日結帳並扣款` : `${c.closing_day} 日結帳・${c.due_day} 日扣款`}</span><span class="${n.days === 0 ? 'warn' : ''}">${n.days === 0 ? '今天扣款' : n.days + ' 天後扣款'}</span></span>
  </div>`;
}
function cardDetail(c) {
  if (!c) return '';
  const st = cardState(c), cy = st.open, bl = st.billed;
  const acc = S.accounts.find(a => a.id === c.debit_account_id);
  const debt = sum(unsettled(c.id), billAmt);
  const lim = num(c.credit_limit);
  const hist = S.settlements.filter(s => s.card_id === c.id).sort((a, b) => String(b.cycle_end).localeCompare(String(a.cycle_end))).slice(0, 4);
  return `<section class="panel">
    <div class="cycle">
      <div><small>本期區間</small><b>${md(cy.start)}–${md(cy.end)}</b></div>
      <div><small>扣款帳戶</small><b class="small">${acc ? esc(acc.name) : '<span class="warn">未設定</span>'}</b></div>
    </div>
    ${bl ? `<div class="bill"><div><small>${md(bl.end)} 已出帳單</small><b>${money(bl.total)}</b></div><div class="r"><small>自動扣款</small><b>${md(ymd(bl.due))}</b></div></div>
      <button class="btn small paid-btn" data-act="paid-bill" data-id="${c.id}">這期已經繳了</button>` : ''}
    <div class="meta" style="margin-top:10px">本期累計 ${money(cy.total)}，${md(cy.end)} 結帳後於 ${md(ymd(cy.due))} 扣款</div>
    ${lim ? `<div class="meta" style="margin-top:12px">額度已用 ${money(debt)}，上限 ${money(lim)}</div><div class="meter"><i style="width:${Math.min(100, debt / lim * 100).toFixed(1)}%${debt / lim > .8 ? ';background:var(--danger)' : ''}"></i></div>` : ''}
    <div class="actions"><button class="btn primary" data-act="add-txn" data-card="${c.id}">記一筆消費</button><button class="btn" data-act="edit-card" data-id="${c.id}">卡片設定</button></div>
  </section>
  ${rewardPanel(c, st)}
  ${bl ? `<h2>${md(bl.end)} 帳單明細</h2><section class="panel">${bl.items.map(txnRow).join('')}</section>` : ''}
  <h2>本期消費</h2>
  <section class="panel">${cy.items.map(txnRow).join('') || '<div class="empty">本期還沒有消費</div>'}</section>
  ${hist.length ? `<h2>扣款紀錄</h2><section class="panel">${hist.map(h => `<div class="row"><div class="grow"><div class="title">${md(ymd(dueFor(c, String(h.cycle_end).slice(0, 10))))} 扣款</div><div class="meta">${md(h.cycle_end)} 帳單</div></div><div class="right amt">${money(num(h.amount))}</div></div>`).join('')}</section>` : ''}`;
}
function cardTile(c) {
  const st = cardState(c), n = st.next;
  const start = parseYmd(st.open.start), end = parseYmd(st.open.end);
  const prog = Math.min(100, Math.max(0, (todayDate() - start) / (end - start + 864e5) * 100));
  const rew = (c.rewards || []).length ? cycleReward(c, st.open.end).total : 0;
  return `<button class="ctile" style="--cc:${esc(c.color || '#b8893a')}" data-act="open-card" data-id="${c.id}">
    <span class="ct-edge"></span>
    <span class="ct-main">
      <span class="ct-name">${esc(c.name)}</span>
      <span class="ct-sub">${n.final ? `${md(st.billed.end)} 帳單已出` : `本期累計中・${n.closeDays === 0 ? '今天' : n.closeDays + ' 天後'}結帳`}${rew ? `・回饋約 ${money(rew)}` : ''}</span>
      <span class="ct-bar"><i style="width:${prog.toFixed(1)}%"></i></span>
    </span>
    <span class="ct-right">
      <b>${money(n.amount)}</b>
      <span class="${n.days <= 3 ? 'warn' : ''}">${n.days === 0 ? '今天扣款' : `${md(ymd(n.date))} 扣款`}</span>
    </span>
  </button>`;
}
VIEWS.cards = () => {
  const orphan = S.transactions.filter(t => !t.card_id && !t.settled_cycle);
  const banner = orphan.length ? `<div class="banner warn">有 ${orphan.length} 筆紀錄對不到卡片。點開指定卡片，再到卡片設定補上「Apple 錢包裡的卡片名稱」。</div><section class="panel" style="margin-bottom:14px">${orphan.map(txnRow).join('')}</section>` : '';
  if (!S.cards.length) {
    const preset = (CFG.presetCards || []).length;
    return `${banner}<button class="cc cc-add" style="width:100%" data-act="${preset ? 'preset-cards' : 'add-card'}"><span class="plus">✦</span>${preset ? `加入我的 ${CFG.presetCards.length} 張信用卡` : '新增信用卡'}<small>${preset ? CFG.presetCards.map(p => esc(p.name)).join('、') : '設定結帳日、扣款日與扣款帳戶'}</small></button>`;
  }
  const open = S.cards.find(c => c.id === S.cardOpen);
  if (open) {
    const i = S.cards.indexOf(open);
    return `<div class="cd-nav"><button class="btn small ghost" data-act="cards-home">← 所有卡片</button>
        <span>${S.cards.length > 1 ? `<button class="icon-btn" data-act="card-step" data-d="-1" aria-label="上一張">‹</button><button class="icon-btn" data-act="card-step" data-d="1" aria-label="下一張">›</button>` : ''}</span></div>
      <div class="cd-face">${cardFace(open, i)}</div>
      ${cardDetail(open)}`;
  }
  const states = S.cards.map(c => ({ c, st: cardState(c) })).sort((a, b) => a.st.next.date - b.st.next.date);
  const due30 = states.filter(x => x.st.next.days <= 31);
  const next = states[0];
  return `${banner}
    <section class="due-sum">
      <div><small>接下來要繳</small><b>${money(sum(due30, x => x.st.next.amount))}</b></div>
      <div class="r"><small>最近一筆</small><b>${md(ymd(next.st.next.date))}</b><span>${esc(next.c.name)}</span></div>
    </section>
    <div class="ctiles">${states.map(x => cardTile(x.c)).join('')}</div>
    <div class="actions" style="margin-top:12px"><button class="btn" data-act="recommend">這筆刷哪張最划算？</button><button class="btn" data-act="import-txn">匯入帳單明細</button><button class="btn ghost" data-act="add-card">＋ 新增信用卡</button></div>`;
};

/* ---- 投資：台股＋加密 ---- */
VIEWS.invest = () => {
  const sub = S.invSub === 'crypto' ? 'crypto' : 'stocks';
  return `<div class="seg-ctl" role="tablist">
      <button role="tab" data-act="inv" data-sub="stocks" class="${sub === 'stocks' ? 'on' : ''}">台股</button>
      <button role="tab" data-act="inv" data-sub="crypto" class="${sub === 'crypto' ? 'on' : ''}">加密貨幣</button></div>
    ${VIEWS[sub]()}`;
};

/* ---- 快速記帳 ---- */
function openFab() {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><h3>要記什麼？</h3><div class="fab-grid">
    <button data-act="recommend" class="wide"><b>這筆刷哪張？</b><small>依各卡回饋與剩餘上限，算出最划算的卡</small></button>
    <button data-act="import-txn" class="wide"><b>匯入帳單明細</b><small>選 Claude 整理好的 CSV 檔，一次建好多筆刷卡紀錄</small></button>
    <button data-act="add-txn"><b>刷卡消費</b><small>實體卡、網購等捷徑抓不到的</small></button>
    <button data-act="fab-acc"><b>帳戶存提</b><small>薪水入帳、支出、對帳</small></button>
    <button data-act="transfer"><b>帳戶轉帳</b><small>帳戶之間互轉、換匯</small></button>
    <button data-act="add-stock"><b>台股買進</b><small>每次買進記一筆，自動合併均價</small></button>
    <button data-act="add-hold"><b>加密持倉</b><small>交易所的幣種數量</small></button>
    <button data-act="add-recv"><b>應收款</b><small>別人欠你、待入帳的錢</small></button>
    <button data-act="add-liab"><b>分期／負債</b><small>信用卡分期、貸款，每月自動入帳</small></button>
  </div></div>`;
  m.hidden = false;
  m.onclick = e => { if (e.target === m) { m.hidden = true; m.innerHTML = ''; } };
}

VIEWS.settings = () => {
  const ingestUrl = CLOUD ? `${CFG.supabaseUrl}/functions/v1/shortcut-ingest` : '';
  const appUrl = location.href.split('#')[0];
  const cur = document.documentElement.dataset.theme || 'champagne';
  const themes = THEMES.map(([k, name, c]) => `<button data-act="theme" data-theme="${k}" class="${k === cur ? 'on' : ''}" aria-pressed="${k === cur}">
      <span class="sw">${c.map(x => `<i style="background:${x}"></i>`).join('')}</span><span>${name}</span></button>`).join('');
  return `<h2>主題設定</h2><section class="panel">${themeTiles()}</section>
  ${(CFG.presetCards || []).some(p => !S.cards.some(c => c.name === p.name)) ? `<h2>預設信用卡</h2><section class="panel"><p class="meta" style="margin-top:0">還有 ${CFG.presetCards.filter(p => !S.cards.some(c => c.name === p.name)).map(p => esc(p.name)).join('、')} 沒有建立</p><button class="btn small primary" data-act="preset-cards">補建這些卡片</button></section>` : ''}
  <h2>帳號與模式</h2>
  <section class="panel">
    ${CLOUD ? `<div class="row"><div class="grow"><div class="title">雲端同步</div><div class="meta">${esc(user?.email || '')}</div></div><button class="btn small" data-act="signout">登出</button></div>`
      : `<div class="banner warn">目前是本機試用模式：資料只存在這個瀏覽器。照 README 設定 Supabase 後即可手機電腦同步、讓捷徑直接寫入。</div>
         <div class="actions"><button class="btn small" data-act="seed">載入範例資料</button></div>`}
  </section>
  <h2>iOS 捷徑：刷卡自動記帳</h2>
  <section class="panel">
    ${CLOUD ? `<p class="muted" style="margin-top:0;font-size:13.5px">捷徑會把 Apple Pay 交易送到這個網址（完整步驟見 README）：</p>
      <code class="codebox">${esc(ingestUrl)}</code>
      <p class="muted" style="font-size:13.5px">標頭 <code>x-ingest-token</code> 的值：</p>
      <code class="codebox" id="tokenBox">${esc(S.token || '尚未產生')}</code>
      <div class="actions"><button class="btn small primary" data-act="gen-token">${S.token ? '重新產生金鑰' : '產生金鑰'}</button>${S.token ? '<button class="btn small" data-act="copy-token">複製金鑰</button>' : ''}</div>
      <p class="faint" style="font-size:12px">重新產生後，舊金鑰立刻失效，捷徑要換成新的。</p>`
      : `<p class="muted" style="margin-top:0;font-size:13.5px">本機模式可用「打開網址」方式：捷徑打開下面網址，App 會自動帶入金額並跳出確認視窗。</p>
      <code class="codebox">${esc(appUrl)}#add?amount=金額&merchant=商家&card=卡片</code>`}
  </section>
  <h2>匯入</h2>
  <section class="panel"><p class="meta" style="margin-top:0">把信用卡帳單截圖給 Claude 整理成 CSV，再從這裡一次匯入。重複的紀錄會自動略過。</p>
    <button class="btn small primary" data-act="import-txn">匯入刷卡紀錄</button></section>
  <h2>備份</h2>
  <section class="panel">
    <div class="actions" style="margin-top:0"><button class="btn small" data-act="export">匯出 JSON 備份</button>
    ${!CLOUD ? '<label class="btn small" style="margin:0;color:var(--text)">匯入備份<input type="file" accept="application/json" data-act="import" hidden></label>' : ''}</div>
  </section>
  <p class="faint" style="font-size:12px;text-align:center;margin-top:24px">版本 ${APP_VERSION}<br>匯率：open.er-api.com · 台股：證交所／櫃買中心 · 加密：CoinGecko、publicnode、mempool.space</p>`;
};

const EYE_OPEN = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_SHUT = '<svg viewBox="0 0 24 24"><path d="M3 4l18 16M9.9 5.8A10 10 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.2 3.9M6.3 7.3A17 17 0 0 0 2 12s3.6 6.5 10 6.5a9.6 9.6 0 0 0 4-.9"/></svg>';
function render() {
  if (!VIEWS[S.tab]) S.tab = 'overview';
  allRewards();
  setTimeout(() => { if (S.tab === 'cards') applyCardFold(); }, 0);
  $('#view').innerHTML = VIEWS[S.tab]();
  document.querySelectorAll('.tabs [data-tab]').forEach(b => { const on = b.dataset.tab === S.tab; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
  const eye = $('[data-act="toggle-hide"]'); eye.innerHTML = S.hide ? EYE_SHUT : EYE_OPEN; eye.setAttribute('aria-pressed', S.hide);
}
function go(tab) { S.tab = tab; localStorage.setItem('ac_tab', tab); render(); scrollTo(0, 0); }

/* ---------------- forms ---------------- */
function openForm({ title, fields, data = {}, onSave, onDelete, note = '' }) {
  const m = $('#modal');
  const fieldHtml = f => {
    const v = data[f.k] ?? f.def ?? '';
    const req = f.req ? 'required' : '';
    let input;
    if (f.type === 'select') input = `<select name="${f.k}" ${req}>${f.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
    else if (f.type === 'check') return `<label class="check"><input type="checkbox" name="${f.k}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
    else input = `<input name="${f.k}" type="${f.type || 'text'}" value="${esc(v)}" ${f.type === 'number' ? 'step="any" inputmode="decimal"' : ''} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''} ${req}>`;
    return `<label>${esc(f.label)}${input}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</label>`;
  };
  m.innerHTML = `<form class="sheet"><h3>${esc(title)}</h3>${note}${fields.map(fieldHtml).join('')}
    <div class="actions">${onDelete ? '<button type="button" class="btn danger" data-f="del">刪除</button>' : ''}
    <button type="button" class="btn ghost" data-f="cancel">取消</button><button class="btn primary" type="submit">儲存</button></div></form>`;
  m.hidden = false;
  const form = $('form', m);
  const close = () => { m.hidden = true; m.innerHTML = ''; };
  m.onclick = e => { if (e.target === m) close(); };
  $('[data-f="cancel"]', m).onclick = close;
  if (onDelete) $('[data-f="del"]', m).onclick = async () => { if (confirm('確定刪除？')) { try { await onDelete(); close(); render(); } catch (err) { toast('刪除失敗：' + err.message); } } };
  form.onsubmit = async e => {
    e.preventDefault();
    const out = {};
    for (const f of fields) {
      const el = form.elements[f.k];
      out[f.k] = f.type === 'check' ? el.checked : f.type === 'number' ? (el.value === '' ? null : parseFloat(el.value)) : el.value.trim();
    }
    const btn = $('button[type=submit]', form); btn.disabled = true;
    try { await onSave(out); close(); render(); }
    catch (err) { btn.disabled = false; toast('儲存失敗：' + (err.message || err)); }
  };
  setTimeout(() => form.querySelector('input:not([type=checkbox]),select')?.focus(), 50);
}

const CURRENCIES = ['TWD', 'USD', 'JPY', 'EUR', 'CNY', 'HKD', 'KRW', 'GBP', 'AUD'].map(c => [c, c]);
const accOptions = () => [['', '（不自動扣款）'], ...S.accounts.map(a => [a.id, `${a.name}${a.currency !== 'TWD' ? ' · ' + a.currency : ''}`])];
const cardOptions = () => [['', '（未指定卡片）'], ...S.cards.map(c => [c.id, c.name])];
const localDT = d => { const x = new Date(d); return `${ymd(x)}T${pad(x.getHours())}:${pad(x.getMinutes())}`; };

function formAccount(a) {
  openForm({
    title: a ? '編輯帳戶' : '新增銀行帳戶', data: a || {},
    fields: [
      { k: 'name', label: '帳戶名稱', req: 1, ph: '例：永豐大戶 台幣' },
      { k: 'bank', label: '銀行', ph: '例：永豐銀行' },
      { k: 'currency', label: '幣別', type: 'select', options: CURRENCIES, def: 'TWD' },
      ...(a ? [] : [{ k: 'balance', label: '目前餘額', type: 'number', def: 0 }]),
      { k: 'note', label: '備註' },
    ],
    onSave: async v => { if (a) await upd('accounts', a.id, v); else await add('accounts', { ...v, balance: v.balance || 0 }); },
    onDelete: a && (async () => {
      if (S.cards.some(c => c.debit_account_id === a.id)) throw new Error('有信用卡用這個帳戶扣款，請先改掉卡片設定');
      await del('accounts', a.id);
    }),
  });
}
function formAdjust(a0) {
  openForm({
    title: a0 ? `調整：${a0.name}` : '帳戶存提／對帳', note: a0 ? `<p class="muted" style="margin-top:-6px">目前 ${money(num(a0.balance), a0.currency)}</p>` : '',
    fields: [
      ...(a0 ? [] : [{ k: 'account_id', label: '帳戶', type: 'select', options: S.accounts.map(x => [x.id, `${x.name}（${money(num(x.balance), x.currency)}）`]) }]),
      { k: 'mode', label: '方式', type: 'select', options: [['set', '對帳：設定為新的餘額'], ['in', '存入 / 收入'], ['out', '提出 / 支出']] },
      { k: 'amount', label: '金額', type: 'number', req: 1 },
      { k: 'note', label: '說明', ph: '例：薪水、房租、對帳' },
    ],
    onSave: async v => {
      const a = a0 || S.accounts.find(x => x.id === v.account_id);
      const cur = num(a.balance);
      const after = v.mode === 'set' ? v.amount : v.mode === 'in' ? cur + v.amount : cur - v.amount;
      const delta = Math.round((after - cur) * 100) / 100;
      await upd('accounts', a.id, { balance: after });
      await add('balance_log', { account_id: a.id, delta, balance_after: after, note: v.note || (v.mode === 'set' ? '對帳調整' : v.mode === 'in' ? '存入' : '支出') });
    },
  });
}
function formCard(c) {
  openForm({
    title: c ? '信用卡設定' : '新增信用卡', data: c || {},
    note: '<p class="muted" style="margin-top:-6px;font-size:13px">扣款日當天開啟 App，會自動把那期帳單從扣款帳戶扣除。</p>',
    fields: [
      { k: 'name', label: '卡片名稱', req: 1, ph: '例：MaiCoin 聯名卡' },
      { k: 'closing_day', label: '每月結帳日（1–31）', type: 'number', req: 1, hint: '小月沒有該日時，以月底計算' },
      { k: 'due_day', label: '每月扣款日（1–31）', type: 'number', hint: '結帳後的下一個這一天扣款；留空 = 結帳日當天扣款' },
      { k: 'debit_account_id', label: '扣款帳戶', type: 'select', options: accOptions() },
      { k: 'wallet_name', label: 'Apple 錢包裡的卡片名稱', ph: '捷徑比對用，照錢包顯示的名字填', hint: '可只填一部分，例如「MaiCoin」' },
      { k: 'credit_limit', label: '信用額度（選填）', type: 'number' },
      { k: 'fx_fee', label: '國外交易手續費率（%）', type: 'number', def: 1.5, hint: '多數台灣信用卡是 1.5%；免手續費的卡填 0' },
      { k: 'cycle_start', label: '改結帳日過渡期：本期從哪天開始（選填）', type: 'date', hint: '有申請改結帳日、這期特別長時才填，例如 9/10' },
      { k: 'first_close', label: '改結帳日後第一次結帳日（選填）', type: 'date', hint: '例如 10/29；這天之前原本的結帳日會略過' },
      { k: 'color', label: '代表色', type: 'select', options: [['#b8893a', '琥珀金'], ['#4f9a92', '青瓷'], ['#5b72c4', '霧藍'], ['#8a63b8', '薰紫'], ['#c0623f', '赭紅'], ['#5d6378', '石墨']] },
    ],
    onSave: async v => {
      v.closing_day = Math.max(1, Math.min(31, Math.round(v.closing_day)));
      v.due_day = v.due_day == null ? null : Math.max(1, Math.min(31, Math.round(v.due_day)));
      v.cycle_start = v.cycle_start || null; v.first_close = v.first_close || null;
      if ((v.cycle_start && !v.first_close) || (!v.cycle_start && v.first_close)) throw new Error('改結帳日的兩個日期要一起填');
      v.debit_account_id = v.debit_account_id || null;
      if (c) {
        if (v.closing_day !== +c.closing_day || v.due_day !== (c.due_day == null ? null : +c.due_day)) v.last_settled = initialSettled(v);
        await upd('cards', c.id, v);
      } else await add('cards', { ...v, rewards: presetRewardsFor(v) || [], last_settled: initialSettled(v) });
    },
    onDelete: c && (async () => { await del('cards', c.id); S.transactions.forEach(t => { if (t.card_id === c.id) t.card_id = null; }); }),
  });
}
function formTxn(t, preset = {}) {
  const d = t || preset;
  openForm({
    title: t ? '編輯消費' : '記一筆刷卡', data: { ...d, overseas: d.fee != null ? num(d.fee) > 0 : (d.currency && d.currency !== 'TWD'), pay: d.pay || (t ? txnPay(t) : d.source === 'shortcut' ? 'applepay' : 'card'), txn_at: localDT(d.txn_at || Date.now()), settled: !!d.settled_cycle },
    fields: [
      { k: 'card_id', label: '信用卡', type: 'select', options: cardOptions() },
      { k: 'merchant', label: '商家／用途' },
      { k: 'amount', label: '金額（原幣，退款填負數）', type: 'number', req: 1 },
      { k: 'currency', label: '幣別', type: 'select', options: CURRENCIES, def: 'TWD' },
      { k: 'pay', label: '支付方式', type: 'select', options: PAY_OPTIONS, def: 'card', hint: '回饋計算會用到，例如 LINE Pay、日本 Apple Pay 加碼' },
      { k: 'amount_twd', label: '台幣入帳金額（外幣可修正為帳單實際金額）', type: 'number', hint: '台幣交易留空即可；外幣留空會依即時匯率換算' },
      { k: 'overseas', label: '海外交易（加收國外交易手續費）', type: 'check', hint: '外幣交易、或台幣計價但商家在國外（例如 Apple.com、Netflix、Agoda）都要勾' },
      { k: 'txn_at', label: '時間（建議用入帳日）', type: 'datetime-local', req: 1 },
      ...(t ? [{ k: 'settled', label: '已扣款（不再計入未來帳單）', type: 'check' }] : []),
    ],
    onSave: async v => {
      const row = { card_id: v.card_id || null, merchant: v.merchant, amount: v.amount, currency: v.currency, pay: v.pay, txn_at: new Date(v.txn_at).toISOString() };
      row.amount_twd = v.currency === 'TWD' ? v.amount : (v.amount_twd ?? Math.round(toTWD(v.amount, v.currency) * 100) / 100);
      if (!Number.isFinite(row.amount_twd)) throw new Error('抓不到匯率，請手動填台幣金額');
      const card = S.cards.find(c => c.id === row.card_id);
      row.fee = v.overseas && !isFeeRow(row) ? Math.round(Math.abs(row.amount_twd) * feeRate(card) / 100) * Math.sign(row.amount_twd || 1) : 0;
      if (t) {
        if (v.settled && !t.settled_cycle) row.settled_cycle = 'manual';
        if (!v.settled) row.settled_cycle = null;
        await upd('transactions', t.id, row);
      } else {
        row.source = preset.source || 'manual'; row.card_label = preset.card_label || card?.name || '';
        if (card?.last_settled && ymd(new Date(row.txn_at)) <= String(card.last_settled).slice(0, 10)) { row.settled_cycle = 'past'; toast('這筆落在已扣款的週期，標記為已扣款，不會重複扣'); }
        await add('transactions', row);
      }
    },
    onDelete: t && (() => del('transactions', t.id)),
  });
}
function formStock(s, preset = {}) {
  const d = s || preset;
  openForm({
    title: s ? '編輯這筆交易' : d.code ? `買進 ${d.code}` : '記一筆台股買進',
    data: { ...d, bought: ymd(new Date(d.created_at || Date.now())) },
    fields: [
      { k: 'code', label: '股票代號', req: 1, ph: '例：2330、0050、00878' },
      { k: 'name', label: '名稱（選填，會自動帶入）' },
      { k: 'shares', label: '股數（1 張 = 1000 股，賣出填負數）', type: 'number', req: 1 },
      { k: 'avg_cost', label: '成交價（每股，可把手續費攤進去）', type: 'number', hint: '賣出那筆可留空，不影響均價' },
      { k: 'bought', label: '交易日期', type: 'date' },
      { k: 'note', label: '備註', ph: '例：定期定額、除權息配股' },
    ],
    onSave: async v => {
      const row = { code: v.code.toUpperCase(), name: v.name, shares: v.shares, avg_cost: v.avg_cost, note: v.note };
      if (v.bought) { const t = parseYmd(v.bought); t.setHours(12); row.created_at = t.toISOString(); }
      if (s) await upd('stocks', s.id, row); else await add('stocks', row);
      await loadQuotes(true);
    },
    onDelete: s && (() => del('stocks', s.id)),
  });
}
function openStock(code) {
  const r = stockRows().find(x => x.code === code); if (!r) return;
  const m = $('#modal');
  const lots = r.lots.map(l => `<div class="row click" data-act="edit-stock" data-id="${l.id}">
      <div class="grow"><div class="title">${num(l.shares) < 0 ? '賣出' : '買進'} ${qtyFmt(Math.abs(num(l.shares)))} 股</div>
        <div class="meta">${new Date(l.created_at).toLocaleDateString('zh-TW')}${l.note ? '・' + esc(l.note) : ''}</div></div>
      <div class="right"><div class="num">${l.avg_cost ? '@ ' + num(l.avg_cost).toLocaleString('zh-TW') : ''}</div>
        <div class="meta num">${l.avg_cost ? money(num(l.shares) * num(l.avg_cost)) : ''}</div></div></div>`).join('');
  m.innerHTML = `<div class="sheet"><h3>${esc(r.code)} ${esc(r.name)}</h3>
    <div class="cycle">
      <div><small>合計股數</small><b>${qtyFmt(r.shares)}</b></div>
      <div><small>加權均價</small><b>${r.avg_cost ? (Math.round(r.avg_cost * 100) / 100).toLocaleString('zh-TW') : '—'}</b></div>
      <div><small>市值</small><b>${money(r.value)}</b></div>
      <div><small>未實現損益</small><b class="${r.pl > 0 ? 'pos' : r.pl < 0 ? 'neg' : ''}">${r.pl != null ? money(r.pl) : '—'}</b></div>
    </div>
    <h2>交易紀錄（${r.lots.length} 筆）</h2>
    <div class="panel">${lots}</div>
    <div class="actions">
      ${r.lots.length > 1 ? `<button class="btn ghost" data-act="merge-stock" data-code="${esc(r.code)}">合併成一筆</button>` : ''}
      <button class="btn primary" data-act="buy-stock" data-code="${esc(r.code)}">＋ 再買一筆</button></div></div>`;
  m.hidden = false;
  m.onclick = e => { if (e.target === m) { m.hidden = true; m.innerHTML = ''; } };
}
async function mergeStock(code) {
  const r = stockRows().find(x => x.code === code); if (!r || r.lots.length < 2) return;
  if (!confirm(`把 ${r.lots.length} 筆交易合併成一筆（${r.shares} 股、均價 ${Math.round(r.avg_cost * 100) / 100}）？合併後就看不到每筆明細了。`)) return;
  const keep = r.lots[0];
  await upd('stocks', keep.id, { shares: r.shares, avg_cost: Math.round(r.avg_cost * 10000) / 10000, note: `合併 ${r.lots.length} 筆`, name: r.name || keep.name });
  for (const l of r.lots.slice(1)) await del('stocks', l.id);
  toast('已合併');
}
function formHolding(h) {
  openForm({
    title: h ? '編輯持倉' : '新增加密貨幣持倉', data: h || {},
    fields: [
      { k: 'symbol', label: '幣種代號', req: 1, ph: '例：BTC、ETH、USDT' },
      { k: 'qty', label: '數量', type: 'number', req: 1 },
      { k: 'venue', label: '放在哪裡', ph: '例：Binance、BitoPro、MAX' },
      { k: 'cg_id', label: 'CoinGecko 代號（選填）', hint: '留空會自動搜尋；同名幣很多時可到 coingecko.com 查 API id' },
    ],
    onSave: async v => {
      v.symbol = v.symbol.toUpperCase();
      if (!v.cg_id) v.cg_id = await findCgId(v.symbol);
      if (!v.cg_id) toast('找不到這個幣的報價代號，可手動填 CoinGecko id');
      if (h) await upd('crypto_holdings', h.id, v); else await add('crypto_holdings', v);
      await loadPrices(true);
    },
    onDelete: h && (() => del('crypto_holdings', h.id)),
  });
}
function formWallet(w) {
  openForm({
    title: w ? '編輯錢包' : '新增錢包地址', data: w || {},
    fields: [
      { k: 'label', label: '名稱', ph: '例：MetaMask 主錢包' },
      { k: 'chain', label: '類型', type: 'select', options: [['evm', 'EVM（MetaMask、Binance Wallet…）'], ['btc', 'Bitcoin 地址']] },
      { k: 'address', label: '公開地址', req: 1, ph: '0x… 或 bc1…' },
    ],
    onSave: async v => {
      if (v.chain === 'evm' && !/^0x[0-9a-fA-F]{40}$/.test(v.address)) throw new Error('EVM 地址格式應為 0x 開頭 42 字元');
      if (v.chain === 'btc' && !/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,90}$/.test(v.address)) throw new Error('看起來不是比特幣地址');
      const r = w ? await upd('wallets', w.id, v) : await add('wallets', v);
      delete S.walletBal[r.id];
      toast('讀取鏈上餘額中…');
      await loadWallets(true); await loadPrices(true); render();
    },
    onDelete: w && (() => del('wallets', w.id)),
  });
}

/* ---------------- shortcut fallback: #add?amount=&merchant=&card= ---------------- */
function handleHash() {
  const h = location.hash;
  if (!h.startsWith('#add')) return;
  const p = new URLSearchParams(h.split('?')[1] || '');
  history.replaceState(null, '', location.pathname + location.search);
  const rawAmt = p.get('amount') || '';
  const amount = parseFloat(rawAmt.replace(/[^0-9.\-]/g, ''));
  const cardTxt = (p.get('card') || '').toLowerCase().replace(/\s/g, '');
  const card = S.cards.find(c => [c.wallet_name, c.name].filter(Boolean).some(k => cardTxt.includes(k.toLowerCase().replace(/\s/g, ''))));
  formTxn(null, { amount: Number.isFinite(amount) ? amount : '', merchant: p.get('merchant') || '', card_id: card?.id || '', currency: p.get('currency') || 'TWD', source: 'shortcut', card_label: p.get('card') || '' });
}

/* ---------------- token ---------------- */
async function loadToken() {
  if (!CLOUD) return;
  const { data } = await sb.from('ingest_tokens').select('token').maybeSingle();
  S.token = data?.token || null;
}
async function genToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = 'ac_' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  const { error } = await sb.from('ingest_tokens').upsert({ user_id: user.id, token });
  if (error) throw error;
  S.token = token; render(); toast('已產生新金鑰');
}

/* ---------------- demo data ---------------- */
async function seed() {
  if (S.accounts.length && !confirm('會在現有資料上加入範例，確定？')) return;
  const a1 = await add('accounts', { name: '主要薪轉 台幣', bank: '範例銀行', currency: 'TWD', balance: 86400 });
  await add('accounts', { name: '外幣帳戶 美元', bank: '範例銀行', currency: 'USD', balance: 1250 });
  if (!S.cards.length) await addPresetCards(true);
  for (const c of S.cards) if (!c.debit_account_id) await upd('cards', c.id, { debit_account_id: a1.id });
  const [c1, c2, c3] = [S.cards[0], S.cards[1] || S.cards[0], S.cards[2] || S.cards[0]];
  const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
  const billedDay = d => { const x = parseYmd(ymd(prevCycleEnd(+d.closing_day, cycleEndOnOrAfter(+d.closing_day, todayDate())))); x.setDate(x.getDate() - 6); x.setHours(12); return x.toISOString(); };
  await add('transactions', { card_id: c2.id, merchant: '全聯', amount: 486, currency: 'TWD', amount_twd: 486, txn_at: ago(5), source: 'shortcut' });
  await add('transactions', { card_id: c2.id, merchant: 'LINE Pay 午餐', amount: 160, currency: 'TWD', amount_twd: 160, txn_at: ago(28), source: 'manual' });
  await add('transactions', { card_id: c2.id, merchant: '誠品書店', amount: 1280, currency: 'TWD', amount_twd: 1280, txn_at: billedDay(c2), source: 'shortcut' });
  await add('transactions', { card_id: c1.id, merchant: 'Amazon JP', amount: 3200, currency: 'JPY', amount_twd: 690, txn_at: ago(40), source: 'shortcut' });
  await add('transactions', { card_id: c3.id, merchant: 'Agoda 東京住宿', amount: 210, currency: 'USD', amount_twd: 6790, txn_at: billedDay(c3), source: 'manual' });
  await add('stocks', { code: '0050', shares: 300, avg_cost: 165 });
  await add('stocks', { code: '2330', shares: 20, avg_cost: 980 });
  await add('crypto_holdings', { symbol: 'BTC', cg_id: 'bitcoin', qty: 0.012, venue: 'Binance' });
  await add('crypto_holdings', { symbol: 'USDT', cg_id: 'tether', qty: 500, venue: 'MAX' });
  await refreshAll(true);
  toast('已載入範例資料');
}

/* config.js 裡的 presetCards：第一次開啟、還沒有任何卡片時自動建立 */
async function addPresetCards(force) {
  const list = CFG.presetCards || [];
  const seenKey = 'ac_preset_seen_' + (CLOUD ? (user?.id || 'cloud') : 'local'); // 每個帳號分開記
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(seenKey) || '[]'); } catch (_) { }
  if (!CLOUD && localStorage.getItem('ac_preset_done') === '1' && !seen.length) seen = S.cards.map(c => c.name); // 舊版升級
  const added = [];
  for (const p of list) {
    if (S.cards.some(c => c.name === p.name) || (!force && seen.includes(p.name))) continue;
    await add('cards', { ...p, rewards: presetRewardsFor(p) || [], last_settled: initialSettled(p) });
    added.push(p.name);
  }
  // 舊卡片還沒有回饋設定的，補上建議規則
  for (const c of S.cards) if (c.rewards == null) await upd('cards', c.id, { rewards: presetRewardsFor(c) || [] });
  for (const c of S.cards) { // 舊規則補上新的設定欄位（例如 MaiCoin 的逐筆四捨五入、月上限）
    const pre = presetRewardsFor(c); if (!pre || !(c.rewards || []).length) continue;
    let changed = false;
    const next = c.rewards.map(r => {
      const p = pre.find(x => x.label === r.label); if (!p) return r;
      const add = {};
      for (const k of ['round_txn', 'cap_period']) if (p[k] != null && r[k] == null) { add[k] = p[k]; changed = true; }
      return { ...r, ...add };
    });
    if (changed) await upd('cards', c.id, { rewards: next });
  }
  try { localStorage.setItem(seenKey, JSON.stringify([...new Set([...seen, ...list.map(p => p.name)])])); } catch (_) { }
  if (added.length) toast(`已新增 ${added.join('、')}，記得到卡片設定選扣款帳戶`, 4500);
}

/* ================================================================
 * UI v2：依 2026/10 設計稿改版（總覽、帳戶、信用卡、底部彈窗）
 * ================================================================ */
const IC = {
  bank: '<path d="M3 9.5 12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20.5h18"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M16 12.5h2M3 9h18"/>',
  box: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  card: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>',
  chart: '<path d="M4 19.5h16M6 16v-4M10 16V9M14 16v-6M18 16V6"/>',
  plus: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>',
  split: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="12" cy="12" r="3.5"/><path d="M12 4v2M12 18v2"/>',
  gear: '<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M3.5 10h17M7 14.5h4"/>',
  more: '<circle cx="12" cy="12" r="8.5"/><circle cx="8" cy="12" r=".8" fill="currentColor"/><circle cx="12" cy="12" r=".8" fill="currentColor"/><circle cx="16" cy="12" r=".8" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  swap: '<path d="M8 4v15M8 19l-3-3M8 19l3-3M16 20V5M16 5l-3 3M16 5l3 3"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="M12 19V6M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v13M6 13l6 6 6-6"/>',
  food: '<path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M16 3c-1.7 1.4-2.5 3.6-2.5 6.5V13H17V3M17 13v8"/>',
  car: '<path d="M5 16V11l2-5h10l2 5v5M3 16h18M7 19v-3M17 19v-3"/><circle cx="7.5" cy="13" r=".8" fill="currentColor"/><circle cx="16.5" cy="13" r=".8" fill="currentColor"/>',
  home: '<path d="M4 11 12 4l8 7M6 9.5V20h12V9.5"/>',
  bag: '<path d="M5 8h14l-1 12H6Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  play: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3Z"/>',
  dots: '<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
};
const svgI = (k, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${IC[k] || ''}</svg>`;

/* ---------- 消費類別 ---------- */
const CATS = [
  ['food', '餐飲', 'food', '#e0894f'],
  ['traffic', '交通', 'car', '#4f8fd6'],
  ['life', '生活', 'home', '#3fa58a'],
  ['shop', '購物', 'bag', '#c9699a'],
  ['fun', '娛樂', 'play', '#8a6fd1'],
  ['other', '其他', 'dots', '#8f8a80'],
];
const CAT = Object.fromEntries(CATS.map(c => [c[0], c]));
function guessCat(m) {
  m = (m || '').toLowerCase();
  if (/手續費|回饋|年費|利息/.test(m)) return 'other';
  if (/優步[－-]|uber\s*eats|foodpanda|咖啡|cafe|coffee|星巴克|starbucks|麥當勞|mcdonald|肯德基|摩斯|餐|食|飲|串燒|餃|鍋|麵|飯|壽司|拉麵|燒肉|早午|漢堡|甜點|麵包|茶/.test(m)) return 'food';
  if (/高鐵|台鐵|捷運|悠遊|一卡通|ipass|easycard|uber|優步|計程車|taxi|中油|加油|停車|irent|gogoro|wemo|航空|機票|airline/.test(m)) return 'traffic';
  if (/全聯|家樂福|7-eleven|7-11|統一超商|全家|萊爾富|ok超商|超商|藥局|屈臣氏|康是美|寶雅|電信|中華電信|台灣大|遠傳|水費|電費|瓦斯|房租|管理費/.test(m)) return 'life';
  if (/momo|蝦皮|shopee|pchome|amazon|淘寶|百貨|誠品|uniqlo|ikea|costco|好市多|博客來|蝦皮|網購|商城/.test(m)) return 'shop';
  if (/apple\.com|itunes|netflix|spotify|youtube|disney|steam|playstation|nintendo|電影|威秀|秀泰|kkbox|google\s*play|rately|遊戲/.test(m)) return 'fun';
  return 'other';
}
const catOf = t => CAT[t.category] ? t.category : guessCat(t.merchant);
const catDot = (k, size = 'md') => { const c = CAT[k] || CAT.other; return `<span class="cat-ic ${size}" style="--c:${c[3]}">${svgI(c[2])}</span>`; };

/* ---------- 色彩與圖示 ---------- */
const hueOf = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const ACC_TYPES = [['bank', '銀行帳戶'], ['epay', '電子支付'], ['other', '其他資產']];
const accType = a => a.type || (/line\s*pay|街口|全支付|悠遊付|一卡通|pi錢包|icash|paypal|wise/i.test(`${a.name} ${a.bank}`) ? 'epay' : 'bank');
function accIcon(a) {
  const label = (a.bank || a.name || '?').replace(/銀行|商業|股份|有限公司/g, '').trim().slice(0, 1).toUpperCase();
  const h = hueOf(a.bank || a.name);
  return `<span class="acc-ic" style="--h:${h}">${esc(label)}</span>`;
}
const BANKS = ['聯邦銀行', '永豐銀行', '星展銀行', '國泰世華', '玉山銀行', '台新銀行', '中國信託', '富邦銀行', '台北富邦', '第一銀行', '兆豐銀行', '其他'];

/* ---------- 共用：底部彈窗表單 ---------- */
function openForm({ title, fields, data = {}, onSave, onDelete, note = '', tabs = null, submitLabel = '儲存', cancelLabel = '取消' }) {
  const m = $('#modal');
  const val = f => data[f.k] ?? f.def ?? '';
  const fieldHtml = f => {
    const v = val(f), req = f.req ? 'required' : '', cls = `fld${f.half ? ' half' : ''}`;
    if (f.type === 'swap') return `<div class="fld swap-row"><button type="button" class="swap-btn" data-swap="${f.a},${f.b}" aria-label="對調">${svgI('swap')}</button></div>`;
    if (f.type === 'check') return `<label class="${cls} check"><input type="checkbox" name="${f.k}" ${v ? 'checked' : ''}> <span>${esc(f.label)}</span></label>`;
    let input;
    if (f.type === 'select') input = `<span class="sel"><select name="${f.k}" ${req}>${f.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>${svgI('down', 'sel-ic')}</span>`;
    else if (f.type === 'chips') input = `<input type="hidden" name="${f.k}" value="${esc(v)}"><span class="chips" data-chips="${f.k}">${f.options.map(([ov, ol, ic]) => `<button type="button" class="chip-btn${String(ov) === String(v) ? ' on' : ''}" data-v="${esc(ov)}">${ic ? catDot(ov, 'sm') : ''}${esc(ol)}</button>`).join('')}</span>`;
    else if (f.type === 'money') input = `<span class="money-in"><span class="cur" data-cur-for="${f.k}">${esc(f.cur || 'NT$')}</span><input name="${f.k}" type="number" step="any" inputmode="decimal" value="${esc(v)}" placeholder="0" ${req}></span>${f.quick ? `<span class="quick">${f.quick.map(q => `<button type="button" data-quick="${f.k}" data-q="${q}">+${q.toLocaleString()}</button>`).join('')}</span>` : ''}`;
    else input = `<input name="${f.k}" type="${f.type || 'text'}" value="${esc(v)}" ${f.type === 'number' ? 'step="any" inputmode="decimal"' : ''} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''} ${req}>`;
    return `<label class="${cls}"><span class="lb">${esc(f.label)}</span>${input}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</label>`;
  };
  const main = fields.filter(f => !f.more), more = fields.filter(f => f.more);
  m.innerHTML = `<form class="sheet"><span class="grab"></span>
    <div class="sheet-head"><h3>${esc(title)}</h3><button type="button" class="x" data-f="cancel" aria-label="關閉">×</button></div>
    ${tabs ? `<div class="seg-ctl sheet-tabs">${tabs.map(t => `<button type="button" class="${t.on ? 'on' : ''}" ${t.on ? '' : `data-act="${t.act}"`}>${esc(t.label)}</button>`).join('')}</div>` : ''}
    ${note}<div class="fgrid">${main.map(fieldHtml).join('')}</div>
    ${more.length ? `<details class="more"><summary>更多選項</summary><div class="fgrid">${more.map(fieldHtml).join('')}</div></details>` : ''}
    <div class="actions sheet-actions">${onDelete ? '<button type="button" class="btn danger" data-f="del">刪除</button>' : ''}
      <button type="button" class="btn" data-f="cancel">${esc(cancelLabel)}</button><button class="btn primary" type="submit">${esc(submitLabel)}</button></div></form>`;
  m.hidden = false;
  const form = $('form', m);
  const close = () => { m.hidden = true; m.innerHTML = ''; };
  m.onclick = e => { if (e.target === m) close(); };
  m.querySelectorAll('[data-f="cancel"]').forEach(b => b.onclick = close);
  m.querySelectorAll('[data-chips]').forEach(box => box.onclick = e => {
    const b = e.target.closest('.chip-btn'); if (!b) return;
    box.querySelectorAll('.chip-btn').forEach(x => x.classList.toggle('on', x === b));
    form.elements[box.dataset.chips].value = b.dataset.v;
  });
  m.querySelectorAll('[data-quick]').forEach(b => b.onclick = () => { const el = form.elements[b.dataset.quick]; el.value = num(el.value) + +b.dataset.q; el.dispatchEvent(new Event('input')); });
  m.querySelectorAll('[data-swap]').forEach(b => b.onclick = () => { const [x, y] = b.dataset.swap.split(','); const ex = form.elements[x], ey = form.elements[y]; [ex.value, ey.value] = [ey.value, ex.value]; ex.dispatchEvent(new Event('change')); });
  if (onDelete) $('[data-f="del"]', m).onclick = async () => { if (confirm('確定刪除？')) { try { await onDelete(); close(); render(); } catch (err) { toast('刪除失敗：' + err.message); } } };
  form.onsubmit = async e => {
    e.preventDefault();
    const out = {};
    for (const f of fields) {
      if (f.type === 'swap') continue;
      const el = form.elements[f.k]; if (!el) continue;
      out[f.k] = f.type === 'check' ? el.checked : (f.type === 'number' || f.type === 'money') ? (el.value === '' ? null : parseFloat(el.value)) : el.value.trim();
    }
    const btn = $('button[type=submit]', form); btn.disabled = true;
    try { const r = await onSave(out, form); if (r === false) { btn.disabled = false; return; } close(); render(); }
    catch (err) { btn.disabled = false; toast('儲存失敗：' + (err.message || err)); }
  };
  return form;
}

/* ---------- 交易列 ---------- */
function txnRow(t, opts = {}) {
  const c = S.cards.find(x => x.id === t.card_id);
  const foreign = t.currency && t.currency !== 'TWD';
  const k = catOf(t);
  const d = new Date(t.txn_at);
  return `<div class="row click txn" data-act="edit-txn" data-id="${t.id}" data-cat="${k}" data-text="${esc((t.merchant || '').toLowerCase())}">
    ${catDot(k)}
    <div class="grow"><div class="title">${esc(t.merchant || '（未填商家）')}</div>
      <div class="meta">${d.getMonth() + 1}/${pad(d.getDate())} · ${CAT[k][1]}${opts.showCard !== false ? ` · ${c ? esc(c.name) : `<span class="warn">${esc(t.card_label || '未對應卡片')}</span>`}` : ''}${t.source === 'shortcut' ? ' · 捷徑' : ''}${t.settled_cycle ? ' · 已扣款' : ''}</div></div>
    <div class="right"><div class="amt-sm">${money(billAmt(t))}</div>${foreign ? `<div class="meta">${money(num(t.amount), t.currency)}</div>` : ''}${rewOf(t.id) > 0.05 ? `<div class="meta rew">回饋 ${money(rewOf(t.id), 'TWD', rewOf(t.id) < 10 ? 1 : 0)}</div>` : ''}</div></div>`;
}

/* ---------- 01 總覽 ---------- */
function splitTotals() {
  const t = totals();
  const accTW = a => { const v = toTWD(num(a.balance), a.currency); return Number.isFinite(v) ? v : 0; };
  const bank = sum(S.accounts.filter(a => accType(a) !== 'other'), accTW);
  const otherAcc = sum(S.accounts.filter(a => accType(a) === 'other'), accTW);
  const invest = t.stock + t.crypto;
  const other = otherAcc + t.recv;
  const gross = bank + invest + other;
  return { ...t, bankOnly: bank, invest, other, gross };
}
function areaChart(points) {
  if (points.length < 2) return '<div class="chart-empty">每天開 App 會自動記一筆，滿兩天就會出現走勢</div>';
  const W = 320, H = 96, vals = points.map(p => p.v), mn = Math.min(...vals), mx = Math.max(...vals), rng = mx - mn || 1;
  const xy = points.map((p, i) => [i / (points.length - 1) * W, H - 10 - (p.v - mn) / rng * (H - 24)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = xy.at(-1);
  return `<svg class="area" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--gold);stop-opacity:.32"/><stop offset="1" style="stop-color:var(--gold);stop-opacity:0"/></linearGradient></defs>
    <path d="${line} L${W} ${H} L0 ${H}Z" fill="url(#ag)"/><path d="${line}" fill="none" stroke="var(--gold)" stroke-width="2" vector-effect="non-scaling-stroke"/>
    </svg><span class="area-dot" style="left:${(lx / W * 100).toFixed(2)}%;top:${(ly / H * 100).toFixed(2)}%"></span>`;
}
function donut(parts, total, label) {
  const R = 52, C = 2 * Math.PI * R;
  const pos = parts.filter(p => p.v > 0), sumPos = sum(pos, p => p.v) || 1;
  let off = 0;
  const arcs = pos.map(p => { const len = p.v / sumPos * C; const s = `<circle r="${R}" fill="none" stroke="${p.c}" stroke-width="16" stroke-dasharray="${Math.max(0, len - 2).toFixed(2)} ${(C - len + 2).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`; off += len; return s; }).join('');
  return `<div class="donut-wrap"><svg class="donut" viewBox="-70 -70 140 140" aria-hidden="true"><g transform="rotate(-90)"><circle r="${R}" fill="none" stroke="var(--panel-2)" stroke-width="16"/>${arcs}</g></svg>
    <div class="donut-c"><small>${esc(label)}</small><b>${total}</b></div></div>`;
}
const shortMoney = v => S.hide ? '••••' : Math.abs(v) >= 1e6 ? `NT$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e4 ? `NT$${(v / 1e4).toFixed(1)}萬` : money(v);
VIEWS.overview = () => {
  const t = splitTotals();
  const range = S.range || 30;
  const since = new Date(); since.setDate(since.getDate() - range);
  const pts = S.snapshots.filter(s => parseYmd(s.date) >= since).sort((a, b) => String(a.date).localeCompare(String(b.date))).map(s => ({ v: num(s.net) }));
  if (pts.length) pts[pts.length - 1] = { v: t.net }; else pts.push({ v: t.net });
  const first = pts[0].v, chg = first ? (t.net - first) / Math.abs(first) * 100 : 0;
  const pctOf = v => t.gross > 0 ? v / t.gross * 100 : 0;
  const tile = (ic, name, v, p, neg) => `<div class="tile"><div class="tile-h">${svgI(ic)}<span>${name}</span></div><b>${money(v)}</b><span class="tp ${neg ? 'neg' : 'pos'}">${svgI(neg ? 'arrowDown' : 'up', 'ti')}${Math.abs(p).toFixed(1)}%</span></div>`;
  const cardDebt = t.debt + t.liab;
  const parts = [
    { n: '投資', v: t.invest, c: 'var(--c-stock)' },
    { n: '銀行存款', v: t.bankOnly, c: 'var(--c-bank)' },
    { n: '其他', v: t.other, c: 'var(--c-recv)' },
  ];
  const legend = [...parts.map(p => `<div><i style="background:${p.c}"></i><span>${p.n}</span><b>${pctOf(p.v).toFixed(1)}%</b></div>`),
    `<div><i style="background:var(--c-debt)"></i><span>信用卡／負債</span><b class="neg">-${pctOf(cardDebt).toFixed(1)}%</b></div>`].join('');
  const states = S.cards.map(c => ({ c, st: cardState(c) })).sort((a, b) => a.st.next.date - b.st.next.date);
  const recent = S.transactions.slice().sort((a, b) => b.txn_at.localeCompare(a.txn_at)).slice(0, 5);
  const rewTotal = sum(S.cards, c => cycleReward(c, cardState(c).open.end).total);
  return `
  <section class="hero2">
    <div class="hero2-top"><span class="lbl">總資產淨值</span>
      <span class="sel mini"><select data-range>${[[30, '近一個月'], [90, '近三個月'], [365, '近一年']].map(([v, l]) => `<option value="${v}" ${v === range ? 'selected' : ''}>${l}</option>`).join('')}</select>${svgI('down', 'sel-ic')}</span></div>
    <div class="hero2-num">${money(t.net)}</div>
    <div class="hero2-chg ${chg >= 0 ? 'pos' : 'neg'}">${svgI(chg >= 0 ? 'up' : 'arrowDown', 'ti')}${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% <span>${range === 30 ? '本月' : range === 90 ? '近三個月' : '今年'}變動</span></div>
    <div class="area-box">${areaChart(pts)}</div>
  </section>
  <div class="tiles">
    ${tile('bank', '銀行帳戶', t.bankOnly, pctOf(t.bankOnly))}
    ${tile('card', '信用卡未繳', cardDebt, pctOf(cardDebt), true)}
    ${tile('chart', '投資資產', t.invest, pctOf(t.invest))}
    ${tile('box', '其他資產', t.other, pctOf(t.other))}
  </div>
  <section class="panel dist"><h4>資產分布</h4><div class="dist-body">${donut(parts, shortMoney(t.gross), '總資產')}<div class="dist-leg">${legend}</div></div></section>
  ${rewTotal > 0 ? `<button class="rew-strip" data-act="recommend"><span>本期預估回饋</span><b>${money(rewTotal)}</b><small>刷哪張最划算 ›</small></button>` : ''}
  <h2>接下來的扣款</h2>
  <section class="panel">${states.length ? states.slice(0, 5).map(({ c, st }) => `<div class="row click" data-act="open-card" data-id="${c.id}">
      <div class="date-glyph" style="--cc:${esc(c.color || '#b8893a')}"><b>${st.next.date.getDate()}</b><small>${st.next.date.getMonth() + 1} 月</small></div>
      <div class="grow"><div class="title">${esc(c.name)}</div><div class="meta one">${st.next.days === 0 ? '<span class="warn">今天扣款</span>' : `${st.next.days} 天後扣款`}・${st.next.final ? '帳單已出' : '累計中'}</div></div>
      <div class="right amt-sm">${money(st.next.amount)}</div></div>`).join('') : `<button class="empty-cta" data-act="${(CFG.presetCards || []).length ? 'preset-cards' : 'add-card'}">新增信用卡</button>`}</section>
  <h2>最近刷卡</h2>
  <section class="panel">${recent.map(x => txnRow(x)).join('') || '<button class="empty-cta" data-act="add-txn">記下第一筆刷卡</button>'}</section>`;
};

/* ---------- 02 帳戶 ---------- */
VIEWS.bank = () => {
  const tab = S.accTab || 'bank';
  const accs = S.accounts.filter(a => accType(a) === tab);
  const filt = S.accFilter || 'all';
  const shown = accs.filter(a => filt === 'all' || (filt === 'twd' ? a.currency === 'TWD' : a.currency !== 'TWD'));
  const total = sum(shown, a => { const v = toTWD(num(a.balance), a.currency); return Number.isFinite(v) ? v : 0; }) + (tab === 'other' ? sum(S.receivables.filter(r => !r.received_at), r => num(r.amount)) : 0);
  const rows = shown.map(a => `<div class="row click acc" data-act="edit-acc" data-id="${a.id}">
      ${accIcon(a)}
      <div class="grow"><div class="title">${esc(a.name)}</div><div class="meta">${esc([a.kind || (tab === 'epay' ? '電子支付' : '活存'), a.note].filter(Boolean).join('・'))}${a.currency !== 'TWD' ? `・${esc(a.currency)}` : ''}</div></div>
      <div class="right"><div class="amt-sm">${money(num(a.balance), a.currency)}</div>${a.currency !== 'TWD' ? `<div class="meta">≈ ${money(toTWD(num(a.balance), a.currency))}</div>` : ''}</div>
      ${svgI('chev', 'chev')}</div>`).join('');
  const logs = S.balance_log.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).filter(l => accs.some(a => a.id === l.account_id)).slice(0, 12).map(l => {
    const a = S.accounts.find(x => x.id === l.account_id);
    return `<div class="row"><div class="grow"><div class="title">${esc(l.note || '餘額調整')}</div><div class="meta">${new Date(l.created_at).toLocaleDateString('zh-TW')} · ${esc(a?.name || '')}</div></div>
      <div class="right amt-sm ${num(l.delta) < 0 ? 'neg' : 'pos'}">${num(l.delta) > 0 ? '+' : ''}${money(num(l.delta), a?.currency)}</div></div>`;
  }).join('');
  const label = { bank: '銀行帳戶總額', epay: '電子支付總額', other: '其他資產總額' }[tab];
  return `${S.missingTables.length ? `<div class="banner warn">應收款／負債的資料表還沒建立：請到 Supabase 執行 README 裡的 SQL。</div>` : ''}
    <div class="seg-ctl">${ACC_TYPES.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-act="acc-tab" data-t="${k}">${l}</button>`).join('')}</div>
    <section class="sum-card">
      <div class="sum-top"><span class="lbl">${label}</span>
        <span class="sel mini"><select data-accfilter>${[['all', '全部帳戶'], ['twd', '台幣'], ['fx', '外幣']].map(([v, l]) => `<option value="${v}" ${v === filt ? 'selected' : ''}>${l}</option>`).join('')}</select>${svgI('down', 'sel-ic')}</span></div>
      <b>${money(total)}</b>
      <span class="sum-art">${svgI(tab === 'epay' ? 'wallet' : tab === 'other' ? 'box' : 'bank', 'art')}</span>
    </section>
    <section class="list-card">${rows || `<div class="empty">還沒有${ACC_TYPES.find(x => x[0] === tab)[1]}</div>`}</section>
    <div class="actions"><button class="btn outline" data-act="add-acc">＋ 新增帳戶</button>${S.accounts.length > 1 ? '<button class="btn" data-act="transfer">⇄ 轉帳</button>' : ''}</div>
    ${tab === 'other' ? recvSection() + liabSection() : ''}
    ${logs ? `<h2>異動紀錄</h2><section class="panel">${logs}</section>` : ''}`;
};
function formAccount(a) {
  const tab = a ? accType(a) : (S.accTab || 'bank');
  openForm({
    title: a ? '編輯帳戶' : '新增帳戶', data: a ? { ...a, type: accType(a) } : { type: tab, currency: 'TWD', balance: 0 },
    fields: [
      { k: 'type', label: '分類', type: 'chips', options: ACC_TYPES },
      { k: 'name', label: '帳戶名稱', req: 1, ph: '例：永豐大戶、LINE Pay' },
      { k: 'bank', label: '銀行／機構', ph: '例：永豐銀行', half: true },
      { k: 'kind', label: '帳戶類型', ph: '活存、定存、數位帳戶…', half: true },
      ...(a ? [] : [{ k: 'balance', label: '目前餘額', type: 'money' }]),
      { k: 'currency', label: '幣別', type: 'select', options: CURRENCIES, more: true },
      { k: 'note', label: '備註（顯示在名稱下方）', ph: '例：主要帳戶、自動扣款、2026/05 到期', more: true },
    ],
    onSave: async v => { v.type = v.type || 'bank'; if (a) await upd('accounts', a.id, v); else await add('accounts', { ...v, balance: v.balance || 0 }); S.accTab = v.type; },
    onDelete: a && (async () => {
      if (S.cards.some(c => c.debit_account_id === a.id)) throw new Error('有信用卡用這個帳戶扣款，請先改掉卡片設定');
      await del('accounts', a.id);
    }),
  });
}

/* ---------- 05 轉帳／新增紀錄／對帳 ---------- */
const MONEY_TABS = cur => [['transfer', '轉帳'], ['money-in-out', '新增紀錄'], ['money-set', '對帳']].map(([act, label]) => ({ act, label, on: act === cur }));
function formTransfer(from) {
  if (S.accounts.length < 2) { toast('至少要有兩個帳戶才能轉帳'); return; }
  const opts = S.accounts.map(a => [a.id, `${a.name}（${money(num(a.balance), a.currency)}）`]);
  const f0 = from?.id || S.accounts[0].id;
  let confirmStep = false;
  const form = openForm({
    title: '帳戶轉帳', tabs: MONEY_TABS('transfer'), submitLabel: '下一步',
    data: { from: f0, to: S.accounts.find(a => a.id !== f0)?.id, fee: 0 },
    fields: [
      { k: 'from', label: '轉出帳戶', type: 'select', options: opts },
      { type: 'swap', a: 'from', b: 'to' },
      { k: 'to', label: '轉入帳戶', type: 'select', options: opts },
      { k: 'amount', label: '轉出金額', type: 'money', req: 1, quick: [1000, 5000, 10000] },
      { k: 'fee', label: '手續費', type: 'number', hint: '跨行轉帳常見 NT$10–15' },
      { k: 'note', label: '備註', ph: '例：存到大戶、換美金' },
      { k: 'to_amount', label: '轉入金額（幣別不同時填實際入帳）', type: 'number', more: true, hint: '留空：同幣別等於轉出金額；不同幣別依即時匯率換算' },
    ],
    onSave: async (v, f) => {
      const A = S.accounts.find(a => a.id === v.from), B = S.accounts.find(a => a.id === v.to);
      if (!A || !B || A.id === B.id) throw new Error('轉出和轉入要選不同帳戶');
      if (!(v.amount > 0)) throw new Error('金額要大於 0');
      const inAmt = v.to_amount != null ? v.to_amount : (A.currency === B.currency ? v.amount : Math.round(fromTWD(toTWD(v.amount, A.currency), B.currency) * 100) / 100);
      if (!Number.isFinite(inAmt)) throw new Error('抓不到匯率，請在「更多選項」填轉入金額');
      const fee = num(v.fee);
      if (!confirmStep) { // 第一步：顯示確認摘要
        confirmStep = true;
        const box = document.createElement('div'); box.className = 'confirm-box';
        box.innerHTML = `<div><span>${esc(A.name)}</span><b class="neg">-${money(v.amount + fee, A.currency)}</b></div><div><span>${esc(B.name)}</span><b class="pos">+${money(inAmt, B.currency)}</b></div>${fee ? `<small>含手續費 ${money(fee, A.currency)}</small>` : ''}`;
        f.querySelector('.sheet-actions').before(box);
        f.querySelector('button[type=submit]').textContent = '確認轉帳';
        f.querySelectorAll('.fgrid, details.more').forEach(x => x.classList.add('dim'));
        return false;
      }
      const aAfter = Math.round((num(A.balance) - v.amount - fee) * 100) / 100;
      const bAfter = Math.round((num(B.balance) + inAmt) * 100) / 100;
      const tag = v.note ? `・${v.note}` : '';
      await upd('accounts', A.id, { balance: aAfter });
      await add('balance_log', { account_id: A.id, delta: -(v.amount + fee), balance_after: aAfter, note: `轉帳 → ${B.name}${fee ? `（含手續費 ${fee}）` : ''}${tag}` });
      await upd('accounts', B.id, { balance: bAfter });
      await add('balance_log', { account_id: B.id, delta: inAmt, balance_after: bAfter, note: `轉帳 ← ${A.name}${tag}` });
      toast(`已從 ${A.name} 轉 ${money(v.amount, A.currency)} 到 ${B.name}`);
    },
  });
  form.addEventListener('input', () => { if (confirmStep) { confirmStep = false; form.querySelector('.confirm-box')?.remove(); form.querySelector('button[type=submit]').textContent = '下一步'; form.querySelectorAll('.dim').forEach(x => x.classList.remove('dim')); } });
}
function formMoney(mode, a0) {
  if (!S.accounts.length) { formAccount(); return; }
  const isSet = mode === 'set';
  openForm({
    title: isSet ? '對帳' : '新增收支紀錄', tabs: MONEY_TABS(isSet ? 'money-set' : 'money-in-out'),
    data: { account_id: a0?.id || S.accounts[0].id, mode: isSet ? 'set' : 'in' },
    note: isSet ? '<p class="meta" style="margin:-4px 0 10px">輸入銀行 App 顯示的實際餘額，差額會記成一筆對帳調整。</p>' : '',
    fields: [
      { k: 'account_id', label: '帳戶', type: 'select', options: S.accounts.map(x => [x.id, `${x.name}（${money(num(x.balance), x.currency)}）`]) },
      ...(isSet ? [] : [{ k: 'mode', label: '類型', type: 'chips', options: [['in', '存入／收入'], ['out', '提出／支出']] }]),
      { k: 'amount', label: isSet ? '目前實際餘額' : '金額', type: 'money', req: 1, quick: isSet ? null : [1000, 5000, 10000] },
      { k: 'note', label: '說明', ph: isSet ? '例：月底對帳' : '例：薪水、房租、提款' },
    ],
    onSave: async v => {
      const a = S.accounts.find(x => x.id === v.account_id);
      const cur = num(a.balance), m = isSet ? 'set' : v.mode;
      const after = m === 'set' ? v.amount : m === 'in' ? cur + v.amount : cur - v.amount;
      const delta = Math.round((after - cur) * 100) / 100;
      await upd('accounts', a.id, { balance: after });
      await add('balance_log', { account_id: a.id, delta, balance_after: after, note: v.note || (m === 'set' ? '對帳調整' : m === 'in' ? '存入' : '支出') });
    },
  });
}
function formAdjust(a0) { formMoney('in-out', a0); }

/* ---------- 03 信用卡列表 ---------- */
function cardRow(c, st) {
  const n = st.next;
  const rew = (c.rewards || []).length ? cycleReward(c, st.open.end).total : 0;
  return `<button class="crow${S.cardOpen === c.id ? ' sel' : ''}" style="--cc:${esc(c.color || '#b8893a')}" data-act="open-card" data-id="${c.id}">
    <span class="crow-ic">${svgI('card')}</span>
    <span class="crow-main"><span class="crow-name">${esc(c.name)}</span>${c.last4 ? `<span class="crow-l4">•••• ${esc(c.last4)}</span>` : ''}
      <span class="crow-sub">${n.final ? `${md(st.billed.end)} 帳單已出` : `本期累計中・${n.closeDays === 0 ? '今天' : n.closeDays + ' 天後'}結帳`}${rew ? `・回饋約 ${money(rew)}` : ''}</span></span>
    <span class="crow-r"><b>${money(n.amount)}</b><span class="${n.days <= 3 ? 'warn' : ''}">${n.days === 0 ? '今天扣款' : md(ymd(n.date)) + ' 扣款'}</span></span>
  </button>`;
}
VIEWS.cards = () => {
  const orphan = S.transactions.filter(t => !t.card_id && !t.settled_cycle);
  const banner = orphan.length ? `<div class="banner warn">有 ${orphan.length} 筆紀錄對不到卡片，點開指定卡片，再到卡片設定補上「Apple 錢包裡的卡片名稱」。</div><section class="panel" style="margin-bottom:14px">${orphan.map(x => txnRow(x)).join('')}</section>` : '';
  if (!S.cards.length) {
    const preset = (CFG.presetCards || []).length;
    return `${banner}<button class="cc cc-add" style="width:100%" data-act="${preset ? 'preset-cards' : 'add-card'}"><span class="plus">✦</span>${preset ? `加入我的 ${CFG.presetCards.length} 張信用卡` : '新增信用卡'}</button>`;
  }
  const open = S.cards.find(c => c.id === S.cardOpen);
  if (open) return cardDetailView(open);
  const all = S.cards.map(c => ({ c, st: cardState(c) })).sort((a, b) => a.st.next.date - b.st.next.date);
  const dueMonth = monthKey(all[0].st.next.date); // 「本期」＝最近一次要繳款的那個月
  const isNow = x => monthKey(x.st.next.date) <= dueMonth;
  const f = S.cardFilter || 'all';
  const list = all.filter(x => f === 'all' || (f === 'now' ? isNow(x) : !isNow(x)));
  const due = all.filter(isNow), nearest = all[0];
  const chip = (k, l, n) => `<button class="${f === k ? 'on' : ''}" data-act="card-filter" data-f="${k}">${l}(${n})</button>`;
  return `${banner}
    <section class="sum-card">
      <div class="sum-top"><span class="lbl">信用卡總覽</span><span class="sum-r"><small>近一筆</small><b>${md(ymd(nearest.st.next.date))}</b><small>${esc(nearest.c.name)}</small></span></div>
      <b>${money(sum(due, x => x.st.next.amount))}</b>
      <span class="meta">${nearest.st.next.date.getMonth() + 1} 月要繳 ${due.length} 張卡</span>
    </section>
    <div class="pills">${chip('all', '全部', all.length)}${chip('now', '本期', due.length)}${chip('next', '下期', all.length - due.length)}</div>
    <div class="crows">${list.map(x => cardRow(x.c, x.st)).join('') || '<div class="empty">沒有符合的卡片</div>'}</div>
    <div class="actions two"><button class="btn outline" data-act="recommend">${svgI('bulb', 'bi')}這筆刷哪張最划算？</button><button class="btn outline" data-act="add-card">＋ 新增信用卡</button></div>
    <div class="actions"><button class="btn ghost small" data-act="import-txn">匯入帳單明細</button></div>`;
};

/* ---------- 04 信用卡詳細 ---------- */
function cardFace(c) {
  const st = cardState(c), n = st.next;
  return `<div class="cc" style="--cc:${esc(c.color || '#c9a96e')}">
    ${constellation(c.id)}
    <span class="cc-top"><span class="cc-name">${esc(c.name)}</span><svg class="cc-chip" viewBox="0 0 34 26" aria-hidden="true"><rect x=".5" y=".5" width="33" height="25" rx="5"/><path d="M0 9h11M0 17h11M23 9h11M23 17h11M11 0v26M23 0v26"/></svg></span>
    ${c.last4 ? `<span class="cc-num">•••• ${esc(c.last4)}</span>` : ''}
    <span class="cc-mid"><b>${money(n.amount)}</b>${(c.rewards || []).length ? `<em class="cc-rew">本期回饋約 ${money(cycleReward(c, st.open.end).total)}</em>` : ''}</span>
    <span class="cc-bot"><span>${n.final ? `${md(st.billed.end)} 帳單・${md(ymd(n.date))} 扣款` : `${md(st.open.end)} 結帳・${md(ymd(st.open.due))} 扣款`}</span><span>${n.days === 0 ? '今天扣款' : n.days + ' 天後'}</span></span>
  </div>`;
}
function cardDetailView(c) {
  const st = cardState(c), cy = st.open, bl = st.billed;
  const acc = S.accounts.find(a => a.id === c.debit_account_id);
  const debt = sum(unsettled(c.id), billAmt), lim = num(c.credit_limit);
  const tab = S.cardTab || 'cur';
  const items = tab === 'cur' ? [...(bl ? bl.items : []), ...cy.items].sort(byTimeDesc) : S.transactions.filter(t => t.card_id === c.id && t.settled_cycle).sort(byTimeDesc);
  const hist = S.settlements.filter(s => s.card_id === c.id).sort((a, b) => String(b.cycle_end).localeCompare(String(a.cycle_end)));
  const usedCats = [...new Set(items.map(catOf))];
  return `<div class="cd-nav"><button class="btn small ghost back" data-act="cards-home">‹ 所有卡片</button>
      <span>${S.cards.length > 1 ? `<button class="icon-btn ring" data-act="card-step" data-d="-1" aria-label="上一張">${svgI('chev', 'flip')}</button><button class="icon-btn ring" data-act="card-step" data-d="1" aria-label="下一張">${svgI('chev')}</button>` : ''}</span></div>
    <div class="cd-face">${cardFace(c)}</div>
    <div class="seg-ctl">${[['cur', '本期'], ['hist', '歷史']].map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-act="card-tab" data-t="${k}">${l}</button>`).join('')}</div>
    ${tab === 'cur' ? `<div class="info-grid">
        <div><small>本期區間</small><b>${md(cy.start)} – ${md(cy.end)}</b></div>
        <div><small>扣款帳戶</small><b class="txt">${acc ? esc(acc.name) : '<span class="warn">未設定</span>'}</b></div>
        <div><small>已出帳金額</small><b>${bl ? money(bl.total) : '—'}</b></div>
        <div><small>扣款日</small><b>${md(ymd(st.next.date))}</b></div>
      </div>
      ${lim ? `<div class="usage"><div class="meter"><i style="width:${Math.min(100, debt / lim * 100).toFixed(1)}%${debt / lim > .8 ? ';background:var(--danger)' : ''}"></i></div><span>本期已使用 ${Math.round(debt / lim * 100)}%・剩餘額度 ${money(Math.max(0, lim - debt))}</span></div>` : ''}
      ${bl ? `<button class="btn small outline paid-btn" data-act="paid-bill" data-id="${c.id}">${md(bl.end)} 帳單已經繳了</button>` : ''}`
      : `<section class="panel">${hist.length ? hist.map(h => `<div class="row"><div class="grow"><div class="title">${md(ymd(dueFor(c, String(h.cycle_end).slice(0, 10))))} 扣款</div><div class="meta">${md(h.cycle_end)} 帳單</div></div><div class="right amt-sm">${money(num(h.amount))}</div></div>`).join('') : '<div class="empty">還沒有扣款紀錄</div>'}</section>`}
    <div class="qa">
      <button data-act="add-txn" data-card="${c.id}">${svgI('plus')}<span>新增消費</span></button>
      <button data-act="add-liab-card" data-card="${c.id}">${svgI('split')}<span>分期設定</span></button>
      <button data-act="edit-card" data-id="${c.id}">${svgI('gear')}<span>卡片設定</span></button>
      <button data-act="card-more" data-id="${c.id}">${svgI('more')}<span>更多</span></button>
    </div>
    <section class="panel txn-panel">
      <div class="tp-head"><h4>${tab === 'cur' ? '消費紀錄' : '已扣款消費'}</h4>
        <button class="icon-btn ring sm" data-act="txn-search" aria-label="搜尋">${svgI('search')}</button>
        <span class="sel mini"><select data-catfilter>${[['', '全部類別'], ...CATS.filter(x => usedCats.includes(x[0])).map(x => [x[0], x[1]])].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>${svgI('down', 'sel-ic')}</span></div>
      <input class="txn-q" type="search" placeholder="搜尋商家" hidden>
      <div class="txn-list">${items.map(x => txnRow(x, { showCard: false })).join('') || '<div class="empty">沒有消費紀錄</div>'}</div>
    </section>
    ${tab === 'cur' ? rewardPanel(c, st) : ''}`;
}
function filterTxnList() {
  const q = ($('.txn-q')?.value || '').trim().toLowerCase(), cat = $('[data-catfilter]')?.value || '';
  document.querySelectorAll('.txn-list .txn').forEach(r => { r.hidden = !!((q && !r.dataset.text.includes(q)) || (cat && r.dataset.cat !== cat)); });
}
function openCardMore(c) {
  const st = cardState(c);
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><span class="grab"></span><div class="sheet-head"><h3>${esc(c.name)}</h3><button type="button" class="x" data-close>×</button></div>
    <div class="menu">
      ${st.billed ? `<button data-act="paid-bill" data-id="${c.id}">${md(st.billed.end)} 帳單已經繳了</button>` : ''}
      <button data-act="import-txn">匯入帳單明細</button>
      <button data-act="recommend">這筆刷哪張最划算？</button>
      <button data-act="add-liab-card" data-card="${c.id}">新增分期</button>
      <button data-act="edit-card" data-id="${c.id}">卡片設定</button>
    </div></div>`;
  m.hidden = false;
  m.onclick = e => { if (e.target === m || e.target.closest('[data-close]')) { m.hidden = true; m.innerHTML = ''; } };
}

/* ---------- 新增信用卡 ---------- */
function formCard(c) {
  openForm({
    title: c ? '信用卡設定' : '新增信用卡', data: c ? { ...c } : { closing_day: 20, fx_fee: 1.5, color: '#b8893a' },
    fields: [
      { k: 'bank', label: '發卡銀行', type: 'select', options: [['', '請選擇銀行'], ...BANKS.map(b => [b, b])] },
      { k: 'name', label: '卡片名稱', req: 1, ph: '例：聯邦 MaiCoin 聯名卡' },
      { k: 'closing_day', label: '每月結帳日', type: 'number', req: 1, half: true },
      { k: 'due_day', label: '每月扣款日', type: 'number', half: true, hint: '留空＝結帳日當天' },
      { k: 'debit_account_id', label: '扣款帳戶', type: 'select', options: accOptions() },
      { k: 'last4', label: '卡號末四碼（選填）', ph: '3138', half: true },
      { k: 'credit_limit', label: '信用額度（選填）', type: 'number', half: true },
      { k: 'color', label: '代表色', type: 'select', options: [['#b8893a', '琥珀金'], ['#4f9a92', '青瓷'], ['#5b72c4', '霧藍'], ['#8a63b8', '薰紫'], ['#c0623f', '赭紅'], ['#5d6378', '石墨']] },
      { k: 'wallet_name', label: 'Apple 錢包裡的卡片名稱', ph: '捷徑比對用，填一部分即可', more: true },
      { k: 'fx_fee', label: '國外交易手續費率（%）', type: 'number', more: true, hint: '多數卡 1.5%，免手續費填 0' },
      { k: 'cycle_start', label: '改結帳日過渡期：本期從哪天開始', type: 'date', more: true },
      { k: 'first_close', label: '改結帳日後第一次結帳日', type: 'date', more: true },
    ],
    onSave: async v => {
      v.closing_day = Math.max(1, Math.min(31, Math.round(v.closing_day)));
      v.due_day = v.due_day == null ? null : Math.max(1, Math.min(31, Math.round(v.due_day)));
      v.debit_account_id = v.debit_account_id || null;
      v.cycle_start = v.cycle_start || null; v.first_close = v.first_close || null;
      v.last4 = (v.last4 || '').replace(/\D/g, '').slice(-4) || null;
      if (!!v.cycle_start !== !!v.first_close) throw new Error('改結帳日的兩個日期要一起填');
      if (c) {
        if (v.closing_day !== +c.closing_day || v.due_day !== (c.due_day == null ? null : +c.due_day)) v.last_settled = initialSettled(v);
        await upd('cards', c.id, v);
      } else await add('cards', { ...v, rewards: presetRewardsFor(v) || [], last_settled: initialSettled(v) });
    },
    onDelete: c && (async () => { await del('cards', c.id); S.cardOpen = null; S.transactions.forEach(t => { if (t.card_id === c.id) t.card_id = null; }); }),
  });
}

/* ---------- 新增消費 ---------- */
function formTxn(t, preset = {}) {
  const d = t || preset;
  const card = S.cards.find(c => c.id === (d.card_id || preset.card_id));
  openForm({
    title: t ? '編輯消費' : '新增消費',
    data: { ...d, category: t ? catOf(t) : (d.category || guessCat(d.merchant)), pay: d.pay || (t ? txnPay(t) : d.source === 'shortcut' ? 'applepay' : 'card'),
      date: ymd(new Date(d.txn_at || Date.now())), overseas: d.fee != null ? num(d.fee) > 0 : (d.currency && d.currency !== 'TWD'), settled: !!d.settled_cycle },
    fields: [
      { k: 'date', label: '消費日期', type: 'date', req: 1, half: true },
      { k: 'amount', label: '消費金額', type: 'money', req: 1, half: true },
      { k: 'category', label: '消費類別', type: 'chips', options: CATS.map(c => [c[0], c[1], true]) },
      { k: 'merchant', label: '商家／用途', ph: '例：星巴克' },
      { k: 'card_id', label: '信用卡', type: 'select', options: cardOptions() },
      { k: 'currency', label: '幣別', type: 'select', options: CURRENCIES, def: 'TWD', more: true, half: true },
      { k: 'pay', label: '支付方式', type: 'select', options: PAY_OPTIONS, def: 'card', more: true, half: true },
      { k: 'amount_twd', label: '台幣入帳金額（外幣時填帳單實際金額）', type: 'number', more: true },
      { k: 'overseas', label: '海外交易（加收國外交易手續費）', type: 'check', more: true },
      ...(t ? [{ k: 'settled', label: '已扣款（不再計入未來帳單）', type: 'check', more: true }] : []),
    ],
    onSave: async v => {
      const at = parseYmd(v.date); const old = t ? new Date(t.txn_at) : new Date(); at.setHours(old.getHours(), old.getMinutes());
      const row = { card_id: v.card_id || null, merchant: v.merchant, amount: v.amount, currency: v.currency || 'TWD', pay: v.pay, category: v.category || null, txn_at: at.toISOString() };
      row.amount_twd = row.currency === 'TWD' ? v.amount : (v.amount_twd ?? Math.round(toTWD(v.amount, row.currency) * 100) / 100);
      if (!Number.isFinite(row.amount_twd)) throw new Error('抓不到匯率，請在「更多選項」填台幣金額');
      const cd = S.cards.find(c => c.id === row.card_id);
      row.fee = v.overseas && !isFeeRow(row) ? Math.round(Math.abs(row.amount_twd) * feeRate(cd) / 100) * Math.sign(row.amount_twd || 1) : 0;
      if (t) {
        if (v.settled && !t.settled_cycle) row.settled_cycle = 'manual';
        if (!v.settled) row.settled_cycle = null;
        await upd('transactions', t.id, row);
      } else {
        row.source = preset.source || 'manual'; row.card_label = preset.card_label || cd?.name || '';
        if (cd?.last_settled && ymd(at) <= String(cd.last_settled).slice(0, 10)) { row.settled_cycle = 'past'; toast('這筆落在已扣款的週期，標記為已扣款'); }
        await add('transactions', row);
      }
    },
    onDelete: t && (() => del('transactions', t.id)),
  });
}

/* ---------- 主題設定 ---------- */
function themeTiles() {
  const cur = document.documentElement.dataset.theme || 'champagne';
  const names = { champagne: '香檳金', mist: '霧藍', oat: '燕麥奶茶', forest: '墨綠金' };
  return `<div class="theme-tiles">${THEMES.map(([k]) => `<button class="tt tt-${k}${k === cur ? ' on' : ''}" data-act="theme" data-theme="${k}" aria-pressed="${k === cur}"><span class="tt-img"></span><span class="tt-name">${names[k]}</span>${k === cur ? '<span class="tt-check">✓</span>' : ''}</button>`).join('')}</div>`;
}

/* ================================================================
 * UI v3：羅盤儀表板、投資頁、可收合消費紀錄、四套混合色系
 * ================================================================ */
const THEME_INFO = {
  ivory: ['晨光象牙', 'IVORY', '象牙白・鎏金星盤'],
  green: ['墨綠青金', 'GREEN', '松綠寶石・古典金'],
  navy: ['夜藍銀月', 'NAVY', '午夜海藍・月光銀'],
  purple: ['暮紫玫金', 'PURPLE', '煙燻紫晶・玫瑰金'],
};
THEMES.length = 0;
THEMES.push(['ivory', '晨光象牙', ['#f8f5ee', '#b98a3e', '#2a2a33']], ['green', '墨綠青金', ['#1f332c', '#d4b06a', '#eef0e8']],
  ['navy', '夜藍銀月', ['#1d2a3d', '#d8b878', '#edf0f6']], ['purple', '暮紫玫金', ['#2d2236', '#e0b394', '#f2ecf2']]);
const OLD_THEME = { champagne: 'ivory', mist: 'ivory', oat: 'ivory', forest: 'green' };
function applyTheme(t) {
  t = OLD_THEME[t] || t;
  const th = THEMES.find(x => x[0] === t);
  const NORD = ['nordic', 'dusk'], de = document.documentElement;
  de.classList.toggle('nord', NORD.includes(t)); de.classList.toggle('sky', !NORD.includes(t));
  if (!th) { de.dataset.theme = t; return; } // 主題還沒載入完：先套上，不要覆寫存檔
  de.dataset.theme = th[0];
  try { localStorage.setItem('ac_theme', th[0]); } catch (_) { }
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', th[2][0]);
  document.querySelector('meta[name=apple-mobile-web-app-status-bar-style]')?.setAttribute('content', ['ivory', 'nordic'].includes(th[0]) ? 'default' : 'black-translucent');
}
function themeTiles() {
  const cur = document.documentElement.dataset.theme || 'ivory';
  return `<div class="theme-tiles">${THEMES.map(([k]) => { const [n, en, d] = THEME_INFO[k]; return `<button class="tt tt-${k}${k === cur ? ' on' : ''}" data-act="theme" data-theme="${k}" aria-pressed="${k === cur}">
      <span class="tt-img"><span class="tt-orb"></span></span><span class="tt-name">${n}<small>${en}</small></span><span class="tt-desc">${d}</span>${k === cur ? '<span class="tt-check">✓</span>' : ''}</button>`; }).join('')}</div>`;
}

/* ---------- 01 羅盤儀表板 ---------- */
function compassDial(t) {
  const P = (r, a) => [r * Math.cos(a * DEG), r * Math.sin(a * DEG)];
  const f = n => n.toFixed(1);
  let ticks = '';
  for (let i = 0; i < 72; i++) {
    const a = i * 5 - 90, major = i % 9 === 0, mid = i % 3 === 0;
    const [x0, y0] = P(major ? 128 : mid ? 133 : 136, a), [x1, y1] = P(140, a);
    ticks += `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" class="ck${major ? ' M' : ''}"/>`;
  }
  // 資產比例環：銀行（左上）→ 投資（右上）→ 其他（右下）；負債另成內環
  const segs = [[t.bankOnly, 'var(--c-bank)'], [t.invest, 'var(--c-stock)'], [t.other, 'var(--c-recv)']].filter(x => x[0] > 0);
  const tot = sum(segs, x => x[0]) || 1;
  let a0 = -90, ring = '';
  for (const [v, c] of segs) {
    const sw = v / tot * 360;
    ring += sw >= 359.5 ? `<circle r="112" class="cr" style="stroke:${c}"/>` : `<path d="${arcPath(112, a0 + 1.2, a0 + sw - 1.2)}" class="cr" style="stroke:${c}"/>`;
    a0 += sw;
  }
  if (!segs.length) ring = '<circle r="112" class="cr empty"/>';
  const dsw = t.gross > 0 ? Math.min(359, (t.debt + t.liab) / t.gross * 360) : 0;
  const debt = dsw > .5 ? `<path d="${arcPath(97, -90, -90 + dsw)}" class="cr thin" style="stroke:var(--c-debt)"/>` : '';
  const star = (len, w, rot, cls) => `<g transform="rotate(${rot})"><path d="M0 ${-len} L${w} 0 L0 0Z" class="${cls} a"/><path d="M0 ${-len} L${-w} 0 L0 0Z" class="${cls} b"/></g>`;
  let rose = '';
  for (const r of [45, 135, 225, 315]) rose += star(52, 9, r, 'rs2');
  for (const r of [0, 90, 180, 270]) rose += star(84, 13, r, 'rs1');
  const anim = !S.compassSwept && !reduceMotion() ? '<animateTransform attributeName="transform" type="rotate" from="-40" to="0" dur="1.6s" calcMode="spline" keyTimes="0;1" keySplines=".2 .9 .25 1" fill="freeze"/>' : '';
  S.compassSwept = true;
  const lbl = [['N', 0, -150], ['E', 150, 0], ['S', 0, 150], ['W', -150, 0]].map(([s, x, y]) => `<text x="${x}" y="${y}" class="cl">${s}</text>`).join('');
  return `<svg class="compass2" viewBox="-165 -165 330 330" role="img" aria-label="資產羅盤：外環是資產比例，內側紅線是負債">
    <defs><radialGradient id="cg" cx="50%" cy="45%" r="60%"><stop offset="0" style="stop-color:var(--panel)"/><stop offset="1" style="stop-color:var(--panel-2)"/></radialGradient>
      <linearGradient id="gA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--fab-hi)"/><stop offset="1" style="stop-color:var(--fab)"/></linearGradient>
      <linearGradient id="gB" x1="1" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--fab)"/><stop offset="1" style="stop-color:var(--fab-lo)"/></linearGradient></defs>
    <circle r="146" fill="url(#cg)" class="cbase"/><circle r="140" class="cline"/><circle r="124" class="cline soft"/>
    ${ticks}${lbl}${ring}${debt}
    <circle r="86" class="cline soft"/><circle r="64" class="cline faint"/>
    <g class="rose">${anim}${rose}<circle r="10" class="rc"/><circle r="4" class="rc2"/></g>
  </svg>`;
}
function scenery() {
  return `<svg class="scenery" viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 80 L40 60 L70 72 L110 40 L150 66 L190 50 L230 70 L270 38 L320 64 L360 52 L400 70 L400 120 L0 120Z" class="m1"/>
    <path d="M0 96 L50 78 L95 92 L140 70 L185 90 L240 74 L290 92 L340 80 L400 94 L400 120 L0 120Z" class="m2"/>
    <path d="M0 108 Q100 96 200 106 T400 104 L400 120 L0 120Z" class="m3"/>
    <g class="lh"><path d="M328 70 l4 -22 h4 l4 22z"/><rect x="331" y="44" width="6" height="4"/></g>
  </svg>`;
}
VIEWS.overview = () => {
  const t = splitTotals();
  const range = S.range || 30;
  const since = new Date(); since.setDate(since.getDate() - range);
  const pts = S.snapshots.filter(s => parseYmd(s.date) >= since).sort((a, b) => String(a.date).localeCompare(String(b.date))).map(s => ({ v: num(s.net) }));
  if (pts.length) pts[pts.length - 1] = { v: t.net }; else pts.push({ v: t.net });
  const first = pts[0].v, chg = first ? (t.net - first) / Math.abs(first) * 100 : 0;
  const pctOf = v => t.gross > 0 ? v / t.gross * 100 : 0;
  const cardDebt = t.debt + t.liab;
  const node = (pos, ic, name, v, p, act, extra = '') => `<button class="cnode ${pos}" data-act="${act}" ${extra}><span class="cn-ic">${svgI(ic)}</span><span class="cn-t">${name}</span><span class="cn-p ${p < 0 ? 'neg' : ''}">${p < 0 ? '' : ''}${p.toFixed(1)}%</span></button>`;
  const states = S.cards.map(c => ({ c, st: cardState(c) })).sort((a, b) => a.st.next.date - b.st.next.date);
  const recent = S.transactions.slice().sort((a, b) => b.txn_at.localeCompare(a.txn_at));
  const rewTotal = sum(S.cards, c => cycleReward(c, cardState(c).open.end).total);
  const open = !!S.mapOpen;
  return `
  <section class="dash">
    <div class="dash-head">
      <span class="lbl">總資產淨值</span>
      <div class="dash-num">${money(t.net)}</div>
      <div class="hero2-chg ${chg >= 0 ? 'pos' : 'neg'}">${svgI(chg >= 0 ? 'up' : 'arrowDown', 'ti')}${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% <span>${range === 30 ? '本月' : range === 90 ? '近三個月' : '今年'}變動</span>
        <span class="sel mini"><select data-range>${[[30, '近一個月'], [90, '近三個月'], [365, '近一年']].map(([v, l]) => `<option value="${v}" ${v === range ? 'selected' : ''}>${l}</option>`).join('')}</select>${svgI('down', 'sel-ic')}</span></div>
    </div>
    <div class="dial-box">
      ${compassDial(t)}
      ${node('nw', 'bank', '銀行', t.bankOnly, pctOf(t.bankOnly), 'goto', 'data-tab="bank"')}
      ${node('ne', 'chart', '投資', t.invest, pctOf(t.invest), 'goto', 'data-tab="invest"')}
      ${node('sw', 'card', '信用卡', cardDebt, -pctOf(cardDebt), 'goto', 'data-tab="cards"')}
      ${node('se', 'box', '其他', t.other, pctOf(t.other), 'acc-other')}
    </div>
    ${scenery()}
    <button class="explore" data-act="map-toggle" aria-expanded="${open}">${open ? '收起資產地圖' : '探索你的資產地圖'}</button>
  </section>
  ${open ? `<section class="map-detail">
    <div class="tiles">
      ${[['bank', '銀行帳戶', t.bankOnly, 'var(--c-bank)', 'bank'], ['chart', '投資資產', t.invest, 'var(--c-stock)', 'invest'], ['card', '信用卡未繳', -cardDebt, 'var(--c-debt)', 'cards'], ['box', '其他資產', t.other, 'var(--c-recv)', 'bank']].map(([ic, n, v, c, tab]) => `<button class="tile" data-act="goto" data-tab="${tab}" style="--tc:${c}"><div class="tile-h">${svgI(ic)}<span>${n}</span></div><b class="${v < 0 ? 'neg' : ''}">${money(v)}</b><span class="tp">${Math.abs(pctOf(Math.abs(v))).toFixed(1)}%</span></button>`).join('')}
    </div>
    <div class="panel trend-card"><div class="tp-head"><h4>淨值走勢</h4></div><div class="area-box sm">${areaChart(pts)}</div></div>
  </section>` : ''}
  ${rewTotal > 0 ? `<button class="rew-strip" data-act="recommend"><span>本期預估回饋</span><b>${money(rewTotal)}</b><small>刷哪張最划算 ›</small></button>` : ''}
  ${collapsible('ov-due', '接下來的扣款', `${states.length} 張卡・合計 ${money(sum(states, x => x.st.next.amount))}`, states.map(({ c, st }) => `<div class="row click" data-act="open-card" data-id="${c.id}">
      <div class="date-glyph" style="--cc:${esc(c.color || '#b8893a')}"><b>${st.next.date.getDate()}</b><small>${st.next.date.getMonth() + 1} 月</small></div>
      <div class="grow"><div class="title">${esc(c.name)}</div><div class="meta one">${st.next.days === 0 ? '<span class="warn">今天扣款</span>' : `${st.next.days} 天後扣款`}・${st.next.final ? '帳單已出' : '累計中'}</div></div>
      <div class="right amt-sm">${money(st.next.amount)}</div></div>`), true, 5)}
  ${collapsible('ov-recent', '最近刷卡', recent.length ? `${recent.length} 筆` : '', recent.slice(0, 30).map(x => txnRow(x)), false, 3)}`;
};
/* 可收合清單：預設顯示前 n 筆，點標題展開／收起 */
function collapsible(key, title, sub, rows, defOpen = false, preview = 3) {
  S.fold ||= {};
  const open = S.fold[key] ?? defOpen;
  const shown = open ? rows : rows.slice(0, preview);
  return `<section class="fold${open ? ' open' : ''}">
    <button class="fold-h" data-act="fold" data-k="${key}" aria-expanded="${open}"><span class="fold-t">${esc(title)}</span><span class="fold-s">${sub}</span>${svgI('down', 'fold-ic')}</button>
    <div class="fold-b">${shown.join('') || '<div class="empty">還沒有紀錄</div>'}
      ${!open && rows.length > preview ? `<button class="fold-more" data-act="fold" data-k="${key}">顯示全部 ${rows.length} 筆</button>` : ''}</div></section>`;
}

/* ---------- 04 投資 ---------- */
VIEWS.invest = () => {
  const sr = stockRows(), cr = cryptoRows();
  const stockV = sum(sr, r => r.value || 0), stockCost = sum(sr, r => r.costTotal || 0);
  const cryptoV = sum(cr, r => r.value || 0);
  const cryptoChg = cryptoV ? sum(cr, r => (r.value || 0) * (r.chg || 0)) / cryptoV : 0;
  const total = stockV + cryptoV;
  const range = S.invRange || 365;
  const since = new Date(); if (range < 9999) since.setDate(since.getDate() - range); else since.setFullYear(2000);
  const pts = S.snapshots.filter(s => parseYmd(s.date) >= since).sort((a, b) => String(a.date).localeCompare(String(b.date))).map(s => ({ v: num(s.stock) + num(s.crypto) }));
  if (pts.length) pts[pts.length - 1] = { v: total }; else pts.push({ v: total });
  const chg = pts[0].v ? (total - pts[0].v) / pts[0].v * 100 : 0;
  const stockPct = stockCost ? (stockV - stockCost) / stockCost * 100 : 0;
  const sub = S.invSub === 'crypto' ? 'crypto' : 'stocks';
  const group = (k, ic, name, v, p, pl) => `<button class="inv-row${sub === k ? ' on' : ''}" data-act="inv" data-sub="${k}">
      <span class="inv-ic ${k}">${ic}</span><span class="grow"><b>${name}</b><span>${money(v)}</span></span>
      <span class="inv-p ${p >= 0 ? 'pos' : 'neg'}">${p >= 0 ? '+' : ''}${p.toFixed(1)}%<small>${pl}</small></span>${svgI('chev', 'chev')}</button>`;
  const parts = [{ n: '台股', v: stockV, c: 'var(--c-stock)' }, { n: '加密貨幣', v: cryptoV, c: 'var(--c-crypto)' }];
  return `<section class="hero2 inv-hero">
      <span class="lbl">投資資產總額</span>
      <div class="hero2-num">${money(total)}</div>
      <div class="hero2-chg ${chg >= 0 ? 'pos' : 'neg'}">${svgI(chg >= 0 ? 'up' : 'arrowDown', 'ti')}${chg >= 0 ? '+' : ''}${chg.toFixed(1)}% <span>${{ 30: '近一個月', 90: '近三個月', 180: '近半年', 365: '本年', 99999: '全部期間' }[range]}報酬</span></div>
      <div class="area-box">${areaChart(pts)}</div>
      <div class="rchips">${[[30, '1M'], [90, '3M'], [180, '6M'], [365, '1Y'], [99999, 'ALL']].map(([v, l]) => `<button class="${v === range ? 'on' : ''}" data-act="inv-range" data-v="${v}">${l}</button>`).join('')}</div>
    </section>
    <div class="inv-rows">
      ${group('stocks', svgI('chart'), '台股', stockV, stockPct, '未實現')}
      ${group('crypto', '₿', '加密貨幣', cryptoV, cryptoChg, '24h')}
    </div>
    ${total > 0 ? `<section class="panel dist"><h4>資產配置</h4><div class="dist-body">${donut(parts, shortMoney(total), '投資資產')}<div class="dist-leg">${parts.map(p => `<div><i style="background:${p.c}"></i><span>${p.n}</span><b>${(p.v / total * 100).toFixed(1)}%</b></div>`).join('')}</div></div></section>` : ''}
    <div class="actions"><button class="btn outline" data-act="add-invest">＋ 新增投資項目</button></div>
    <div class="inv-detail">${VIEWS[sub]()}</div>`;
};
function openAddInvest() {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet"><span class="grab"></span><div class="sheet-head"><h3>新增投資項目</h3><button type="button" class="x" data-close>×</button></div>
    <div class="menu"><button data-act="add-stock">台股買進</button><button data-act="add-hold">加密貨幣（交易所持倉）</button><button data-act="add-wallet">鏈上錢包地址</button></div></div>`;
  m.hidden = false;
  m.onclick = e => { if (e.target === m || e.target.closest('[data-close]')) { m.hidden = true; m.innerHTML = ''; } };
}

/* ---------- 信用卡詳細：消費紀錄可收合 ---------- */
const _cardDetailView = cardDetailView;
cardDetailView = function (c) {
  const html = _cardDetailView(c);
  S.fold ||= {};
  const key = 'card-' + c.id, open = S.fold[key] ?? false;
  return html.replace('<section class="panel txn-panel">', `<section class="panel txn-panel fold-panel${open ? ' open' : ''}" data-fold="${key}">`)
    .replace(/<div class="tp-head"><h4>([^<]+)<\/h4>/, (m, h) => `<div class="tp-head"><button class="fold-h inline" data-act="fold" data-k="${key}" aria-expanded="${open}"><span class="fold-t">${h}</span><span class="fold-s" data-count></span>${svgI('down', 'fold-ic')}</button>`);
};
function applyCardFold() {
  document.querySelectorAll('.fold-panel').forEach(p => {
    const open = p.classList.contains('open');
    const rows = [...p.querySelectorAll('.txn-list .txn')];
    const vis = rows.filter(r => !r.dataset.filtered);
    const tot = sum(vis, r => num((r.querySelector('.amt-sm')?.textContent || '').replace(/[^\d.-]/g, '')));
    const cnt = p.querySelector('[data-count]'); if (cnt) cnt.textContent = `${vis.length} 筆・${S.hide ? '••••' : money(tot)}`;
    vis.forEach((r, i) => r.hidden = !open && i >= 3);
    let more = p.querySelector('.fold-more');
    if (!open && vis.length > 3) { if (!more) { more = document.createElement('button'); more.className = 'fold-more'; more.dataset.act = 'fold'; more.dataset.k = p.dataset.fold; p.querySelector('.txn-list').after(more); } more.textContent = `顯示全部 ${vis.length} 筆`; }
    else more?.remove();
    p.querySelectorAll('.tp-head .sel, .tp-head .icon-btn').forEach(x => x.hidden = !open);
  });
}
const _filterTxnList = filterTxnList;
filterTxnList = function () {
  const q = ($('.txn-q')?.value || '').trim().toLowerCase(), cat = $('[data-catfilter]')?.value || '';
  document.querySelectorAll('.txn-list .txn').forEach(r => { const hide = (q && !r.dataset.text.includes(q)) || (cat && r.dataset.cat !== cat); if (hide) r.dataset.filtered = '1'; else delete r.dataset.filtered; r.hidden = !!hide; });
  applyCardFold();
};

/* ---------------- events ---------------- */
document.addEventListener('click', async e => {
  const tabBtn = e.target.closest('.tabs [data-tab]');
  if (tabBtn) { if (tabBtn.dataset.tab === 'cards' && S.tab === 'cards') S.cardOpen = null; go(tabBtn.dataset.tab); return; }
  const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'INPUT') return;
  const id = el.dataset.id, act = el.dataset.act;
  const find = t => S[t].find(x => x.id === id);
  try {
    switch (act) {
      case 'toggle-hide': S.hide = !S.hide; localStorage.setItem('ac_hide', S.hide ? '1' : '0'); render(); break;
      case 'refresh': toast('更新中…'); await refreshAll(true); toast('已更新'); break;
      case 'goto': go(el.dataset.tab); break;
      case 'fab': openFab(); break;
      case 'theme': applyTheme(el.dataset.theme); render(); break;
      case 'recommend': openRecommend(); break;
      case 'paid-bill': formPaidBill(find('cards')); break;
      case 'import-txn': openImport(); break;
      case 'add-recv': formRecv(); break;
      case 'edit-recv': formRecv(find('receivables')); break;
      case 'got-recv': e.stopPropagation(); formReceive(find('receivables')); break;
      case 'add-liab': formLiab(); break;
      case 'edit-liab': formLiab(find('liabilities')); break;
      case 'preset-cards': await addPresetCards(true); render(); break;
      case 'add-rule': formRule(S.cards.find(c => c.id === el.dataset.card)); break;
      case 'edit-rule': formRule(S.cards.find(c => c.id === el.dataset.card), +el.dataset.i); break;
      case 'toggle-rule': {
        e.stopPropagation();
        const c = S.cards.find(x => x.id === el.dataset.card); const rules = (c.rewards || []).slice();
        rules[+el.dataset.i] = { ...rules[+el.dataset.i], on: rules[+el.dataset.i].on === false };
        await upd('cards', c.id, { rewards: rules }); render(); break;
      }
      case 'preset-rules': {
        const c = S.cards.find(x => x.id === el.dataset.card);
        if ((c.rewards || []).length && !confirm('會覆蓋這張卡目前的回饋規則，確定？')) break;
        await upd('cards', c.id, { rewards: presetRewardsFor(c) }); render(); toast('已套用建議回饋規則'); break;
      }
      case 'inv': S.invSub = el.dataset.sub; localStorage.setItem('ac_inv', S.invSub); render(); break;
      case 'open-card': S.cardOpen = id; go('cards'); break;
      case 'cards-home': S.cardOpen = null; render(); scrollTo(0, 0); break;
      case 'card-step': { const i = S.cards.findIndex(c => c.id === S.cardOpen); S.cardOpen = S.cards[(i + (+el.dataset.d) + S.cards.length) % S.cards.length].id; render(); break; }
      case 'transfer': formTransfer(); break;
      case 'money-in-out': formMoney('in-out'); break;
      case 'fold': { const k = el.dataset.k; S.fold ||= {}; S.fold[k] = !(S.fold[k] ?? ({ 'ov-due': true })[k] ?? false); render(); break; }
      case 'map-toggle': S.mapOpen = !S.mapOpen; render(); break;
      case 'acc-other': S.accTab = 'other'; go('bank'); break;
      case 'inv-range': S.invRange = +el.dataset.v; render(); break;
      case 'add-invest': openAddInvest(); break;
      case 'money-set': formMoney('set'); break;
      case 'acc-tab': S.accTab = el.dataset.t; render(); break;
      case 'card-filter': S.cardFilter = el.dataset.f; render(); break;
      case 'card-tab': S.cardTab = el.dataset.t; render(); break;
      case 'card-more': openCardMore(find('cards')); break;
      case 'add-liab-card': formLiab(null, { kind: 'installment', card_id: el.dataset.card }); break;
      case 'txn-search': { const q = $('.txn-q'); q.hidden = !q.hidden; if (!q.hidden) q.focus(); else { q.value = ''; filterTxnList(); } break; }
      case 'fab-acc': formMoney('in-out'); break;
      case 'add-acc': formAccount(); break;
      case 'edit-acc': formAccount(find('accounts')); break;
      case 'adjust-acc': e.stopPropagation(); formAdjust(find('accounts')); break;
      case 'add-card': formCard(); break;
      case 'edit-card': formCard(find('cards')); break;
      case 'add-txn': formTxn(null, { card_id: el.dataset.card || S.cards[0]?.id || '' }); break;
      case 'edit-txn': formTxn(find('transactions')); break;
      case 'add-stock': formStock(); break;
      case 'edit-stock': formStock(find('stocks')); break;
      case 'open-stock': openStock(el.dataset.code); break;
      case 'buy-stock': { const r = stockRows().find(x => x.code === el.dataset.code); formStock(null, { code: r.code, name: r.name }); break; }
      case 'merge-stock': await mergeStock(el.dataset.code); $('#modal').hidden = true; $('#modal').innerHTML = ''; render(); break;
      case 'add-hold': formHolding(); break;
      case 'edit-hold': formHolding(find('crypto_holdings')); break;
      case 'add-wallet': formWallet(); break;
      case 'edit-wallet': formWallet(find('wallets')); break;
      case 'gen-token': if (!S.token || confirm('舊金鑰會失效，確定重新產生？')) await genToken(); break;
      case 'copy-token': await navigator.clipboard.writeText(S.token); toast('已複製'); break;
      case 'signout': await sb.auth.signOut(); location.reload(); break;
      case 'seed': await seed(); break;
      case 'export': {
        const data = {}; TABLES.forEach(t => data[t] = S[t]);
        const blob = new Blob([JSON.stringify({ app: 'asset-compass', at: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `asset-compass-${todayStr()}.json`; a.click();
        break;
      }
    }
  } catch (err) { toast('出錯了：' + (err.message || err)); console.error(err); }
});
document.addEventListener('change', e => {
  if (e.target.matches('[data-range]')) { S.range = +e.target.value; render(); }
  else if (e.target.matches('[data-accfilter]')) { S.accFilter = e.target.value; render(); }
  else if (e.target.matches('[data-catfilter]')) filterTxnList();
});
document.addEventListener('input', e => { if (e.target.matches('.txn-q')) filterTxnList(); });
document.addEventListener('change', async e => {
  if (e.target.dataset.act !== 'import') return;
  try {
    const j = JSON.parse(await e.target.files[0].text());
    if (!j.data || !confirm('匯入會覆蓋這個瀏覽器的資料，確定？')) return;
    local.save(j.data); await loadAll(); await refreshAll(true); toast('已匯入');
  } catch (err) { toast('匯入失敗：' + err.message); }
});

/* ---------------- boot ---------------- */
async function refreshAll(force) {
  await loadFX(force);
  await Promise.all([loadQuotes(force), loadWallets(force)]);
  await loadPrices(force);
  render();
  await saveSnapshot();
}

async function startApp() {
  $('#auth').hidden = true; $('#app').hidden = false;
  await loadAll();
  await addPresetCards().catch(e => { console.warn('preset', e); toast('預設信用卡建立失敗：' + (e.message || e), 6000); });
  render();
  await loadToken().catch(() => { });
  await loadFX();
  await autoFees().catch(e => console.warn('fees', e));
  await runInstallments().catch(e => console.warn('installments', e));
  await runSettlements();
  render();
  handleHash();
  await refreshAll(false);
}

async function boot() {
  applyTheme(localStorage.getItem('ac_theme') || 'ivory');
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
  if (!CLOUD) return startApp();
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const { data: { session } } = await sb.auth.getSession();
  if (session) { user = session.user; return startApp(); }
  $('#auth').hidden = false;
  const form = $('#authForm'), errEl = $('#authErr');
  const go = async signup => {
    errEl.textContent = '';
    const email = form.email.value.trim(), password = form.password.value;
    if (!email || password.length < 6) { errEl.textContent = '請填 Email 與至少 6 碼密碼'; return; }
    const { data, error } = signup ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
    if (error) { errEl.textContent = error.message; return; }
    if (!data.session) { errEl.textContent = '註冊成功，請到信箱點確認連結後再登入。'; return; }
    user = data.session.user; startApp();
  };
  form.onsubmit = e => { e.preventDefault(); go(false); };
  $('#signupBtn').onclick = () => go(true);
}

window.addEventListener('hashchange', handleHash);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#app').hidden) { loadAll().then(runInstallments).then(runSettlements).then(() => refreshAll(false)).catch(() => { }); } });
boot();

/* ================================================================
 * 永夜圖書館主題：頁首小標、閱覽證、預設套用
 * ================================================================ */
THEME_INFO.library = ['永夜圖書館', 'LIBRARY', '燭光暗木・古金典藏'];
THEMES.unshift(['library', '永夜圖書館', ['#0e0a07', '#c9a46a', '#efe3cb']]);
try { if (!localStorage.getItem('ac_lib_v1')) { localStorage.setItem('ac_lib_v1', '1'); applyTheme('library'); } } catch (_) { }
const LIB_HEAD = {
  overview: ['01', 'Overview · Compass Hall', '資產總覽'],
  bank: ['02', 'Accounts · Treasury', '帳戶'],
  cards: ['03', 'Cards · Ledger Room', '信用卡'],
  invest: ['04', 'Investments · Three Worlds', '投資'],
  settings: ['05', 'Settings · Archive', '設定'],
};
function libHead(tab) {
  const h = LIB_HEAD[tab]; if (!h) return '';
  if (tab === 'cards' && S.cardOpen) return '';
  return `<header class="lib-head"><span class="eb">${h[0]} / ${h[1]}</span><span class="ttl">${h[2]}</span><span class="lib-rule">✦</span></header>`;
}
function libEmblem() {
  let t = '';
  for (let i = 0; i < 32; i++) { const a = i * 11.25 * Math.PI / 180, r0 = i % 4 ? 31 : 28; t += `<line x1="${(37 + r0 * Math.sin(a)).toFixed(1)}" y1="${(37 - r0 * Math.cos(a)).toFixed(1)}" x2="${(37 + 33 * Math.sin(a)).toFixed(1)}" y2="${(37 - 33 * Math.cos(a)).toFixed(1)}"/>`; }
  return `<svg viewBox="0 0 74 74" aria-hidden="true" fill="none" stroke="#c9a46a" stroke-width=".8">
    <circle cx="37" cy="37" r="35"/><circle cx="37" cy="37" r="26" stroke-opacity=".5"/>${t}
    <path d="M37 9 41 33 65 37 41 41 37 65 33 41 9 37 33 33Z" fill="#c9a46a" fill-opacity=".9" stroke="none"/>
    <path d="M37 9 39 35 37 37ZM65 37 39 39 37 37ZM37 65 35 39 37 37ZM9 37 35 35 37 37Z" fill="#5a3d1c" stroke="none" opacity=".55"/>
    <path d="M37 19 39.5 34.5 55 37 39.5 39.5 37 55 34.5 39.5 19 37 34.5 34.5Z" transform="rotate(45 37 37)" fill="#8a6d43" stroke="none" opacity=".8"/>
    <circle cx="37" cy="37" r="3" fill="#1a120a" stroke="#e3c58e"/></svg>`;
}
const _settingsView = VIEWS.settings;
VIEWS.settings = () => _settingsView() + `<section class="lib-card">${libEmblem()}<div><span class="eb">READER ACCESS</span><span class="t">妳的閱覽證</span><span class="sig">Rysena Veylorn</span><span class="h">@auccelis</span></div></section>`;
const _render0 = render;
render = function () {
  _render0();
  const v = $('#view');
  if (v && !v.querySelector(':scope > .lib-head')) v.insertAdjacentHTML('afterbegin', libHead(S.tab));
};

/* ================================================================
 * 夜苑鎏金 VERDANT：上方分頁、日期、資產走勢、放射式記帳選單
 * ================================================================ */
THEME_INFO.verdant = ['星象午夜', 'ASTRAL', '午夜墨黑・松綠・香檳金'];
THEMES.unshift(['verdant', '星象午夜', ['#111B20', '#C5A572', '#F1E9DB']]);
try { if (!localStorage.getItem('ac_ver_v1')) { localStorage.setItem('ac_ver_v1', '1'); localStorage.setItem('ac_lib_v1', '1'); applyTheme('verdant'); } } catch (_) { }
const isVer = () => true;   // 所有主題都用星象版面
const isStar = () => true;
function verChrome() {
  const top = $('header.top');
  if (top && !$('.toptabs')) {
    top.insertAdjacentHTML('afterend', `<div class="hdate"></div><nav class="toptabs" aria-label="分頁">${[['overview', '總覽'], ['bank', '帳戶'], ['cards', '信用卡'], ['invest', '投資']].map(([k, l]) => `<button data-act="goto" data-tab="${k}">${l}</button>`).join('')}</nav>`);
  }
  const d = new Date(), wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const hd = $('.hdate'); if (hd) hd.textContent = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}  ${wd}`;
  document.querySelectorAll('.toptabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
}
function verTrend() {
  const t = splitTotals(), range = S.range || 30;
  const since = new Date(); since.setDate(since.getDate() - range);
  const pts = S.snapshots.filter(s => parseYmd(s.date) >= since).sort((a, b) => String(a.date).localeCompare(String(b.date))).map(s => ({ v: num(s.net) }));
  if (pts.length) pts[pts.length - 1] = { v: t.net }; else pts.push({ v: t.net });
  const first = pts[0].v, chg = first ? (t.net - first) / Math.abs(first) * 100 : 0;
  return `<section class="panel ver-trend"><div class="tp-head"><h4>資產走勢</h4><span class="vt-r"><span class="meta ${chg >= 0 ? 'pos' : 'neg'}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span><span class="sel mini"><select data-range>${[[30, '近一個月'], [90, '近三個月'], [365, '近一年']].map(([v, l]) => `<option value="${v}" ${v === range ? 'selected' : ''}>${l}</option>`).join('')}</select>${svgI('down', 'sel-ic')}</span></span></div><div class="area-box sm">${areaChart(pts)}</div></section>`;
}
const _ovView = VIEWS.overview;
VIEWS.overview = () => {
  const h = _ovView();
  if (!isVer() || S.mapOpen) return h;
  const k = h.indexOf('</section>');
  return k < 0 ? h : h.slice(0, k + 10) + verTrend() + h.slice(k + 10);
};
const _renderL = render;
render = function () { _renderL(); verChrome(); };

/* 放射式記帳選單（夜苑主題） */
const _openFabSheet = openFab;
function closeRadial() { const r = $('.fab-radial'); if (r) r.remove(); document.body.classList.remove('fab-open'); }
openFab = function () {
  if (!isVer()) return _openFabSheet();
  if ($('.fab-radial')) return closeRadial();
  const items = [['fab-acc', 'bank', '帳戶', -118, -46], ['add-txn', 'card', '記帳', -62, -128], ['transfer', 'swap', '轉帳', 62, -128], ['add-invest', 'chart', '投資', 118, -46]];
  document.body.insertAdjacentHTML('beforeend', `<div class="fab-radial">${items.map(([a, ic, l, x, y]) => `<button class="fr-btn" data-act="${a}" style="--x:${x}px;--y:${y}px">${svgI(ic)}<span>${l}</span></button>`).join('')}<button class="fr-more" data-act="fab-sheet">更多記帳方式</button></div>`);
  document.body.classList.add('fab-open');
  const r = $('.fab-radial');
  requestAnimationFrame(() => r.classList.add('show'));
  r.addEventListener('click', e => { if (!e.target.closest('[data-act]') || e.target.closest('[data-act]')) setTimeout(closeRadial, 0); });
};
document.addEventListener('click', e => { if (e.target.closest('[data-act="fab-sheet"]')) { closeRadial(); _openFabSheet(); } });

/* ---------- 夜苑：金屬星盤 ---------- */
const _compassDialStd = compassDial;
compassDial = function (t) {
  if (!isVer()) return _compassDialStd(t);
  const P = (r, a) => [r * Math.cos(a * DEG), r * Math.sin(a * DEG)], f = n => n.toFixed(1);
  let ticks = '';
  for (let i = 0; i < 180; i++) {
    const a = i * 2, M = i % 15 === 0, m = i % 5 === 0;
    const [x0, y0] = P(M ? 141 : m ? 145 : 148, a), [x1, y1] = P(151, a);
    ticks += `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" class="vt${M ? ' M' : m ? ' m' : ''}"/>`;
  }
  const segs = [[t.bankOnly, 'var(--c-bank)'], [t.invest, 'var(--c-stock)'], [t.other, 'var(--c-recv)']].filter(x => x[0] > 0);
  const tot = sum(segs, x => x[0]) || 1;
  let a0 = -90, ring = '';
  for (const [v, c] of segs) {
    const sw = v / tot * 360;
    ring += sw >= 359.5 ? `<circle r="128" class="vr" style="stroke:${c}"/>` : `<path d="${arcPath(128, a0 + 1.5, a0 + sw - 1.5)}" class="vr" style="stroke:${c}"/>`;
    a0 += sw;
  }
  const dsw = t.gross > 0 ? Math.min(359, (t.debt + t.liab) / t.gross * 360) : 0;
  const debt = dsw > .5 ? `<path d="${arcPath(117, -90, -90 + dsw)}" class="vr debt"/>` : '';
  const star = (len, w, rot) => `<g transform="rotate(${rot})"><path d="M0 ${-len} L${w} 0 L0 0Z" fill="url(#vgA)"/><path d="M0 ${-len} L${-w} 0 L0 0Z" fill="url(#vgB)"/></g>`;
  let rose = '';
  for (const r of [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5]) rose += star(70, 5, r);
  for (const r of [45, 135, 225, 315]) rose += star(100, 9, r);
  for (const r of [0, 90, 180, 270]) rose += star(138, 12, r);
  let stars = '';
  const rnd = (s => () => (s = (s * 9301 + 49297) % 233280) / 233280)(7);
  for (let i = 0; i < 26; i++) { const a = rnd() * 360, r = 30 + rnd() * 75, [x, y] = P(r, a); stars += `<circle cx="${f(x)}" cy="${f(y)}" r="${(rnd() * 1.1 + .4).toFixed(2)}"/>`; }
  return `<svg class="vdial" viewBox="-170 -170 340 340" role="img" aria-label="資產羅盤：外環是資產比例，內側紅線是負債">
    <defs>
      ${isStar() ? `<linearGradient id="vgold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:rgb(var(--sk-hi))"/><stop offset=".28" style="stop-color:rgb(var(--sk-acc))"/><stop offset=".5" style="stop-color:rgb(var(--sk-hi))"/><stop offset=".75" style="stop-color:rgb(var(--sk-lo))"/><stop offset="1" style="stop-color:rgb(var(--sk-hi))"/></linearGradient>
      <linearGradient id="vgA" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:rgb(var(--sk-hi))"/><stop offset="1" style="stop-color:rgb(var(--sk-acc))"/></linearGradient>
      <linearGradient id="vgB" x1="1" y1="0" x2="0" y2="0"><stop offset="0" style="stop-color:rgb(var(--sk-lo))"/><stop offset="1" style="stop-color:rgb(var(--sk-d2))"/></linearGradient>
      <radialGradient id="vface" cx="50%" cy="42%" r="62%"><stop offset="0" style="stop-color:rgb(var(--sk-d2))"/><stop offset=".7" style="stop-color:rgb(var(--sk-d1))"/><stop offset="1" style="stop-color:rgb(var(--sk-d0))"/></radialGradient>
      <radialGradient id="vcore" cx="50%" cy="38%" r="65%"><stop offset="0" style="stop-color:rgb(var(--sk-d1))"/><stop offset="1" style="stop-color:rgb(var(--sk-d0))"/></radialGradient>
      <linearGradient id="vneedle" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:rgb(var(--sk-hi))"/><stop offset=".5" style="stop-color:rgb(var(--sk-hi))"/><stop offset=".5" style="stop-color:rgb(var(--sk-lo))"/><stop offset="1" style="stop-color:rgb(var(--sk-tx))"/></linearGradient>`
      : `<linearGradient id="vgold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:rgb(var(--sk-acc))"/><stop offset=".5" style="stop-color:rgb(var(--sk-acc))"/><stop offset="1" style="stop-color:rgb(var(--sk-acc))"/></linearGradient>
      <linearGradient id="vgA" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:rgb(var(--sk-hi))"/><stop offset="1" style="stop-color:rgb(var(--sk-acc))"/></linearGradient>
      <linearGradient id="vgB" x1="1" y1="0" x2="0" y2="0"><stop offset="0" style="stop-color:rgb(var(--sk-lo))"/><stop offset="1" style="stop-color:rgb(var(--sk-d2))"/></linearGradient>
      <radialGradient id="vface" cx="50%" cy="42%" r="62%"><stop offset="0" style="stop-color:rgb(var(--sk-d2))"/><stop offset="1" style="stop-color:rgb(var(--sk-d1))"/></radialGradient>
      <radialGradient id="vcore" cx="50%" cy="38%" r="65%"><stop offset="0" style="stop-color:rgb(var(--sk-d1))"/><stop offset="1" style="stop-color:rgb(var(--sk-d1))"/></radialGradient>`}
      <filter id="vglow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <circle r="166" fill="none" style="stroke:rgba(var(--sk-hi),.18)" stroke-width="8" filter="url(#vglow)"/>
    <circle r="160" fill="url(#vface)" stroke="url(#vgold)" stroke-width="2"/>
    <circle r="154" fill="none" stroke="url(#vgold)" stroke-width=".9" opacity=".8"/>
    ${ticks}
    <circle r="138" fill="none" stroke="url(#vgold)" stroke-width="1.4"/>
    <g class="vorbit"><ellipse rx="150" ry="58" transform="rotate(28)"/><ellipse rx="150" ry="58" transform="rotate(-28)"/><ellipse rx="150" ry="58" transform="rotate(90)"/></g>
    <circle r="128" class="vtrack"/>${ring}${debt}
    <circle r="110" fill="none" stroke="url(#vgold)" stroke-width="1.1"/>
    <g class="vstars">${stars}</g>
    <g class="vrose" opacity=".5">${rose}</g>
    <circle r="88" fill="url(#vcore)" stroke="url(#vgold)" stroke-width="1.6"/>
    <circle r="82" fill="none" style="stroke:rgba(var(--sk-hi),.45)" stroke-width=".7"/>
    <circle r="82" fill="none" style="stroke:rgba(var(--sk-hi),.55)" stroke-width="3" stroke-dasharray=".8 6.2"/>
    ${isStar() ? `<g class="vneedle"><path d="M0 -206 L7 -150 L0 -92 L-7 -150Z" fill="url(#vneedle)"/><path d="M0 206 L7 150 L0 92 L-7 150Z" fill="url(#vneedle)"/>
      <path d="M0 -226 L3 -212 L14 -208 L3 -204 L0 -190 L-3 -204 L-14 -208 L-3 -212Z" style="fill:rgb(var(--sk-hi))"/>
      <circle cy="-150" r="3" style="fill:rgb(var(--sk-d1));stroke:rgb(var(--sk-hi))"/><circle cy="150" r="3" style="fill:rgb(var(--sk-d1));stroke:rgb(var(--sk-hi))"/></g>` : ''}
  </svg>`;
};
const _ovView2 = VIEWS.overview;
VIEWS.overview = () => {
  let h = _ovView2();
  if (!isVer()) return h;
  const t = splitTotals(), range = S.range || 30;
  const since = new Date(); since.setDate(since.getDate() - range);
  const snaps = S.snapshots.filter(s => parseYmd(s.date) >= since).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const first = snaps.length ? num(snaps[0].net) : t.net, chg = first ? (t.net - first) / Math.abs(first) * 100 : 0;
  const center = `<div class="vcenter"><span class="vc-l">總資產</span><b class="vc-n">${money(t.net)}</b><span class="vc-c ${chg >= 0 ? 'pos' : 'neg'}">${chg >= 0 ? '↑' : '↓'} ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span><span class="vc-s">${range === 30 ? '本月' : range === 90 ? '近三個月' : '近一年'}變動</span></div>`;
  return h.replace('<div class="dial-box">', '<div class="dial-box">' + center);
};

/* ---------- 星圖秘境（照設計稿） ---------- */
THEME_INFO.starmap = ['星圖秘境', 'STARMAP', '星空羅盤・鎏金描邊'];
THEMES.unshift(['starmap', '星圖秘境', ['#0d181a', '#d9b878', '#f1ece0']]);
try { if (!localStorage.getItem('ac_star_v1')) { localStorage.setItem('ac_star_v1', '1'); applyTheme('starmap'); } } catch (_) { }


/* ================================================================
 * 星象 v5：設計稿總覽（大圓節點、四向金針、新月與葉枝、月份走勢）
 * ================================================================ */
const _dialV4 = compassDial;
compassDial = function (t) {
  const P = (r, a) => [r * Math.cos(a * DEG), r * Math.sin(a * DEG)], f = n => n.toFixed(1);
  const C = k => `rgb(var(--sk-${k}))`, A = (k, a) => `rgba(var(--sk-${k}),${a})`;
  let ticks = '';
  for (let i = 0; i < 120; i++) { const a = i * 3, M = i % 10 === 0; const [x0, y0] = P(M ? 152 : 156, a), [x1, y1] = P(160, a); ticks += `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" style="stroke:${A('acc', M ? .8 : .4)};stroke-width:${M ? 1.4 : .7}"/>`; }
  const segs = [[t.bankOnly, 'var(--c-bank)'], [t.invest, 'var(--c-stock)'], [t.other, 'var(--c-recv)']].filter(x => x[0] > 0);
  const tot = sum(segs, x => x[0]) || 1;
  let a0 = -90, ring = '';
  for (const [v, c] of segs) { const sw = v / tot * 360; ring += sw >= 359.5 ? `<circle r="116" class="v5r" style="stroke:${c}"/>` : `<path d="${arcPath(116, a0 + 2, a0 + sw - 2)}" class="v5r" style="stroke:${c}"/>`; a0 += sw; }
  const dsw = t.gross > 0 ? Math.min(359, (t.debt + t.liab) / t.gross * 360) : 0;
  const debt = dsw > .5 ? `<path d="${arcPath(104, -90, -90 + dsw)}" class="v5r debt"/>` : '';
  // 葉枝：沿外圈左下、右上各一串
  const leaf = (x, y, L, ang) => { const w = L * .36; return `<path transform="translate(${f(x)} ${f(y)}) rotate(${f(ang)})" d="M0 0 Q${f(L * .5)} ${f(-w)} ${f(L)} 0 Q${f(L * .5)} ${f(w)} 0 0Z M0 0 L${f(L * .92)} 0" class="v5leaf"/>`; };
  let leaves = '';
  for (const [from, to, side] of [[200, 248, 1], [20, 68, -1], [110, 140, 1], [290, 320, -1]]) {
    let path = '';
    for (let a = from; a <= to; a += 2) { const [x, y] = P(172, a); path += (path ? ' L' : 'M') + f(x) + ' ' + f(y); }
    leaves += `<path d="${path}" class="v5stem"/>`;
    for (let a = from + 4, i = 0; a <= to; a += 7, i++) { const [x, y] = P(172, a); leaves += leaf(x, y, 15 + (i % 3) * 3, a + 90 + (i % 2 ? 50 : -50) * side); }
  }
  const moon = (x, y, r, rot) => `<path transform="translate(${x} ${y}) rotate(${rot})" d="M0 ${-r} A${r} ${r} 0 1 0 0 ${r} A${r * .78} ${r * .78} 0 1 1 0 ${-r}Z" class="v5moon"/>`;
  let stars = '';
  const rnd = (sd => () => (sd = (sd * 9301 + 49297) % 233280) / 233280)(3);
  for (let i = 0; i < 34; i++) { const a = rnd() * 360, r = 92 + rnd() * 75, [x, y] = P(r, a); stars += `<circle cx="${f(x)}" cy="${f(y)}" r="${(rnd() * 1.2 + .3).toFixed(2)}"/>`; }
  const spark = (x, y, s) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -10 L2 -2 L10 0 L2 2 L0 10 L-2 2 L-10 0 L-2 -2Z" class="v5spark"/>`;
  const spike = (rot, r0, r1, w) => `<path transform="rotate(${rot})" d="M0 ${-r1} L${w} ${-(r0 + r1) / 2} L0 ${-r0} L${-w} ${-(r0 + r1) / 2}Z" fill="url(#v5n)"/>`;
  let rose = '';
  for (const r of [45, 135, 225, 315]) rose += spike(r, 0, 70, 6);
  return `<svg class="vdial v5" viewBox="-170 -170 340 340" role="img" aria-label="資產羅盤：環是資產比例，內側紅線是負債">
    <defs>
      <linearGradient id="v5g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:${C('hi')}"/><stop offset=".3" style="stop-color:${C('lo')}"/><stop offset=".55" style="stop-color:${C('hi')}"/><stop offset=".8" style="stop-color:${C('lo')}"/><stop offset="1" style="stop-color:${C('acc')}"/></linearGradient>
      <linearGradient id="v5n" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:${C('hi')}"/><stop offset=".5" style="stop-color:${C('acc')}"/><stop offset=".5" style="stop-color:${C('lo')}"/><stop offset="1" style="stop-color:${C('lo')}"/></linearGradient>
      <radialGradient id="v5f" cx="50%" cy="45%" r="60%"><stop offset="0" style="stop-color:${C('d2')}"/><stop offset="1" style="stop-color:${C('d0')}"/></radialGradient>
      <radialGradient id="v5c" cx="50%" cy="35%" r="70%"><stop offset="0" style="stop-color:${C('d1')}"/><stop offset="1" style="stop-color:${C('d0')}"/></radialGradient>
    </defs>
    <circle r="168" style="fill:${A('d0', .35)};stroke:${A('acc', .35)};stroke-width:.8"/>
    <g class="v5stars">${stars}</g>
    ${leaves}
    <circle r="160" fill="url(#v5f)" style="fill-opacity:.92;stroke:url(#v5g);stroke-width:2.2"/>
    ${ticks}
    <circle r="148" style="fill:none;stroke:${A('acc', .45)};stroke-width:.8"/>
    <circle r="130" style="fill:none;stroke:url(#v5g);stroke-width:1.6"/>
    <circle r="116" style="fill:none;stroke:${A('d0', .65)};stroke-width:16"/>${ring}${debt}
    <circle r="102" style="fill:none;stroke:url(#v5g);stroke-width:1.2"/>
    ${moon(122, -118, 12, 30)}
    ${spark(-96, -96, .7)}${spark(110, 90, .55)}${spark(-130, 10, .4)}
    <g opacity=".55">${rose}</g>
    <circle r="86" fill="url(#v5c)" style="stroke:url(#v5g);stroke-width:2.4"/>
    <circle r="80" style="fill:none;stroke:${A('acc', .4)};stroke-width:.7"/>
    ${spike(0, 86, 128, 6)}${spike(90, 86, 128, 6)}${spike(180, 86, 128, 6)}${spike(270, 86, 128, 6)}
    ${spike(0, 158, 200, 6)}${spike(180, 158, 196, 5)}
    <path d="M0 -222 L3.5 -210 L15 -206 L3.5 -202 L0 -190 L-3.5 -202 L-15 -206 L-3.5 -210Z" style="fill:${C('hi')}"/>
    <text y="-174" class="v5cl">N</text><text y="182" class="v5cl">S</text>
  </svg>`;
};
/* 節點文字：銀行存款 */
const _ovView5 = VIEWS.overview;
VIEWS.overview = () => _ovView5().replace('<span class="cn-t">銀行</span>', '<span class="cn-t">銀行存款</span>');
/* 資產走勢：近 6 個月，月份刻度 */
verTrend = function () {
  const t = splitTotals(), now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ y: d.getFullYear(), m: d.getMonth(), v: null }); }
  const snaps = S.snapshots.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const s of snaps) { const d = parseYmd(s.date); const mm = months.find(x => x.y === d.getFullYear() && x.m === d.getMonth()); if (mm) mm.v = num(s.net); }
  months[5].v = t.net;
  const pts = months.filter(x => x.v != null);
  const first = pts[0].v, chg = first ? (t.net - first) / Math.abs(first) * 100 : 0;
  const W = 320, H = 120, L = 26, R = 10, T = 12, B = 22;
  const vals = pts.map(p => p.v), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || Math.max(1, Math.abs(hi) * .1);
  const X = i => L + (W - L - R) * i / 5, Y = v => T + (H - T - B) * (1 - (v - lo) / span);
  const idx = months.map((x, i) => x.v != null ? i : -1).filter(i => i >= 0);
  const line = idx.map((i, k) => `${k ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(months[i].v).toFixed(1)}`).join(' ');
  const area = idx.length > 1 ? `${line} L${X(idx[idx.length - 1]).toFixed(1)} ${H - B} L${X(idx[0]).toFixed(1)} ${H - B}Z` : '';
  const grid = [0, 1, 2, 3].map(k => { const y = T + (H - T - B) * k / 3; return `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="v5grid"/><text x="${L - 5}" y="${y + 3}" class="v5yl">${S.hide ? '' : fmtShort(hi - span * k / 3)}</text>`; }).join('');
  const labels = months.map((x, i) => `<text x="${X(i).toFixed(1)}" y="${H - 6}" class="v5ml">${x.m + 1}月</text>`).join('');
  const dots = idx.map(i => `<circle cx="${X(i).toFixed(1)}" cy="${Y(months[i].v).toFixed(1)}" r="3" class="v5dot"/>`).join('');
  return `<section class="panel ver-trend"><div class="tp-head"><h4>資產走勢</h4><span class="vt-r"><span class="meta">近 6 個月</span><span class="v5chg ${chg >= 0 ? 'pos' : 'neg'}">${chg >= 0 ? '↑' : '↓'} ${Math.abs(chg).toFixed(2)}%</span></span></div>
    <svg class="v5chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="近 6 個月淨資產走勢">
      <defs><linearGradient id="v5a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:rgba(var(--sk-acc),.45)"/><stop offset="1" style="stop-color:rgba(var(--sk-acc),0)"/></linearGradient></defs>
      ${grid}${area ? `<path d="${area}" fill="url(#v5a)"/>` : ''}<path d="${line}" class="v5line"/>${dots}${labels}</svg>
    ${idx.length < 2 ? '<p class="meta v5note">每天開 App 會自動記一筆，下個月起就會連成走勢線</p>' : ''}</section>`;
};
function fmtShort(v) { const a = Math.abs(v); return (v < 0 ? '-' : '') + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? Math.round(a / 1e3) + 'K' : Math.round(a)); }

/* 所有主題都註冊完後，再套用一次使用者選的主題 */
try { applyTheme(localStorage.getItem('ac_theme') || 'starmap'); if (typeof render === 'function' && S.user !== undefined) render(); } catch (_) { }

/* ================================================================
 * 北歐主題 Nordic Calm／Nordic Dusk：乾淨的現代金融介面
 * ================================================================ */
THEME_INFO.nordic = ['北歐靜謐', 'NORDIC CALM', '奶油白 × 鼠尾草綠'];
THEME_INFO.dusk = ['北歐暮色', 'NORDIC DUSK', '墨綠 × 香檳金'];
THEMES.unshift(['nordic', '北歐靜謐', ['#F8F7F3', '#6B8F7A', '#26302B']], ['dusk', '北歐暮色', ['#0E2B2A', '#C9A96B', '#EEF0EA']]);
const isNordic = () => ['nordic', 'dusk'].includes(document.documentElement.dataset.theme);
try { if (!localStorage.getItem('ac_nordic_v1')) { localStorage.setItem('ac_nordic_v1', '1'); applyTheme('nordic'); } } catch (_) { }

function nordDial(t) {
  const f = n => n.toFixed(2), DEG2 = Math.PI / 180;
  const cardDebt = t.debt + t.liab;
  const parts = [['bank', t.bankOnly], ['stock', t.invest], ['debt', cardDebt], ['recv', t.other]];
  const tot = sum(parts, p => Math.abs(p[1])) || 1;
  // 順序：銀行（左上）→ 投資（右上）→ 其他（右下）→ 信用卡（左下），從正上方順時針
  const order = [['stock', t.invest], ['recv', t.other], ['debt', cardDebt], ['bank', t.bankOnly]];
  let a0 = 0, segs = '';
  const arc = (r, s, e) => { const p = a => [r * Math.sin(a * DEG2), -r * Math.cos(a * DEG2)]; const [x0, y0] = p(s), [x1, y1] = p(e); return `M${f(x0)} ${f(y0)}A${r} ${r} 0 ${e - s > 180 ? 1 : 0} 1 ${f(x1)} ${f(y1)}`; };
  for (const [k, v] of order) { const sw = Math.abs(v) / tot * 360; if (sw < .5) continue; segs += sw >= 359.5 ? `<circle r="110" class="nseg" style="stroke:var(--c-${k})"/>` : `<path d="${arc(110, a0 + .8, a0 + sw - .8)}" class="nseg" style="stroke:var(--c-${k})"/>`; a0 += sw; }
  if (!segs) segs = '<circle r="110" class="nseg empty"/>';
  const lbl = [['N', 0, -144], ['E', 146, 4], ['S', 0, 150], ['W', -146, 4]].map(([c, x, y]) => `<text x="${x}" y="${y}" class="ncl">${c}</text>`).join('');
  const ticks = [0, 90, 180, 270].map(a => `<line x1="0" y1="-128" x2="0" y2="-134" transform="rotate(${a})" class="ntk"/>`).join('');
  const needle = document.documentElement.dataset.theme === 'dusk'
    ? `<g class="nneedle"><path d="M0 -158 L5 -96 L0 -88 L-5 -96Z"/><path d="M0 158 L5 96 L0 88 L-5 96Z"/><path d="M-158 0 L-96 4 L-88 0 L-96 -4Z" opacity=".7"/><path d="M158 0 L96 4 L88 0 L96 -4Z" opacity=".7"/></g>` : '';
  return `<svg class="ndial" viewBox="-160 -160 320 320" role="img" aria-label="資產比例圓環">
    <defs><radialGradient id="ncore" cx="50%" cy="40%" r="65%"><stop offset="0" style="stop-color:var(--n-core-hi)"/><stop offset="1" style="stop-color:var(--n-core)"/></radialGradient></defs>
    ${ticks}${lbl}${needle}<circle r="110" class="ntrack"/>${segs}
    <circle r="88" fill="url(#ncore)" class="ncore"/>
    <path d="M0 -76 L3.5 -67 L12 -64 L3.5 -61 L0 -52 L-3.5 -61 L-12 -64 L-3.5 -67Z" class="nstar"/>
  </svg>`;
}
function nordTrend() {
  const t = splitTotals(), now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ y: d.getFullYear(), m: d.getMonth(), v: null }); }
  for (const s of S.snapshots) { const d = parseYmd(s.date); const mm = months.find(x => x.y === d.getFullYear() && x.m === d.getMonth()); if (mm) mm.v = num(s.net); }
  months[5].v = t.net;
  const idx = months.map((x, i) => x.v != null ? i : -1).filter(i => i >= 0);
  const first = months[idx[0]].v, chg = first ? (t.net - first) / Math.abs(first) * 100 : 0;
  const W = 320, H = 130, L = 8, R = 8, T = 12, B = 24;
  const vals = idx.map(i => months[i].v), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || Math.max(1, Math.abs(hi) * .1);
  const X = i => L + (W - L - R) * i / 5, Y = v => T + (H - T - B) * (1 - (v - lo) / span) * .85 + (H - T - B) * .08;
  const pts = idx.map(i => [X(i), Y(months[i].v)]);
  let d = pts.length ? `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}` : '';
  for (let k = 1; k < pts.length; k++) { const [x0, y0] = pts[k - 1], [x1, y1] = pts[k], cx = (x0 + x1) / 2; d += ` C${cx.toFixed(1)} ${y0.toFixed(1)} ${cx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`; }
  const area = pts.length > 1 ? `${d} L${pts[pts.length - 1][0].toFixed(1)} ${H - B} L${pts[0][0].toFixed(1)} ${H - B}Z` : '';
  const grid = [0, 1, 2].map(k => `<line x1="${L}" x2="${W - R}" y1="${(T + (H - T - B) * k / 2).toFixed(1)}" y2="${(T + (H - T - B) * k / 2).toFixed(1)}" class="ngrid"/>`).join('');
  const labels = months.map((x, i) => `<text x="${X(i).toFixed(1)}" y="${H - 6}" class="nml">${x.m + 1}月</text>`).join('');
  const dots = pts.map(([x, y], k) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${k === pts.length - 1 ? 4 : 2.6}" class="ndot${k === pts.length - 1 ? ' last' : ''}"/>`).join('');
  return `<section class="panel ntrend"><div class="nt-head"><h4>資產走勢</h4><span class="nt-r"><span>近 6 個月</span><b class="${chg >= 0 ? 'pos' : 'neg'}">${chg >= 0 ? '↑' : '↓'} ${Math.abs(chg).toFixed(2)}%</b><span class="nt-ic">${svgI('chart')}</span></span></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="nchart" role="img" aria-label="近 6 個月淨資產走勢">
      <defs><linearGradient id="nga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--n-area)"/><stop offset="1" style="stop-color:var(--n-area0)"/></linearGradient></defs>
      ${grid}${area ? `<path d="${area}" fill="url(#nga)"/>` : ''}<path d="${d}" class="nline"/>${dots}${labels}</svg>
    ${idx.length < 2 ? '<p class="meta nnote">每天開 App 會自動記一筆，下個月起就會連成走勢線</p>' : ''}</section>`;
}
const _ovViewN = VIEWS.overview;
VIEWS.overview = () => {
  let h = _ovViewN();
  if (!isNordic()) return h;
  const t = splitTotals(), range = S.range || 30;
  const since = new Date(); since.setDate(since.getDate() - range);
  const snaps = S.snapshots.filter(s => parseYmd(s.date) >= since).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const first = snaps.length ? num(snaps[0].net) : t.net, chg = first ? (t.net - first) / Math.abs(first) * 100 : 0;
  const cardDebt = t.debt + t.liab, gross = t.gross || 1;
  const pc = v => (v / gross * 100);
  const corner = (pos, k, ic, name, v, act, extra = '') => { const p = pc(v); return `<button class="ncard ${pos}" data-act="${act}" ${extra} style="--nc:var(--c-${k})">
      <span class="nc-top">${svgI(ic, 'nc-ic')}${svgI('chev', 'nc-ch')}</span><span class="nc-name">${name}</span>
      <b class="nc-p ${v < 0 ? 'neg' : ''}">${p.toFixed(1)}%</b><span class="nc-v">${money(v)}</span></button>`; };
  const dash = `<section class="ndash">
    <div class="nbox">
      ${corner('tl', 'bank', 'bank', '銀行存款', t.bankOnly, 'goto', 'data-tab="bank"')}
      ${corner('tr', 'stock', 'chart', '投資資產', t.invest, 'goto', 'data-tab="invest"')}
      ${corner('bl', 'debt', 'card', '信用卡負債', -cardDebt, 'goto', 'data-tab="cards"')}
      ${corner('br', 'recv', 'box', '其他資產', t.other, 'acc-other')}
      <div class="ndial-w">${nordDial(t)}
        <div class="ncenter"><span>總資產淨值</span><b>${money(t.net)}</b><em class="${chg >= 0 ? 'pos' : 'neg'}">${chg >= 0 ? '↑' : '↓'} ${Math.abs(chg).toFixed(2)}%</em><small>${range === 30 ? '本月' : range === 90 ? '近三個月' : '近一年'}變動</small></div></div>
    </div></section>${nordTrend()}`;
  h = h.replace(/<section class="dash">[\s\S]*?<\/section>/, '').replace(/<section class="panel ver-trend">[\s\S]*?<\/section>/, '');
  return dash + h;
};
