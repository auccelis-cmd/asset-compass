'use strict';
/* 資產羅盤 Asset Compass
 * 銀行帳戶 · 信用卡（結算日即扣款日，自動從扣款帳戶扣除）· 台股 · 加密貨幣（手動持倉＋鏈上錢包）
 */

const APP_VERSION = '2026.10.10a';
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
function tierFor(r, spendPrev) {
  if (!r.tiers?.length) return { rate: num(r.rate), cap: num(r.cap) };
  const tier = r.tiers.slice().sort((a, b) => b.min - a.min).find(x => spendPrev >= x.min);
  return tier ? { rate: num(tier.rate), cap: num(tier.cap) } : { rate: 0, cap: 0 };
}
const ruleDesc = r => {
  const parts = [];
  if (r.tiers?.length) parts.push('依上月消費分級：' + r.tiers.map(x => `${x.min.toLocaleString()} 元起 ${pct(x.rate)}${x.cap ? `／上限 ${x.cap}` : ''}`).join('，'));
  else parts.push((r.kind === 'bonus' ? '加碼 ' : '') + pct(num(r.rate)) + (r.cap ? `，每期上限 ${num(r.cap).toLocaleString()}` : '，無上限'));
  if ((r.where || 'all') !== 'all') parts.push(WHERE[r.where]?.[0]);
  if ((r.pay || 'any') !== 'any') parts.push(PAYS[r.pay]?.[0]);
  if (r.min) parts.push(`單筆滿 ${r.min}`);
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
  for (const t of txns) { const k = monthKey(new Date(t.txn_at)); monthSpend[k] = (monthSpend[k] || 0) + Math.max(0, num(t.amount_twd)); }
  const per = {}, cycles = {};
  for (const t of txns) {
    const amt = num(t.amount_twd);
    const d = new Date(t.txn_at);
    const cyc = ymd(closeOnOrAfter(c, parseYmd(ymd(d))));
    const prev = monthSpend[monthKey(new Date(d.getFullYear(), d.getMonth() - 1, 1))] || 0;
    const C = cycles[cyc] ||= { total: 0, rules: {} };
    const parts = [];
    const bases = rules.filter(r => r.kind !== 'bonus' && ruleMatches(r, t)).map(r => ({ r, ...tierFor(r, prev) }));
    const base = bases.sort((a, b) => b.rate - a.rate)[0];
    const apply = (x) => {
      const R = C.rules[x.r.id] ||= { earned: 0, cap: x.cap };
      R.cap = x.cap;
      let v = amt * x.rate / 100;
      if (v > 0 && x.cap) v = Math.max(0, Math.min(v, x.cap - R.earned));
      if (v <= 0 && amt > 0) return;
      R.earned += v; C.total += v; parts.push({ id: x.r.id, label: x.r.label, v });
    };
    if (base) apply(base);
    if (amt > 0) rules.filter(r => r.kind === 'bonus' && ruleMatches(r, t)).forEach(r => { const tr = tierFor(r, prev); if (tr.rate) apply({ r, ...tr }); });
    per[t.id] = { v: sum(parts, p => p.v), parts };
  }
  return { per, cycles };
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
    { label: '一般消費', kind: 'base', rate: 0.5, unit: 'U幣' },
    { label: '等級加碼（依上月消費）', kind: 'bonus', unit: 'U幣', tiers: [{ min: 1, rate: 1, cap: 300 }, { min: 10001, rate: 2, cap: 600 }, { min: 30001, rate: 4, cap: 1200 }] },
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
  const meters = rules.filter(r => r.on !== false && (r.cap || r.tiers)).map(r => {
    const x = R.rules[r.id] || { earned: 0, cap: r.tiers ? 0 : num(r.cap) };
    const cap = x.cap || 0;
    return `<div class="rmeter"><div class="rm-top"><span>${esc(r.label)}</span><span class="num">${Math.round(x.earned)}${cap ? ` / ${cap}` : ''}</span></div>
      ${cap ? `<div class="meter"><i style="width:${Math.min(100, x.earned / cap * 100).toFixed(1)}%"></i></div>` : '<div class="meta">上月沒有消費，本月不加碼</div>'}</div>`;
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
    title: i != null ? '編輯回饋規則' : '新增回饋規則', data: { ...r, tiers: tierStr, on: r.on !== false },
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
      { k: 'unit', label: '回饋形式', ph: '現金回饋、LINE POINTS、U幣…' },
      { k: 'on', label: '啟用這條規則', type: 'check' },
    ],
    onSave: async v => {
      const tiers = (v.tiers || '').split(/[,，]/).map(s => s.trim()).filter(Boolean).map(s => { const [min, rate, cap] = s.split(':').map(Number); return { min: min || 0, rate: rate || 0, cap: cap || 0 }; }).filter(x => x.rate);
      const nr = { id: r.id || ruleId(), label: v.label, kind: v.kind, where: v.where, pay: v.pay, rate: v.rate || 0, cap: v.cap || 0, min: v.min || 0, keywords: v.keywords, unit: v.unit, on: v.on, ...(tiers.length ? { tiers } : {}) };
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
function formLiab(L) {
  openForm({
    title: L ? '編輯分期／負債' : '新增分期／負債', data: L || { kind: 'installment' },
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
  return `<h2>主題配色</h2><section class="panel"><div class="theme-grid">${themes}</div></section>
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
  try { localStorage.setItem(seenKey, JSON.stringify([...new Set([...seen, ...list.map(p => p.name)])])); } catch (_) { }
  if (added.length) toast(`已新增 ${added.join('、')}，記得到卡片設定選扣款帳戶`, 4500);
}

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
      case 'fab-acc': if (!S.accounts.length) formAccount(); else formAdjust(S.accounts.length === 1 ? S.accounts[0] : null); break;
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
  applyTheme(localStorage.getItem('ac_theme') || 'champagne');
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
