/* 月汐 Lunaria · 主程式 */
const APP_VERSION = '1.3.0';
const CFG = window.LUNARIA_CONFIG || {};
const CLOUD = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase);
const sb = CLOUD ? window.supabase.createClient(CFG.supabaseUrl.replace(/\/rest\/v1\/?$/, ''), CFG.supabaseAnonKey) : null;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const { toD, ymd, add, diff } = Cycle;
const today = () => toD(new Date());
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const md = d => { d = toD(d); return `${d.getMonth() + 1}/${d.getDate()}`; };
const mdw = d => { d = toD(d); return `${d.getMonth() + 1}/${d.getDate()}（週${WD[d.getDay()]}）`; };
const r1 = n => (Math.round(n * 10) / 10).toString();

/* ---------- 本機設定（每台裝置各自） ---------- */
const SET_DEF = { pal: 'moss', mode: 'auto', cycleLen: 28, periodLen: 5, luteal: 0, waterGoal: 2000, stepGoal: 8000, exGoal: 30, rm: { period: true, ovu: true, med: true, tips: true }, pin: null };
const SET = (() => { try { const c = JSON.parse(localStorage.getItem('lun_set') || '{}'); return { ...SET_DEF, ...c, rm: { ...SET_DEF.rm, ...(c.rm || {}) } }; } catch (_) { return { ...SET_DEF }; } })();
const saveSet = () => { try { localStorage.setItem('lun_set', JSON.stringify(SET)); } catch (_) { } };
const PALS = { moss: ['月光象牙・霧綠藍', ['#F7F3EA', '#7C9E93', '#8EA3CF', '#C9A46A']], mist: ['鼠尾草綠・霧藍灰', ['#F8F7F3', '#8FA79B', '#8AA3B2', '#C9B8A8']], blush: ['霧紫灰・陶粉', ['#F8F2F2', '#9A80AA', '#E9A3A6', '#9DB8A6']] };
let applyTheme = function () {
  let m = SET.mode; if (m === 'auto') m = matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day';
  const de = document.documentElement; de.dataset.pal = SET.pal; de.dataset.mode = m;
  const bg = getComputedStyle(de).getPropertyValue('--bg').trim();
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', bg || '#F7F3EA');
}
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (SET.mode === 'auto') applyTheme(); }); } catch (_) { }
const aOpts = () => ({ cycleLen: SET.cycleLen, periodLen: SET.periodLen, luteal: SET.luteal || 0 });

/* ---------- 圖示 ---------- */
const IC = {
  home: '<path d="M4 11 12 4l8 7M6 9.5V20h12V9.5"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14Z"/><path d="M5 19 13 11"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevL: '<path d="m15 6-6 6 6 6"/>', chevR: '<path d="m9 6 6 6-6 6"/>',
  drop: '<path d="M12 3.5s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11Z"/>',
  moon: '<path d="M16 4a8.5 8.5 0 1 0 4.5 14A7 7 0 0 1 16 4Z"/>',
  thermo: '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0Z"/><path d="M12 9v7"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  pill: '<rect x="3.5" y="9" width="17" height="6" rx="3" transform="rotate(-35 12 12)"/><path d="m9.5 8.4 5 7.2"/>',
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  shield: '<path d="M12 3.5 5 6v5.5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6Z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 6a9.6 9.6 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a17 17 0 0 1-3 3.7M6.6 6.6C4 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.3-1"/>',
  sleep: '<path d="M4 18h16M6 18V9a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v9M9 12h6"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  cycle: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5Z"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1-.9-1.4-.9-2.4 0-1 .8-1.6 1.8-1.6h2.1a3.7 3.7 0 0 0 3.7-3.7C20.5 7 16.7 3.5 12 3.5Z"/><circle cx="8" cy="11" r="1"/><circle cx="11" cy="7.5" r="1"/><circle cx="15.5" cy="8" r="1"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 13.5l5-5 5 5M5 4h14"/>',
  shoe: '<path d="M4 16c0-3 1-7 2-9l4 1c0 2 1 3 3 3.5l6 1.5c1 .3 1.5 1 1.5 2v1H4Z"/><path d="M4 19h17"/>',
};
const svgI = (k, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${IC[k] || ''}</svg>`;

/* ---------- 選項 ---------- */
const FLOW = [[0, '無'], [1, '點滴'], [2, '少'], [3, '中'], [4, '多']];
const SYMPTOMS = ['經痛', '腰痠', '頭痛', '腹脹', '乳房脹痛', '痘痘', '疲倦', '噁心', '腹瀉', '便秘', '食慾增加', '失眠', '頭暈', '水腫'];
const MOODS = ['開心', '平靜', '有活力', '溫柔', '敏感', '焦慮', '煩躁', '低落', '想哭', '想被抱抱'];
const LIBIDO = [[0, '低'], [1, '普通'], [2, '高'], [3, '很高']];
const LH = [['', '未測'], ['neg', '陰性'], ['faint', '弱陽'], ['pos', '陽性'], ['peak', '強陽']];
const MUCUS = [['', '未看'], ['dry', '乾燥'], ['sticky', '黏稠'], ['creamy', '乳狀'], ['watery', '水狀'], ['eggwhite', '蛋清狀']];
const PROTECT = [['condom', '保險套'], ['pill', '避孕藥'], ['iud', '子宮內避孕器'], ['withdrawal', '體外'], ['none', '無防護'], ['other', '其他']];
const PROTECT_L = Object.fromEntries(PROTECT);
const CONTRA = [['', '未設定'], ['pill', '口服避孕藥'], ['condom', '保險套'], ['iud', '子宮內避孕器（IUD）'], ['implant', '皮下植入'], ['injection', '避孕針'], ['ring', '陰道環'], ['patch', '避孕貼片'], ['natural', '自然週期法'], ['none', '目前沒有避孕']];
const OV_L = { bbt: '體溫確認', lh: '排卵試紙', mucus: '分泌物判斷', predicted: '週期推算' };

/* ---------- 資料層（雲端 Supabase／本機） ---------- */
const LS = k => { try { return JSON.parse(localStorage.getItem('lun_' + k) || '[]'); } catch (_) { return []; } };
const LSset = (k, v) => { try { localStorage.setItem('lun_' + k, JSON.stringify(v)); } catch (_) { } };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const KEYS = { day_logs: ['user_id', 'date'], contraception: ['user_id'], med_logs: ['med_id', 'date', 'slot'] };
const DB = {
  async list(t, owner) {
    if (!CLOUD) return LS(t);
    const { data, error } = await sb.from(t).select('*').eq('user_id', owner);
    if (error) throw error; return data || [];
  },
  async insert(t, row) {
    if (!CLOUD) { const a = LS(t); const r = { id: uid(), user_id: 'local', created_by: 'local', created_at: new Date().toISOString(), ...row }; a.push(r); LSset(t, a); return r; }
    const { data, error } = await sb.from(t).insert(row).select().single(); if (error) throw error; return data;
  },
  async upsert(t, row) {
    if (!CLOUD) {
      const a = LS(t), k = KEYS[t] || ['id']; row = { user_id: 'local', ...row };
      const i = a.findIndex(x => k.every(f => x[f] === row[f]));
      if (i >= 0) a[i] = { ...a[i], ...row }; else a.push({ id: uid(), ...row }); LSset(t, a); return row;
    }
    const { data, error } = await sb.from(t).upsert(row, { onConflict: (KEYS[t] || ['id']).join(',') }).select().single(); if (error) throw error; return data;
  },
  async update(t, id, patch) {
    if (!CLOUD) { const a = LS(t); const i = a.findIndex(x => x.id === id); if (i >= 0) a[i] = { ...a[i], ...patch }; LSset(t, a); return a[i]; }
    const { data, error } = await sb.from(t).update(patch).eq('id', id).select().single(); if (error) throw error; return data;
  },
  async remove(t, match) {
    if (!CLOUD) { LSset(t, LS(t).filter(x => !Object.entries(match).every(([k, v]) => x[k] === v))); return; }
    let q = sb.from(t).delete(); for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
    const { error } = await q; if (error) throw error;
  },
};

/* ---------- 狀態 ---------- */
const S = {
  user: null, role: 'owner', ownerId: 'local', share: null, partners: [],
  cycles: [], logs: [], intimacy: [], meds: [], medLogs: [], health: [], contra: null, calToken: null,
  tab: 'today', month: null, recTab: 'cycle', mask: localStorage.getItem('lun_mask') === '1',
};
let A = Cycle.analyze([], []);
const isOwner = () => S.role === 'owner';
const logsBy = () => Object.fromEntries(S.logs.map(l => [String(l.date).slice(0, 10), l]));

async function loadAll() {
  const o = S.ownerId;
  const [cycles, intimacy, meds, medLogs, health] = await Promise.all(['cycles', 'intimacy', 'meds', 'med_logs', 'health'].map(t => DB.list(t, o).catch(() => [])));
  Object.assign(S, { cycles, intimacy, meds, medLogs, health });
  if (isOwner()) {
    S.logs = await DB.list('day_logs', o).catch(() => []);
    const c = await DB.list('contraception', o).catch(() => []); S.contra = c[0] || null;
  } else { S.logs = []; S.contra = null; }
  A = Cycle.analyze(S.cycles, S.logs, today(), aOpts());
  if (isOwner()) syncOvulation();
}
/* 記錄者端：把算出的排卵日寫回週期，伴侶那邊才看得到精準的排卵日 */
async function syncOvulation() {
  for (const c of A.cycles) {
    const m = c.ov.method, ok = m === 'bbt' || m === 'lh' || m === 'mucus';
    const want = ok ? ymd(c.ov.date) : null, wantM = ok ? m : null;
    const have = c.ovulation_date ? String(c.ovulation_date).slice(0, 10) : null;
    if (c.id && (want !== have || (c.ovulation_method || null) !== wantM) && (want || have)) {
      try { await DB.update('cycles', c.id, { ovulation_date: want, ovulation_method: wantM }); const s = S.cycles.find(x => x.id === c.id); if (s) Object.assign(s, { ovulation_date: want, ovulation_method: wantM }); } catch (_) { }
    }
  }
}

/* ---------- 共用元件 ---------- */
function toast(msg, ms = 2400) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms); }
function sheet(title, body, { onSave, saveLabel = '儲存', onDelete } = {}) {
  const w = $('#sheet');
  w.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="grab"></div>
    <div class="sheet-h"><h3>${esc(title)}</h3><button class="x" data-close aria-label="關閉">×</button></div>
    <form class="sheet-f">${body}
      <div class="actions">${onDelete ? '<button type="button" class="btn danger" data-del>刪除</button>' : ''}${onSave ? `<button type="button" class="btn ghost" data-close>取消</button><button class="btn primary" type="submit">${saveLabel}</button>` : ''}</div>
    </form></div>`;
  w.hidden = false;
  const f = $('form', w);
  w.onclick = e => { if (e.target === w || e.target.closest('[data-close]')) closeSheet(); };
  f.onsubmit = async e => { e.preventDefault(); if (!onSave) return; const btn = $('[type=submit]', f); btn.disabled = true; try { if (await onSave(f) !== false) closeSheet(); } catch (err) { toast('儲存失敗：' + (err.message || err)); } btn.disabled = false; };
  if (onDelete) $('[data-del]', f).onclick = async () => { if (!confirm('確定要刪除嗎？')) return; try { await onDelete(); closeSheet(); } catch (err) { toast('刪除失敗：' + err.message); } };
  // 單選／多選標籤
  f.querySelectorAll('[data-pick]').forEach(g => g.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    if (g.dataset.multi) b.classList.toggle('on'); else { g.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); }
  }));
  return f;
}
function closeSheet() { const w = $('#sheet'); w.hidden = true; w.innerHTML = ''; }
const picked = (f, k) => [...f.querySelectorAll(`[data-pick="${k}"] button.on`)].map(b => b.dataset.v);
const pick1 = (f, k) => picked(f, k)[0] ?? '';
const chips = (k, opts, sel, { multi = false, cls = '' } = {}) => `<div class="chips" data-pick="${k}" ${multi ? 'data-multi="1"' : ''}>${opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; const on = multi ? (sel || []).includes(v) : String(sel ?? '') === String(v); return `<button type="button" class="chip ${cls}${on ? ' on' : ''}" data-v="${esc(v)}">${esc(l)}</button>`; }).join('')}</div>`;

/* ---------- 今天 ---------- */
function phaseOf(d = today()) {
  const c = A.current; if (!c) return null;
  if (c.late > 0) return { k: 'late', t: `月經晚了 ${c.late} 天` };
  const st = Cycle.dayStatus(A, d, logsBy());
  if (st.period || c.inPeriod) return { k: 'period', t: '經期中' };
  if (st.ovulation) return { k: 'ovu', t: st.ovPredicted ? '預計排卵日' : '排卵日' };
  if (st.fertile) return { k: 'fertile', t: '易孕期' };
  if (d > c.ovulation) return { k: 'luteal', t: '黃體期' };
  return { k: 'follicular', t: '濾泡期' };
}
function ringSVG() {
  const c = A.current, L = Math.max(Math.round(A.avgCycle), c ? c.cycleDay : 0, 21);
  const R = 120, P = a => [R * Math.sin(a), -R * Math.cos(a)], f = n => n.toFixed(1);
  const ang = day => (day - 1) / L * Math.PI * 2;
  const arc = (d0, d1, cls) => { if (d1 < d0) return ''; const a0 = ang(d0) + .02, a1 = ang(d1 + 1) - .02; const [x0, y0] = P(a0), [x1, y1] = P(a1); return `<path class="seg ${cls}" d="M${f(x0)} ${f(y0)}A${R} ${R} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${f(x1)} ${f(y1)}"/>`; };
  let segs = '', ticks = '', mark = '';
  if (c) {
    const pe = Math.round(A.avgPeriod), last = A.cycles[A.cycles.length - 1];
    const pEnd = last && last.e ? diff(last.e, c.start) + 1 : pe;
    const fs = diff(c.fertileStart, c.start) + 1, fe = diff(c.fertileEnd, c.start) + 1, ov = diff(c.ovulation, c.start) + 1;
    segs += arc(1, pEnd, 'period') + arc(Math.max(fs, pEnd + 1), Math.min(fe, L), 'fertile') + arc(Math.max(fe + 1, pEnd + 1), L, 'luteal');
    const [ox, oy] = P(ang(ov) + Math.PI / L);
    mark += `<circle cx="${f(ox)}" cy="${f(oy)}" r="9" class="ovu"/><path transform="translate(${f(ox)} ${f(oy)}) scale(.36)" d="M0 -12 3 -3 12 0 3 3 0 12 -3 3 -12 0 -3 -3Z" fill="#fff"/>`;
    const td = Math.min(c.cycleDay, L), [tx, ty] = P(ang(td) + Math.PI / L);
    mark += `<circle cx="${f(tx)}" cy="${f(ty)}" r="12" class="today"/>`;
  }
  for (let i = 0; i < L; i++) { const a = ang(i + 1); const [x0, y0] = [(R + 16) * Math.sin(a), -(R + 16) * Math.cos(a)], [x1, y1] = [(R + 20) * Math.sin(a), -(R + 20) * Math.cos(a)]; ticks += `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" class="tick"/>`; }
  const lbl = [1, Math.round(L / 4), Math.round(L / 2), Math.round(L * 3 / 4)].map(d => { const a = ang(d) + Math.PI / L; return `<text x="${f((R + 30) * Math.sin(a))}" y="${f(-(R + 30) * Math.cos(a))}" class="lbl">${d}</text>`; }).join('');
  return `<svg class="ring" viewBox="-160 -160 320 320" role="img" aria-label="本次週期示意"><circle r="${R}" class="base"/>${ticks}${lbl}${segs}${mark}</svg>`;
}
function rhythmTiles() {
  const c = A.current;
  const ovBadge = c ? (c.ovMethod === 'bbt' ? '<span class="badge ok">體溫確認</span>' : c.ovMethod === 'lh' ? '<span class="badge mid">試紙 ±1 天</span>' : c.ovMethod === 'mucus' ? '<span class="badge mid">分泌物 ±2 天</span>' : `<span class="badge est">推算 ±${c.ovRange} 天</span>`) : '';
  const nd = c ? diff(c.nextStart, today()) : null;
  return `<div class="rhythm">
    <div class="rt" style="--tc:var(--plum)"><div class="k">平均週期長度</div><div class="v">${r1(A.avgCycle)}<small>天</small></div><div class="s">${A.samples ? `近 ${A.samples} 次 ${A.minCycle}–${A.maxCycle} 天` : '還沒有完整週期，先以 28 天計'}</div></div>
    <div class="rt" style="--tc:var(--period)"><div class="k">平均生理期</div><div class="v">${r1(A.avgPeriod)}<small>天</small></div><div class="s">${A.cycles.some(x => x.e) ? '依記錄的結束日計算' : '記下月經結束日會更準'}</div></div>
    <div class="rt" style="--tc:var(--period-mid)"><div class="k">下次月經</div><div class="v">${c ? md(c.nextStart) : '—'}</div><div class="s">${c ? (nd > 0 ? `${nd} 天後・週${WD[c.nextStart.getDay()]}` : nd === 0 ? '預計今天' : `已晚 ${-nd} 天`) : '記錄第一次月經後開始預測'}</div></div>
    <div class="rt" style="--tc:var(--ovu)"><div class="k">預計排卵日</div><div class="v">${c ? md(c.ovulation) : '—'}</div><div class="s">${ovBadge}${c ? ` 易孕 ${md(c.fertileStart)}–${md(c.fertileEnd)}` : ''}</div></div>
  </div>`;
}
function precisionTip() {
  const c = A.current; if (!c || !isOwner()) return '';
  if (c.ovMethod === 'bbt') return `<div class="tip">${svgI('check')}<div>體溫在 <b>${md(c.bbt.firstHigh)}</b> 起連續升高，排卵確認在 <b>${md(c.ovulation)}</b>。下次月經改用妳的黃體期（${A.luteal} 天${A.lutealSamples ? '・個人數據' : '・預設'}）推算，會比平均值準。</div></div>`;
  if (c.ovMethod === 'lh') return `<div class="tip">${svgI('spark')}<div>排卵試紙在 <b>${md(add(c.ovulation, -1))}</b> 出現陽性，通常 24–36 小時內排卵。持續量體溫，升溫 3 天後就能<b>確認</b>。</div></div>`;
  return `<div class="tip">${svgI('thermo')}<div>目前排卵日是用週期推算（±${c.ovRange} 天）。想精準到當天：<b>每天起床、下床前量基礎體溫</b>，並在 ${md(add(c.fertileStart, -1))} 左右開始測<b>排卵試紙</b>，月汐會自動判斷。</div></div>`;
}
function medsToday(d = today()) {
  const k = ymd(d), wd = ((d.getDay() + 6) % 7) + 1, out = [];
  for (const m of S.meds) {
    if (m.active === false) continue;
    if (m.start_date && toD(m.start_date) > d) continue;
    if (m.end_date && toD(m.end_date) < d) continue;
    if (m.weekdays && m.weekdays.length && !m.weekdays.includes(wd)) continue;
    for (const t of (m.times && m.times.length ? m.times : ['09:00'])) out.push({ m, t, done: S.medLogs.some(l => l.med_id === m.id && String(l.date).slice(0, 10) === k && l.slot === t) });
  }
  return out.sort((a, b) => a.t.localeCompare(b.t));
}
function medRows(list, d = today()) {
  if (!list.length) return `<div class="empty">今天沒有要吃的藥${isOwner() ? '，到「健康」新增提醒' : ''}</div>`;
  return `<div class="list">${list.map(x => `<div class="li"><span class="ic" style="--c:var(--plum);--c-soft:var(--plum-soft)">${svgI('pill')}</span>
    <div class="g"><div class="t">${esc(x.m.name)}${x.m.dose ? ` <span class="muted small">${esc(x.m.dose)}</span>` : ''}</div><div class="m">${x.t}${x.m.kind === 'contraceptive' ? '・避孕藥' : x.m.kind === 'supplement' ? '・保健品' : ''}</div></div>
    ${isOwner() ? `<button class="chk${x.done ? ' on' : ''}" data-act="med-tick" data-id="${x.m.id}" data-slot="${x.t}" data-date="${ymd(d)}" aria-label="${x.done ? '取消已服用' : '標記已服用'}">${svgI('check')}</button>` : `<span class="badge ${x.done ? 'ok' : 'est'}">${x.done ? '已服用' : '未服用'}</span>`}</div>`).join('')}</div>`;
}
function logSummary(l) {
  const bits = [];
  if (l.flow > 0) bits.push(`經量${FLOW[l.flow][1]}`);
  if (l.bbt) bits.push(`${(+l.bbt).toFixed(2)}°C`);
  if (l.lh) bits.push('試紙' + (LH.find(x => x[0] === l.lh) || [, ''])[1]);
  if (l.mucus) bits.push((MUCUS.find(x => x[0] === l.mucus) || [, ''])[1]);
  if (l.sleep_q) bits.push(`睡眠 ${'★'.repeat(l.sleep_q)}`);
  return bits.join('・');
}
const VIEWS = {};
VIEWS.today = () => {
  const c = A.current, ph = phaseOf();
  if (!c) {
    return `<section class="card hero"><div class="ring-box">${ringSVG()}<div class="ring-c"><span class="k">歡迎來到月汐</span><span class="d" style="font-size:40px">🌙</span><span class="hero-sub">${isOwner() ? '記下最近一次月經的第一天，就會開始幫妳預測' : '她還沒有開始記錄，等她記下第一次月經就會出現'}</span></div></div>
      ${isOwner() ? '<button class="btn period block" data-act="period-start">記錄月經開始日</button>' : ''}</section>${isOwner() ? '' : intimacyBlock(3)}`;
  }
  const nd = diff(c.nextStart, today()), od = diff(c.ovulation, today());
  const sub = ph.k === 'period' ? `預計 ${md(add(c.start, Math.round(A.avgPeriod) - 1))} 結束` :
    ph.k === 'late' ? '可以考慮驗孕，或記下近期壓力、作息變化' :
    od > 0 && od <= 10 ? `距離排卵約 <b>${od}</b> 天・易孕期 ${md(c.fertileStart)} 開始` :
    `距離下次月經 <b>${Math.max(nd, 0)}</b> 天・${mdw(c.nextStart)}`;
  const logT = S.logs.find(l => String(l.date).slice(0, 10) === ymd(today()));
  return `<section class="card hero">
      <div class="ring-box">${ringSVG()}<div class="ring-c"><span class="k">${isOwner() ? '週期第' : '她的週期第'}</span><span class="d">${c.cycleDay}<small>天</small></span><span class="ph ${ph.k}">${ph.t}</span></div></div>
      <div class="hero-sub">${sub}</div>
      <div class="legend"><span><i style="background:var(--period-mid)"></i>經期</span><span><i style="background:#C9BDEB"></i>易孕期</span><span><i style="background:var(--ovu)"></i>排卵日</span><span><i style="background:var(--luteal-soft)"></i>黃體期</span></div>
      ${isOwner() ? `<div class="row-btns">${c.inPeriod && A.cycles[A.cycles.length - 1] && !A.cycles[A.cycles.length - 1].e ? '<button class="btn ghost" data-act="period-end">月經結束了</button>' : '<button class="btn period" data-act="period-start">月經來了</button>'}<button class="btn primary" data-act="log" data-date="${ymd(today())}">${logT ? '修改今天' : '記錄今天'}</button></div>` : `<div class="row-btns"><button class="btn primary" data-act="add-intimacy">＋ 親密紀錄</button></div>`}
    </section>
    <div class="sec"><h2>節奏</h2><span class="r">${A.irregular ? '週期變化較大，預測僅供參考' : ''}</span></div>
    ${rhythmTiles()}${precisionTip()}
    <div class="sec"><h2>今日用藥</h2><span class="r">${medsToday().filter(x => x.done).length}/${medsToday().length}</span></div>
    <section class="card">${medRows(medsToday())}</section>
    ${isOwner() ? `<div class="sec"><h2>近期紀錄</h2><button class="btn small ghost" data-act="tab" data-tab="records">全部</button></div>
    <section class="card">${recentLogs(4)}</section>` : intimacyBlock(3)}`;
};
function recentLogs(n) {
  const ls = S.logs.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, n);
  if (!ls.length) return '<div class="empty">還沒有每日紀錄。點「記錄今天」開始，記得越多預測越準</div>';
  return `<div class="list">${ls.map(l => `<div class="li click" data-act="log" data-date="${String(l.date).slice(0, 10)}">
    <span class="ic" style="--c:${l.flow > 0 ? 'var(--period)' : 'var(--plum)'};--c-soft:${l.flow > 0 ? 'var(--period-soft)' : 'var(--plum-soft)'}">${svgI(l.flow > 0 ? 'drop' : 'moon')}</span>
    <div class="g"><div class="t">${mdw(l.date)}</div><div class="m">${esc(logSummary(l) || '')}</div>
    <div>${[...(l.symptoms || []), ...(l.moods || [])].slice(0, 5).map(s => `<span class="tag">${esc(s)}</span>`).join('')}</div></div>${svgI('chevR')}</div>`).join('')}</div>`;
}
function intimacyBlock(n) {
  const ls = S.intimacy.slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, n);
  return `<div class="sec"><h2>親密紀錄</h2><button class="btn small ghost" data-act="add-intimacy">＋ 新增</button></div>
    <section class="card sens">${ls.length ? `<div class="list">${ls.map(intimacyRow).join('')}</div>` : '<div class="empty">還沒有紀錄</div>'}</section>`;
}
function intimacyRow(x) {
  const d = new Date(x.at), st = Cycle.dayStatus(A, d, logsBy());
  const mine = x.created_by === (S.user ? S.user.id : 'local');
  const ph = st.period ? '經期' : st.ovulation ? '排卵日' : st.fertile ? '易孕期' : '';
  return `<div class="li${mine || isOwner() ? ' click' : ''}" ${mine || isOwner() ? `data-act="edit-intimacy" data-id="${x.id}"` : ''}><span class="ic" style="--c:#C2557A;--c-soft:#F8E1EA">${svgI('heart')}</span>
    <div class="g"><div class="t">${mdw(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</div><div class="m">${esc(PROTECT_L[x.protection] || '未填防護方式')}${x.note ? '・' + esc(x.note) : ''}</div></div>
    ${ph ? `<span class="badge ${ph === '易孕期' || ph === '排卵日' ? 'mid' : ''}">${ph}</span>` : ''}</div>`;
}

/* ---------- 月曆 ---------- */
VIEWS.cal = () => {
  const m = S.month || new Date(today().getFullYear(), today().getMonth(), 1);
  const first = new Date(m.getFullYear(), m.getMonth(), 1), startW = first.getDay();
  const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const lb = logsBy(), td = ymd(today());
  const intimDays = new Set(S.intimacy.map(x => ymd(new Date(x.at))));
  let cells = WD.map(w => `<div class="wd">${w}</div>`).join('');
  for (let i = 0; i < startW; i++) { const d = add(first, i - startW); cells += `<button class="cd out" data-act="day" data-date="${ymd(d)}">${d.getDate()}</button>`; }
  for (let i = 1; i <= days; i++) {
    const d = new Date(m.getFullYear(), m.getMonth(), i), k = ymd(d), st = Cycle.dayStatus(A, d, lb);
    const cls = [st.period ? 'period' : st.ovulation ? ('ovu' + (st.ovPredicted ? ' pred' : '')) : st.predictedPeriod ? 'pp' : st.fertile ? 'fertile' : '', k === td ? 'today' : ''].join(' ');
    const dots = `${st.logged && isOwner() ? '<i></i>' : ''}${intimDays.has(k) ? '<i class="h"></i>' : ''}`;
    cells += `<button class="cd ${cls}" data-act="day" data-date="${k}" aria-label="${md(d)}">${i}${dots ? `<span class="dots">${dots}</span>` : ''}</button>`;
  }
  return `<section class="card"><div class="cal-head"><h3>${m.getFullYear()} 年 ${m.getMonth() + 1} 月</h3><div class="nb"><button class="cal-nav" data-act="month" data-d="-1" aria-label="上個月">${svgI('chevL')}</button><button class="cal-nav" data-act="month" data-d="0" aria-label="回到本月">${svgI('moon')}</button><button class="cal-nav" data-act="month" data-d="1" aria-label="下個月">${svgI('chevR')}</button></div></div>
    <div class="cal">${cells}</div>
    <div class="legend"><span><i style="background:var(--period)"></i>經期</span><span><i style="background:#fff;box-shadow:inset 0 0 0 2px var(--period-mid)"></i>預測經期</span><span><i style="background:var(--fertile-soft)"></i>易孕期</span><span><i style="background:var(--ovu)"></i>排卵日</span><span><i style="background:#E06C88"></i>親密</span></div></section>
    ${isOwner() ? bbtChart() : ''}
    ${A.future.length ? `<div class="sec"><h2>接下來 3 次</h2></div><section class="card"><div class="list">${A.future.map(f => `<div class="li"><span class="ic" style="--c:var(--period);--c-soft:var(--period-soft)">${svgI('drop')}</span><div class="g"><div class="t">月經 ${mdw(f.start)}</div><div class="m">排卵約 ${md(f.ovulation)}・易孕 ${md(f.fertileStart)}–${md(f.fertileEnd)}</div></div><span class="r">${diff(f.start, today())} 天後</span></div>`).join('')}</div></section>` : ''}`;
};
function bbtChart() {
  const c = A.current; if (!c) return '';
  const end = add(c.start, Math.max(Math.round(A.avgCycle), c.cycleDay) - 1);
  const pts = S.logs.filter(l => l.bbt && toD(l.date) >= c.start && toD(l.date) <= end).map(l => ({ d: diff(l.date, c.start) + 1, t: +l.bbt })).sort((a, b) => a.d - b.d);
  const N = diff(end, c.start) + 1, W = 340, H = 170, L = 30, R = 8, T = 10, B = 22;
  if (pts.length < 2) return `<div class="sec"><h2>基礎體溫</h2></div><section class="card"><div class="empty">${svgI('thermo')}<br>每天起床、下床前量體溫並記錄。<br>累積到升溫後，月汐會畫出曲線並確認排卵日。</div></section>`;
  const ts = pts.map(p => p.t), lo = Math.min(...ts, c.bbt ? c.bbt.coverline : 99) - .15, hi = Math.max(...ts) + .15;
  const X = d => L + (W - L - R) * (d - 1) / Math.max(1, N - 1), Y = t => T + (H - T - B) * (1 - (t - lo) / (hi - lo));
  const grid = [0, 1, 2, 3].map(k => { const t = lo + (hi - lo) * k / 3; return `<line x1="${L}" x2="${W - R}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}" class="grid"/><text x="${L - 4}" y="${(Y(t) + 3).toFixed(1)}" class="yl">${t.toFixed(2)}</text>`; }).join('');
  const pEnd = Math.round(A.avgPeriod), fs = diff(c.fertileStart, c.start) + 1, fe = diff(c.fertileEnd, c.start) + 1, ov = diff(c.ovulation, c.start) + 1;
  const bands = `<rect class="pband" x="${X(1)}" y="${T}" width="${Math.max(0, X(pEnd) - X(1))}" height="${H - T - B}"/><rect class="fband" x="${X(fs)}" y="${T}" width="${Math.max(0, X(fe) - X(fs))}" height="${H - T - B}"/>`;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.d).toFixed(1)} ${Y(p.t).toFixed(1)}`).join(' ');
  const cover = c.bbt ? `<line class="cover" x1="${L}" x2="${W - R}" y1="${Y(c.bbt.coverline).toFixed(1)}" y2="${Y(c.bbt.coverline).toFixed(1)}"/>` : '';
  const ovl = `<line class="ovl" x1="${X(ov)}" x2="${X(ov)}" y1="${T}" y2="${H - B}" ${c.ovMethod === 'predicted' ? 'stroke-dasharray="3 3"' : ''}/>`;
  const firstHigh = c.bbt ? diff(c.bbt.firstHigh, c.start) + 1 : 999;
  const dots = pts.map(p => `<circle cx="${X(p.d).toFixed(1)}" cy="${Y(p.t).toFixed(1)}" r="3.4" class="pt${p.d >= firstHigh ? ' hi' : ''}"/>`).join('');
  const xl = [1, 7, 14, 21, 28, 35].filter(d => d <= N).map(d => `<text x="${X(d).toFixed(1)}" y="${H - 6}" class="xl">第${d}天</text>`).join('');
  return `<div class="sec"><h2>基礎體溫</h2><span class="r">${c.bbt ? `覆蓋線 ${c.bbt.coverline.toFixed(2)}°C` : '尚未升溫'}</span></div>
    <section class="card"><svg class="bbt" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="本週期基礎體溫">${bands}${grid}${cover}${ovl}<path class="ln" d="${line}"/>${dots}${xl}</svg>
    <p class="note">左邊色帶＝經期、中間色帶＝易孕期、直線＝排卵日（虛線為推算）。連續 3 天高於前 6 天最高溫（金色虛線），且第 3 天高 0.2°C 以上，就判定已排卵。</p></section>`;
}

/* ---------- 紀錄 ---------- */
VIEWS.records = () => {
  const tabs = isOwner() ? [['cycle', '經期紀錄'], ['body', '症狀・心情'], ['intim', '親密']] : [['cycle', '經期紀錄'], ['intim', '親密']];
  if (!tabs.some(t => t[0] === S.recTab)) S.recTab = 'cycle';
  const seg = `<div class="chips" style="margin:6px 0 4px">${tabs.map(([k, l]) => `<button class="chip${S.recTab === k ? ' on' : ''}" data-act="rec-tab" data-k="${k}">${l}</button>`).join('')}</div>`;
  if (S.recTab === 'cycle') {
    const cs = A.cycles.slice().reverse();
    return seg + `<div class="sec"><h2>經期紀錄</h2>${isOwner() ? '<button class="btn small ghost" data-act="period-start">＋ 新增</button>' : ''}</div>
      <section class="card">${cs.length ? `<div class="list">${cs.map(c => `<div class="li${isOwner() ? ' click' : ''}" ${isOwner() ? `data-act="edit-cycle" data-id="${c.id}"` : ''}>
        <span class="ic" style="--c:var(--period);--c-soft:var(--period-soft)">${svgI('drop')}</span>
        <div class="g"><div class="t">${md(c.s)}${c.e ? ` – ${md(c.e)}` : ' 開始'}</div><div class="m">${c.e ? `經期 ${diff(c.e, c.s) + 1} 天` : '經期進行中'}${c.ov.date ? `・排卵 ${md(c.ov.date)}（${OV_L[c.ov.method] || ''}）` : ''}</div></div>
        <span class="r"><b>${c.length || '—'}</b>${c.length ? '天週期' : '本次'}</span></div>`).join('')}</div>` : '<div class="empty">還沒有經期紀錄</div>'}</section>
      ${A.samples ? `<div class="sec"><h2>週期變化</h2></div><section class="card">${cycleBars()}</section>` : ''}`;
  }
  if (S.recTab === 'intim') {
    const ls = S.intimacy.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const n30 = ls.filter(x => diff(today(), new Date(x.at)) < 30).length;
    return seg + `<div class="sec"><h2>親密紀錄</h2><button class="btn small ghost" data-act="add-intimacy">＋ 新增</button></div>
      <section class="card sens">${ls.length ? `<p class="note" style="margin-top:0">近 30 天 ${n30} 次${ls.some(x => x.protection === 'none') ? '・有無防護紀錄，易孕期請特別留意' : ''}</p><div class="list">${ls.map(intimacyRow).join('')}</div>` : '<div class="empty">還沒有紀錄</div>'}</section>`;
  }
  // 症狀・心情（只有本人）
  const since = add(today(), -90), ls = S.logs.filter(l => toD(l.date) >= since);
  const count = k => { const m = {}; ls.forEach(l => (l[k] || []).forEach(s => m[s] = (m[s] || 0) + 1)); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6); };
  const bars = arr => { const mx = Math.max(1, ...arr.map(x => x[1])); return arr.length ? `<div class="stat-bars">${arr.map(([k, v]) => `<div class="sb"><span>${esc(k)}</span><span class="bar"><i style="width:${v / mx * 100}%"></i></span><span>${v}</span></div>`).join('')}</div>` : '<div class="empty">近 90 天沒有紀錄</div>'; };
  const sl = ls.filter(l => l.sleep_q), sh = ls.filter(l => l.sleep_h);
  const lib = ph => { const xs = ls.filter(l => l.libido != null && l.libido !== '' && (ph ? Cycle.dayStatus(A, l.date).fertile || Cycle.dayStatus(A, l.date).ovulation : !(Cycle.dayStatus(A, l.date).fertile || Cycle.dayStatus(A, l.date).ovulation))).map(l => +l.libido); return xs.length ? r1(xs.reduce((s, x) => s + x, 0) / xs.length) : '—'; };
  return seg + `<div class="sec"><h2>常見症狀</h2><span class="r">近 90 天</span></div><section class="card">${bars(count('symptoms'))}</section>
    <div class="sec"><h2>心情</h2></div><section class="card">${bars(count('moods'))}</section>
    <div class="rhythm"><div class="rt" style="--tc:var(--luteal)"><div class="k">平均睡眠品質</div><div class="v">${sl.length ? r1(sl.reduce((s, l) => s + +l.sleep_q, 0) / sl.length) : '—'}<small>/ 5</small></div><div class="s">${sh.length ? `平均 ${r1(sh.reduce((s, l) => s + +l.sleep_h, 0) / sh.length)} 小時` : '記錄睡眠時數可看平均'}</div></div>
    <div class="rt" style="--tc:#C2557A"><div class="k">性慾感受</div><div class="v">${lib(true)}<small>易孕期</small></div><div class="s">其他時間平均 ${lib(false)}（0 低–3 很高）</div></div></div>
    <div class="sec"><h2>每日紀錄</h2></div><section class="card">${recentLogs(30)}</section>`;
};
function cycleBars() {
  const cs = A.cycles.filter(c => c.length).slice(-8), mx = Math.max(...cs.map(c => c.length), 35);
  return `<div class="stat-bars">${cs.map(c => `<div class="sb"><span>${md(c.s)}</span><span class="bar"><i style="width:${c.length / mx * 100}%"></i></span><span>${c.length}天</span></div>`).join('')}</div>
    <p class="note">平均 ${r1(A.avgCycle)} 天，標準差 ${A.cycleSd} 天。${A.irregular ? '近幾次相差超過 9 天，若持續不規律建議諮詢婦產科。' : '週期穩定，預測可信度高。'}</p>`;
}

/* ---------- 健康 ---------- */
VIEWS.health = () => {
  const hs = S.health.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const latest = k => { const r = hs.find(h => h[k] != null && h[k] !== ''); return r ? r[k] : null; };
  const w7 = hs.filter(h => diff(today(), h.date) < 7);
  const sumK = k => w7.reduce((s, h) => s + (+h[k] || 0), 0);
  return `<div class="sec"><h2>用藥提醒</h2>${isOwner() ? '<button class="btn small ghost" data-act="add-med">＋ 新增</button>' : ''}</div>
    <section class="card">${S.meds.length ? `<div class="list">${S.meds.map(m => `<div class="li${isOwner() ? ' click' : ''}" ${isOwner() ? `data-act="edit-med" data-id="${m.id}"` : ''}><span class="ic" style="--c:${m.active === false ? 'var(--faint)' : 'var(--plum)'};--c-soft:var(--plum-soft)">${svgI('pill')}</span>
      <div class="g"><div class="t">${esc(m.name)}${m.dose ? ` <span class="muted small">${esc(m.dose)}</span>` : ''}</div><div class="m">${(m.times || []).join('、')}${m.weekdays && m.weekdays.length ? '・週' + m.weekdays.map(w => WD[w % 7]).join('') : '・每天'}${m.end_date ? `・到 ${md(m.end_date)}` : ''}${m.active === false ? '・已停用' : ''}</div></div></div>`).join('')}</div>` : `<div class="empty">還沒有用藥提醒${isOwner() ? '（避孕藥、鐵劑、保健品都可以加）' : ''}</div>`}</section>
    <div class="sec"><h2>今日用藥</h2></div><section class="card">${medRows(medsToday())}</section>
    <div class="sec"><h2>健康追蹤</h2>${isOwner() ? '<button class="btn small ghost" data-act="add-health">＋ 記錄</button>' : ''}</div>
    <div class="rhythm">
      <div class="rt" style="--tc:var(--plum)"><div class="k">體重</div><div class="v">${latest('weight') ?? '—'}<small>${latest('weight') ? 'kg' : ''}</small></div><div class="s">最新一筆</div></div>
      <div class="rt" style="--tc:#5C8FB0"><div class="k">近 7 天喝水</div><div class="v">${w7.length ? Math.round(sumK('water_ml') / Math.max(1, w7.length)) : '—'}<small>${w7.length ? 'ml/天' : ''}</small></div><div class="s">${w7.length} 天有紀錄</div></div>
      <div class="rt" style="--tc:var(--luteal)"><div class="k">近 7 天運動</div><div class="v">${sumK('exercise_min') || '—'}<small>${sumK('exercise_min') ? '分鐘' : ''}</small></div><div class="s">步數 ${sumK('steps') ? sumK('steps').toLocaleString() : '—'}</div></div>
      <div class="rt" style="--tc:var(--period)"><div class="k">血壓／心率</div><div class="v" style="font-size:24px">${latest('bp_sys') ? `${latest('bp_sys')}/${latest('bp_dia') ?? '—'}` : '—'}</div><div class="s">靜止心率 ${latest('resting_hr') ?? '—'}</div></div>
    </div>
    <section class="card" style="margin-top:12px">${hs.length ? `<div class="list">${hs.slice(0, 12).map(h => `<div class="li${isOwner() ? ' click' : ''}" ${isOwner() ? `data-act="edit-health" data-id="${h.id}"` : ''}><span class="ic" style="--c:var(--luteal);--c-soft:var(--luteal-soft)">${svgI('pulse')}</span>
      <div class="g"><div class="t">${mdw(h.date)}</div><div class="m">${[h.weight ? `${h.weight} kg` : '', h.water_ml ? `水 ${h.water_ml} ml` : '', h.exercise_min ? `運動 ${h.exercise_min} 分` : '', h.steps ? `${(+h.steps).toLocaleString()} 步` : '', h.bp_sys ? `血壓 ${h.bp_sys}/${h.bp_dia || ''}` : '', h.checkup ? esc(h.checkup) : ''].filter(Boolean).join('・') || esc(h.note || '')}</div></div></div>`).join('')}</div>` : '<div class="empty">還沒有健康紀錄</div>'}</section>
    ${isOwner() ? contraBlock() : ''}`;
};
function contraBlock() {
  const c = S.contra, m = c && CONTRA.find(x => x[0] === c.method);
  return `<div class="sec"><h2>避孕資訊</h2><span class="r"><span class="badge">只有妳看得到</span></span></div>
    <section class="card"><div class="li click" data-act="edit-contra" style="border:0;padding-top:0"><span class="ic" style="--c:var(--ovu);--c-soft:var(--fertile-soft)">${svgI('shield')}</span>
      <div class="g"><div class="t">${m && m[0] ? esc(m[1]) : '尚未設定避孕方式'}</div><div class="m">${c && c.start_date ? `${md(c.start_date)} 開始` : '點這裡設定'}${c && c.next_date ? `・下次回診／更換 ${md(c.next_date)}` : ''}</div></div>${svgI('chevR')}</div>
      ${contraInfo(c && c.method)}</section>`;
}
function contraInfo(method) {
  const EFF = { implant: '0.1%', iud: '0.1–0.8%', injection: '4%', pill: '7%', ring: '7%', patch: '7%', condom: '13%', natural: '2–23%' };
  const TIP = {
    pill: '每天固定時間吃，可以在「用藥提醒」設成避孕藥。漏吃超過 24 小時、嘔吐或腹瀉時，避孕效果可能下降，請看藥袋說明或詢問醫師藥師。',
    condom: '全程使用、留意保存期限與尺寸；是唯一同時能降低性傳染病風險的方式。',
    iud: '放置後依類型可維持 3–10 年，記得設定回診日期。',
    implant: '可維持約 3 年，到期前記得回診更換。', injection: '約每 3 個月施打一次，把下次日期設在上方。',
    ring: '依產品週期放置與取出。', patch: '每週更換一次，依產品說明使用。',
    natural: '依體溫、分泌物與週期判斷易孕期，需要嚴格每天記錄；月汐的預測僅供參考，不建議單獨作為避孕方法。',
  };
  return `${method && EFF[method] ? `<div class="info-card"><h4>一般使用下一年懷孕機率約 ${EFF[method]}</h4>${TIP[method] || ''}</div>` : ''}
    <div class="info-card"><h4>緊急避孕</h4>沒有防護或避孕失敗時，越早處理越好：常見的緊急避孕藥建議 72 小時內服用，部分可到 120 小時。請盡快詢問醫師或藥師。</div>
    <p class="note">數字為一般使用情況下的參考值（美國 CDC 整理），實際請依醫師建議。</p>`;
}

/* ---------- 我的／設定 ---------- */
VIEWS.me = () => {
  const who = S.user ? esc(S.user.email) : '本機模式';
  const shareBlock = !CLOUD ? `<div class="warnbox">伴侶連動與行事曆提醒需要雲端同步。照 README 設定 Supabase 後即可使用。</div>` :
    isOwner() ? `${S.partners.length ? `<div class="list">${S.partners.map(p => `<div class="li"><span class="ic">${svgI('heart')}</span><div class="g"><div class="t">${esc(p.partner_name || '伴侶')}</div><div class="m">${md(p.created_at)} 連動</div></div><button class="btn small danger" data-act="unlink" data-pid="${p.partner_id}">解除</button></div>`).join('')}</div>` : '<p class="note" style="margin-top:0">產生邀請碼給他，他在自己的手機註冊月汐後輸入，就能看到妳分享的內容。</p>'}
      <button class="btn primary block" data-act="invite" style="margin-top:10px">${svgI('link')} 產生邀請碼</button>
      <div class="info-card"><h4>他看得到</h4>經期紀錄、排卵期、節奏（平均週期、平均生理期、下次月經、預計排卵日）、親密紀錄、藥物提醒、健康追蹤。<h4 style="margin-top:8px">只有妳看得到</h4>症狀、心情、睡眠品質、體溫、性慾感受、排卵試紙與分泌物、避孕資訊、每日備註。</div>` :
    `<div class="list"><div class="li"><span class="ic">${svgI('heart')}</span><div class="g"><div class="t">已連動她的月汐</div><div class="m">${S.share ? md(S.share.created_at) + ' 起' : ''}</div></div><button class="btn small danger" data-act="unlink" data-oid="${S.share && S.share.owner_id}">解除</button></div></div>`;
  return `<section class="card"><div class="li" style="border:0;padding:0"><span class="ic">${svgI('user')}</span><div class="g"><div class="t">${who}</div><div class="m">${CLOUD ? (isOwner() ? '記錄者' : '伴侶（唯讀）') : '資料只存在這台裝置'}</div></div>${CLOUD && S.user ? '<button class="btn small ghost" data-act="logout">登出</button>' : ''}</div></section>
    <div class="sec"><h2>伴侶連動</h2></div><section class="card">${shareBlock}</section>
    <div class="sec"><h2>行事曆提醒</h2></div><section class="card">${CLOUD ? calBlock() : '<div class="empty">需要雲端同步</div>'}</section>
    ${isOwner() ? `<div class="sec"><h2>資料</h2></div><section class="card"><div class="row-btns"><button class="btn ghost" data-act="export">匯出備份</button>${CLOUD ? '' : '<button class="btn ghost" data-act="demo">載入範例</button>'}</div><p class="note">月汐的預測與排卵判斷僅供參考，不能取代醫療建議，也不建議單獨作為避孕方法。</p></section>` : ''}
    <p class="note" style="text-align:center;margin-top:20px">月汐 Lunaria ${APP_VERSION}</p>`;
};
function calBlock() {
  if (!S.calToken) return `<p class="note" style="margin-top:0">產生專屬行事曆網址，用 Google 日曆或 iPhone 行事曆訂閱：預測經期、易孕期、排卵日和用藥時間會自動出現並提醒。</p><button class="btn primary block" data-act="cal-token">產生行事曆網址</button>`;
  const url = `${CFG.supabaseUrl.replace(/\/rest\/v1\/?$/, '')}/functions/v1/cal?token=${S.calToken}`;
  return `<div class="url">${esc(url)}</div><div class="row-btns" style="margin-top:10px"><button class="btn ghost" data-act="copy" data-v="${esc(url)}">${svgI('copy')} 複製網址</button><button class="btn ghost" data-act="cal-token" data-renew="1">換一組</button></div>
    <div class="info-card"><h4>Android（Google 日曆）</h4>用電腦打開 calendar.google.com → 左邊「其他日曆」旁的＋ →「透過網址新增」→ 貼上網址。手機上的 Google 日曆會自動同步，可以在該日曆的設定開啟通知。</div>
    <div class="info-card"><h4>iPhone</h4>設定 → 行事曆 → 帳號 → 加入帳號 → 其他 →「加入已訂閱的行事曆」→ 貼上網址。</div>
    <p class="note">這個網址等於鑰匙，不要公開分享；外流時按「換一組」，舊網址就會失效。行事曆通常幾小時更新一次。</p>`;
}

/* ---------- 表單 ---------- */
function daySheet(dateStr) {
  const l = S.logs.find(x => String(x.date).slice(0, 10) === dateStr) || {};
  const d = toD(dateStr);
  const intimOn = S.intimacy.some(x => ymd(new Date(x.at)) === dateStr);
  const flowBtns = FLOW.map(([v, t]) => `<button type="button" data-v="${v}" class="${+(l.flow || 0) === v ? 'on' : ''}"><span class="drops">${'<i></i>'.repeat(v)}</span>${t}</button>`).join('');
  sheet(`${mdw(d)} 的紀錄`, `
    <div class="fs"><div class="lab">經期 <span class="shr">伴侶看得到</span></div><div class="flow" data-pick="flow">${flowBtns}</div></div>
    <div class="fs"><div class="lab">症狀 <span class="priv">只有妳</span></div>${chips('symptoms', SYMPTOMS, l.symptoms, { multi: true })}</div>
    <div class="fs"><div class="lab">心情 <span class="priv">只有妳</span></div>${chips('moods', MOODS, l.moods, { multi: true })}</div>
    <div class="fs"><div class="lab">基礎體溫 <span class="priv">只有妳</span></div>
      <div class="temp-in"><button type="button" data-t="-0.05" aria-label="減少">−</button><input name="bbt" type="number" step="0.01" min="34" max="39" inputmode="decimal" placeholder="36.50" value="${l.bbt != null && l.bbt !== '' ? (+l.bbt).toFixed(2) : ''}"><button type="button" data-t="0.05" aria-label="增加">＋</button></div>
      <p class="note">起床後、下床前量，每天同一時間，精準到小數點後兩位。</p></div>
    <div class="fs"><div class="lab">排卵試紙 <span class="priv">只有妳</span></div>${chips('lh', LH, l.lh || '', { cls: 'f' })}
      <div class="lab" style="margin-top:14px">分泌物</div>${chips('mucus', MUCUS, l.mucus || '', { cls: 'f' })}</div>
    <div class="fs"><div class="lab">睡眠品質 <span class="priv">只有妳</span></div><div class="stars" data-pick="sleep_q">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-v="${n}" class="${(l.sleep_q || 0) >= n ? 'on' : ''}" aria-label="${n} 顆星">★</button>`).join('')}</div>
      <label class="f">睡了幾小時<input name="sleep_h" type="number" step="0.5" min="0" max="16" inputmode="decimal" value="${l.sleep_h ?? ''}" placeholder="7.5"></label></div>
    <div class="fs"><div class="lab">性慾感受 <span class="priv">只有妳</span></div>${chips('libido', LIBIDO, l.libido ?? '')}</div>
    <div class="fs"><div class="lab">親密 <span class="shr">伴侶看得到</span></div>${intimOn ? '<p class="note" style="margin:0">這天已有親密紀錄，可到「紀錄 → 親密」修改。</p>' : `${chips('intim', [['', '沒有'], ['1', '有']], '')}<div style="margin-top:10px">${chips('protection', PROTECT, 'condom')}</div>`}</div>
    <div class="fs"><div class="lab">備註 <span class="priv">只有妳</span></div><textarea name="note" placeholder="例：熬夜、壓力大、運動">${esc(l.note || '')}</textarea></div>`,
    {
      onSave: async f => {
        const bbt = f.bbt.value ? +(+f.bbt.value).toFixed(2) : null;
        const row = { date: dateStr, flow: +(pick1(f, 'flow') || 0), symptoms: picked(f, 'symptoms'), moods: picked(f, 'moods'), bbt, lh: pick1(f, 'lh') || null, mucus: pick1(f, 'mucus') || null,
          sleep_q: +(f.querySelectorAll('[data-pick="sleep_q"] button.on').length) || null, sleep_h: f.sleep_h.value ? +f.sleep_h.value : null, libido: pick1(f, 'libido') === '' ? null : +pick1(f, 'libido'), note: f.note.value.trim() || null, updated_at: new Date().toISOString() };
        if (CLOUD) row.user_id = S.ownerId;
        await DB.upsert('day_logs', row);
        if (row.flow > 0) await autoCycle(dateStr);
        if (!intimOn && pick1(f, 'intim') === '1') await DB.insert('intimacy', { user_id: S.ownerId, at: new Date(`${dateStr}T22:00:00`).toISOString(), protection: pick1(f, 'protection') || null });
        await refresh(); toast('已儲存');
      },
      onDelete: l.date ? async () => { await DB.remove('day_logs', CLOUD ? { user_id: S.ownerId, date: dateStr } : { date: dateStr }); await refresh(); } : null,
    });
  const f = $('#sheet form');
  // 星星：點第 n 顆就亮到第 n 顆
  f.querySelector('[data-pick="sleep_q"]').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const n = +b.dataset.v; setTimeout(() => f.querySelectorAll('[data-pick="sleep_q"] button').forEach(x => x.classList.toggle('on', +x.dataset.v <= n))); });
  f.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { const v = +(f.bbt.value || 36.5) + +b.dataset.t; f.bbt.value = v.toFixed(2); });
  f.querySelector('[data-pick="flow"]').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; f.querySelectorAll('[data-pick="flow"] button').forEach(x => x.classList.toggle('on', x === b)); });
}
/* 記了經量 → 自動延長或建立週期 */
async function autoCycle(dateStr) {
  const d = toD(dateStr);
  const near = S.cycles.map(c => ({ c, s: toD(c.start_date) })).filter(x => diff(d, x.s) >= -2 && diff(d, x.s) <= 12).sort((a, b) => b.s - a.s)[0];
  if (near) {
    if (diff(d, near.s) < 0) { await DB.update('cycles', near.c.id, { start_date: dateStr }); return; }
    if (!near.c.end_date || toD(near.c.end_date) < d) await DB.update('cycles', near.c.id, { end_date: dateStr });
    return;
  }
  const recent = S.cycles.some(c => Math.abs(diff(d, c.start_date)) < 15);
  if (!recent) { await DB.insert('cycles', CLOUD ? { user_id: S.ownerId, start_date: dateStr } : { start_date: dateStr }); toast(`已建立新週期：${md(d)} 開始`); }
}
function periodStartSheet() {
  sheet('月經來了', `<div class="fs"><label class="f" style="margin:0">第一天是哪天<input type="date" name="d" value="${ymd(today())}" max="${ymd(today())}"></label>
    <p class="note">之後每天在「記錄」裡標經量，月汐會自動算出結束日。</p></div>`, {
    saveLabel: '記錄', onSave: async f => {
      const d = f.d.value; if (!d) return false;
      const dup = S.cycles.find(c => Math.abs(diff(d, c.start_date)) < 10);
      if (dup) await DB.update('cycles', dup.id, { start_date: d });
      else await DB.insert('cycles', CLOUD ? { user_id: S.ownerId, start_date: d } : { start_date: d });
      const l = S.logs.find(x => String(x.date).slice(0, 10) === d);
      if (!l || !l.flow) await DB.upsert('day_logs', { ...(CLOUD ? { user_id: S.ownerId } : {}), date: d, flow: 3, updated_at: new Date().toISOString() });
      await refresh(); toast('已記錄，祝妳這幾天舒服一點');
    }
  });
}
function cycleSheet(id) {
  const c = S.cycles.find(x => x.id === id); if (!c) return;
  sheet('編輯經期', `<div class="fs"><div class="two"><label class="f" style="margin:0">開始<input type="date" name="s" value="${String(c.start_date).slice(0, 10)}"></label><label class="f" style="margin:0">結束<input type="date" name="e" value="${c.end_date ? String(c.end_date).slice(0, 10) : ''}"></label></div>
    <label class="f">備註<textarea name="note">${esc(c.note || '')}</textarea></label></div>`, {
    onSave: async f => { await DB.update('cycles', id, { start_date: f.s.value, end_date: f.e.value || null, note: f.note.value.trim() || null }); await refresh(); },
    onDelete: async () => { await DB.remove('cycles', { id }); await refresh(); },
  });
}
function intimacySheet(id) {
  const x = id ? S.intimacy.find(i => i.id === id) : null;
  const at = x ? new Date(x.at) : new Date();
  const lt = new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  sheet(x ? '編輯親密紀錄' : '新增親密紀錄', `<div class="fs"><label class="f" style="margin:0">時間<input type="datetime-local" name="at" value="${lt}"></label>
    <div class="lab" style="margin-top:14px">防護方式</div>${chips('protection', PROTECT, x ? x.protection : 'condom')}
    <label class="f">備註<input name="note" value="${esc(x ? x.note || '' : '')}" placeholder="選填"></label></div>
    ${!x ? '<p class="note">雙方都看得到這筆紀錄。</p>' : ''}`, {
    onSave: async f => {
      const row = { at: new Date(f.at.value).toISOString(), protection: pick1(f, 'protection') || null, note: f.note.value.trim() || null };
      if (x) await DB.update('intimacy', x.id, row); else await DB.insert('intimacy', { ...row, user_id: S.ownerId });
      const st = Cycle.dayStatus(A, new Date(f.at.value));
      await refresh(); toast(row.protection === 'none' && (st.fertile || st.ovulation) ? '已記錄・這天在易孕期，請留意' : '已記錄');
    },
    onDelete: x ? async () => { await DB.remove('intimacy', { id: x.id }); await refresh(); } : null,
  });
}
function medSheet(id) {
  const m = id ? S.meds.find(x => x.id === id) : null;
  sheet(m ? '編輯用藥' : '新增用藥提醒', `<div class="fs">
    <label class="f" style="margin:0">名稱<input name="name" required value="${esc(m ? m.name : '')}" placeholder="例：避孕藥、鐵劑、維他命 D"></label>
    <div class="two"><label class="f">劑量<input name="dose" value="${esc(m ? m.dose || '' : '')}" placeholder="1 顆"></label><label class="f">類型<select name="kind">${[['med', '藥物'], ['contraceptive', '避孕藥'], ['supplement', '保健品']].map(([v, l]) => `<option value="${v}" ${m && m.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <label class="f">提醒時間（可多個，用逗號分開）<input name="times" value="${esc(m && m.times ? m.times.join(', ') : '09:00')}" placeholder="08:00, 21:00"></label>
    <div class="lab" style="margin-top:14px">哪幾天（不選＝每天）</div>${chips('wd', [[1, '一'], [2, '二'], [3, '三'], [4, '四'], [5, '五'], [6, '六'], [7, '日']].map(([v, l]) => [String(v), l]), (m && m.weekdays || []).map(String), { multi: true })}
    <div class="two"><label class="f">開始<input type="date" name="s" value="${m && m.start_date ? String(m.start_date).slice(0, 10) : ymd(today())}"></label><label class="f">結束（選填）<input type="date" name="e" value="${m && m.end_date ? String(m.end_date).slice(0, 10) : ''}"></label></div>
    <label class="f">備註<input name="note" value="${esc(m ? m.note || '' : '')}"></label>
    ${m ? `<label class="f" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="active" ${m.active !== false ? 'checked' : ''} style="width:auto;margin:0"> 啟用中</label>` : ''}</div>
    <p class="note">伴侶看得到藥名與時間。行事曆訂閱會在這些時間提醒。</p>`, {
    onSave: async f => {
      const times = f.times.value.split(/[,，、\s]+/).map(t => t.trim()).filter(t => /^\d{1,2}:\d{2}$/.test(t)).map(t => t.padStart(5, '0'));
      const row = { name: f.name.value.trim(), dose: f.dose.value.trim() || null, kind: f.kind.value, times: times.length ? times : ['09:00'], weekdays: picked(f, 'wd').map(Number), start_date: f.s.value || null, end_date: f.e.value || null, note: f.note.value.trim() || null, active: m ? f.active.checked : true };
      if (!row.name) return false;
      if (m) await DB.update('meds', m.id, row); else await DB.insert('meds', CLOUD ? { ...row, user_id: S.ownerId } : row);
      await refresh();
    },
    onDelete: m ? async () => { await DB.remove('meds', { id: m.id }); await refresh(); } : null,
  });
}
function healthSheet(id) {
  const h = id ? S.health.find(x => x.id === id) : {};
  const v = k => h && h[k] != null ? h[k] : '';
  sheet(id ? '編輯健康紀錄' : '健康紀錄', `<div class="fs"><label class="f" style="margin:0">日期<input type="date" name="date" value="${h && h.date ? String(h.date).slice(0, 10) : ymd(today())}"></label>
    <div class="two"><label class="f">體重 kg<input name="weight" type="number" step="0.1" inputmode="decimal" value="${v('weight')}"></label><label class="f">喝水 ml<input name="water_ml" type="number" step="50" inputmode="numeric" value="${v('water_ml')}"></label></div>
    <div class="two"><label class="f">運動分鐘<input name="exercise_min" type="number" inputmode="numeric" value="${v('exercise_min')}"></label><label class="f">步數<input name="steps" type="number" inputmode="numeric" value="${v('steps')}"></label></div>
    <div class="two"><label class="f">收縮壓<input name="bp_sys" type="number" inputmode="numeric" value="${v('bp_sys')}"></label><label class="f">舒張壓<input name="bp_dia" type="number" inputmode="numeric" value="${v('bp_dia')}"></label></div>
    <label class="f">靜止心率<input name="resting_hr" type="number" inputmode="numeric" value="${v('resting_hr')}"></label>
    <label class="f">看診／檢查<input name="checkup" value="${esc(v('checkup'))}" placeholder="例：婦產科回診、抽血"></label>
    <label class="f">備註<input name="note" value="${esc(v('note'))}"></label></div><p class="note">伴侶看得到健康追蹤。</p>`, {
    onSave: async f => {
      const num = k => f[k].value === '' ? null : +f[k].value;
      const row = { date: f.date.value, weight: num('weight'), water_ml: num('water_ml'), exercise_min: num('exercise_min'), steps: num('steps'), bp_sys: num('bp_sys'), bp_dia: num('bp_dia'), resting_hr: num('resting_hr'), checkup: f.checkup.value.trim() || null, note: f.note.value.trim() || null };
      if (id) await DB.update('health', id, row); else await DB.insert('health', CLOUD ? { ...row, user_id: S.ownerId } : row);
      await refresh();
    },
    onDelete: id ? async () => { await DB.remove('health', { id }); await refresh(); } : null,
  });
}
function contraSheet() {
  const c = S.contra || {};
  sheet('避孕資訊', `<div class="fs"><label class="f" style="margin:0">目前方式<select name="method">${CONTRA.map(([v, l]) => `<option value="${v}" ${c.method === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="two"><label class="f">開始日<input type="date" name="s" value="${c.start_date ? String(c.start_date).slice(0, 10) : ''}"></label><label class="f">下次回診／更換<input type="date" name="n" value="${c.next_date ? String(c.next_date).slice(0, 10) : ''}"></label></div>
    <label class="f">備註<textarea name="note" placeholder="例：品牌、醫師交代事項">${esc(c.note || '')}</textarea></label></div>
    <p class="note">只有妳看得到。口服避孕藥建議也加到「用藥提醒」。</p>`, {
    onSave: async f => { await DB.upsert('contraception', { ...(CLOUD ? { user_id: S.ownerId } : {}), method: f.method.value || null, start_date: f.s.value || null, next_date: f.n.value || null, note: f.note.value.trim() || null, updated_at: new Date().toISOString() }); await refresh(); },
  });
}
function dayDetailPartner(dateStr) {
  const d = toD(dateStr), st = Cycle.dayStatus(A, d);
  const intim = S.intimacy.filter(x => ymd(new Date(x.at)) === dateStr);
  const tags = [st.period ? '經期' : '', st.predictedPeriod ? '預測經期' : '', st.ovulation ? (st.ovPredicted ? '預計排卵日' : '排卵日') : '', st.fertile ? '易孕期' : ''].filter(Boolean);
  sheet(mdw(d), `<div class="fs">${tags.length ? tags.map(t => `<span class="badge mid" style="margin-right:6px">${t}</span>`).join('') : '<span class="muted">一般日子</span>'}</div>
    <div class="fs"><div class="lab">親密紀錄</div>${intim.length ? `<div class="list">${intim.map(intimacyRow).join('')}</div>` : '<div class="empty">沒有紀錄</div>'}</div>
    <div class="fs"><div class="lab">這天的用藥</div>${medRows(medsToday(d), d)}</div>`, {});
}

/* ---------- 伴侶連動 ---------- */
async function makeInvite() {
  const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  const { error } = await sb.from('invites').insert({ code }); if (error) throw error;
  sheet('邀請碼', `<div class="fs"><div class="code">${code}</div><p class="note">把這組碼傳給他。他打開月汐 → 註冊 → 選「我是伴侶」→ 輸入邀請碼。<br>48 小時內有效，只能用一次。</p></div>
    <div class="fs"><div class="lab">月汐網址</div><div class="url">${esc(location.href.split('#')[0])}</div></div>`, {});
}
async function redeem(code, name) {
  const { data, error } = await sb.rpc('redeem_invite', { p_code: code, p_name: name || null });
  if (error) throw new Error(error.message.includes('邀請碼') ? '邀請碼無效或已過期' : error.message);
  return data;
}
async function makeCalToken(renew) {
  const tok = Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
  const { error } = await sb.from('cal_tokens').upsert({ user_id: S.user.id, token: tok }, { onConflict: 'user_id' }); if (error) throw error;
  S.calToken = tok; render(); toast(renew ? '已換新網址，舊的失效了' : '已產生');
}

/* ---------- 導覽與畫面 ---------- */
const NAV_OWNER = [['today', '今天', 'home'], ['cal', '月曆', 'cal'], ['records', '紀錄', 'list'], ['health', '健康', 'leaf'], ['me', '我的', 'user']];
const NAV_PARTNER = [['today', '她的今天', 'home'], ['cal', '月曆', 'cal'], ['records', '紀錄', 'heart'], ['health', '健康', 'leaf'], ['me', '設定', 'user']];
let render = function () {
  const nav = isOwner() ? NAV_OWNER : NAV_PARTNER;
  if (!nav.some(n => n[0] === S.tab) && S.tab !== 'remind') S.tab = 'today';
  $('#nav').innerHTML = nav.map(([k, l, ic]) => `<button data-act="tab" data-tab="${k}" class="${S.tab === k ? 'on' : ''}" aria-current="${S.tab === k ? 'page' : 'false'}">${svgI(ic)}${l}</button>`).join('');
  $('#view').innerHTML = VIEWS[S.tab]();
  $('#view').classList.toggle('mask', S.mask);
  $('#hideBtn').innerHTML = svgI(S.mask ? 'eyeOff' : 'eye');
  const rp = $('#rolePill'); rp.hidden = isOwner(); rp.textContent = '伴侶模式';
}
async function refresh() { try { await loadAll(); } catch (e) { toast('讀取失敗：' + e.message); } render(); }

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act;
  try {
    switch (a) {
      case 'tab': S.tab = el.dataset.tab; render(); scrollTo(0, 0); break;
      case 'hide': S.mask = !S.mask; try { localStorage.setItem('lun_mask', S.mask ? '1' : '0'); } catch (_) { } render(); break;
      case 'log': closeSheet(); daySheet(el.dataset.date); break;
      case 'day': isOwner() ? daySheet(el.dataset.date) : dayDetailPartner(el.dataset.date); break;
      case 'month': { const m = S.month || new Date(today().getFullYear(), today().getMonth(), 1); const d = +el.dataset.d; S.month = d === 0 ? null : new Date(m.getFullYear(), m.getMonth() + d, 1); render(); break; }
      case 'period-start': periodStartSheet(); break;
      case 'period-end': { const c = S.cycles.slice().sort((x, y) => String(y.start_date).localeCompare(String(x.start_date)))[0]; if (c) { await DB.update('cycles', c.id, { end_date: ymd(today()) }); await refresh(); toast(`經期 ${diff(today(), c.start_date) + 1} 天，已記錄`); } break; }
      case 'edit-cycle': cycleSheet(el.dataset.id); break;
      case 'add-intimacy': intimacySheet(); break;
      case 'edit-intimacy': closeSheet(); intimacySheet(el.dataset.id); break;
      case 'add-med': medSheet(); break;
      case 'edit-med': medSheet(el.dataset.id); break;
      case 'add-health': healthSheet(); break;
      case 'edit-health': healthSheet(el.dataset.id); break;
      case 'edit-contra': contraSheet(); break;
      case 'rec-tab': S.recTab = el.dataset.k; render(); break;
      case 'med-tick': {
        const m = { med_id: el.dataset.id, date: el.dataset.date, slot: el.dataset.slot };
        const done = S.medLogs.some(l => l.med_id === m.med_id && String(l.date).slice(0, 10) === m.date && l.slot === m.slot);
        if (done) await DB.remove('med_logs', m); else await DB.insert('med_logs', CLOUD ? { ...m, user_id: S.ownerId } : m);
        await refresh(); break;
      }
      case 'invite': await makeInvite(); break;
      case 'unlink': if (!confirm('確定要解除連動嗎？對方將看不到任何資料。')) break;
        if (el.dataset.pid) await sb.from('shares').delete().eq('owner_id', S.user.id).eq('partner_id', el.dataset.pid);
        else await sb.from('shares').delete().eq('owner_id', el.dataset.oid).eq('partner_id', S.user.id);
        await boot(); toast('已解除連動'); break;
      case 'cal-token': await makeCalToken(!!el.dataset.renew); break;
      case 'copy': await navigator.clipboard.writeText(el.dataset.v); toast('已複製'); break;
      case 'export': { const blob = new Blob([JSON.stringify({ app: 'lunaria', version: APP_VERSION, exported: new Date().toISOString(), cycles: S.cycles, day_logs: S.logs, intimacy: S.intimacy, meds: S.meds, med_logs: S.medLogs, health: S.health, contraception: S.contra }, null, 2)], { type: 'application/json' }); const u = URL.createObjectURL(blob); const x = document.createElement('a'); x.href = u; x.download = `lunaria-${ymd(today())}.json`; x.click(); URL.revokeObjectURL(u); break; }
      case 'demo': await loadDemo(); break;
      case 'logout': await sb.auth.signOut(); location.reload(); break;
    }
  } catch (err) { toast('出錯了：' + (err.message || err)); }
});

/* ---------- 範例資料（本機模式試用） ---------- */
async function loadDemo() {
  const t = today(), starts = [-118, -89, -59, -31, -2].map(n => add(t, n));
  for (const s of starts) await DB.insert('cycles', { start_date: ymd(s), end_date: ymd(add(s, 4)) });
  const cur = starts[starts.length - 1], prev = starts[starts.length - 2];
  for (let i = 0; i < 29; i++) { const d = add(prev, i); await DB.upsert('day_logs', { date: ymd(d), bbt: +(i < 16 ? 36.3 + (i % 4) * .04 : 36.72 + (i % 2) * .04).toFixed(2), flow: i < 5 ? [3, 4, 3, 2, 1][i] : 0, lh: i === 14 ? 'peak' : null, mucus: i === 13 ? 'eggwhite' : null, symptoms: i < 2 ? ['經痛', '腰痠'] : i > 24 ? ['腹脹', '痘痘'] : [], moods: i > 24 ? ['敏感'] : ['平靜'], sleep_q: 3 + (i % 3 === 0 ? 1 : 0), sleep_h: 7, libido: i > 10 && i < 16 ? 3 : 1 }); }
  for (let i = 0; i < 3; i++) await DB.upsert('day_logs', { date: ymd(add(cur, i)), flow: [3, 4, 3][i], bbt: +(36.35 + i * .03).toFixed(2), symptoms: ['經痛'], moods: ['想被抱抱'], sleep_q: 3 });
  await DB.insert('meds', { name: '鐵劑', dose: '1 顆', kind: 'supplement', times: ['09:00'], weekdays: [], start_date: ymd(add(t, -30)), active: true });
  await DB.insert('health', { date: ymd(t), weight: 52.4, water_ml: 1800, exercise_min: 30, steps: 7200 });
  await DB.insert('intimacy', { at: add(prev, 12).toISOString(), protection: 'condom' });
  await refresh(); toast('已載入範例資料');
}

/* ---------- 啟動 ---------- */
let boot = async function () {
  if (!CLOUD) { S.role = 'owner'; S.ownerId = 'local'; $('#app').hidden = false; await refresh(); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $('#auth').hidden = false; $('#app').hidden = true; return; }
  S.user = session.user; $('#auth').hidden = true;
  const { data: sh } = await sb.from('shares').select('*');
  const asPartner = (sh || []).find(x => x.partner_id === S.user.id);
  S.partners = (sh || []).filter(x => x.owner_id === S.user.id);
  const { data: tok } = await sb.from('cal_tokens').select('token').eq('user_id', S.user.id).maybeSingle();
  S.calToken = tok ? tok.token : null;
  const pref = localStorage.getItem('lun_role_' + S.user.id);
  if (asPartner) { S.role = 'partner'; S.share = asPartner; S.ownerId = asPartner.owner_id; }
  else if (pref === 'owner') { S.role = 'owner'; S.ownerId = S.user.id; }
  else {
    const { count } = await sb.from('cycles').select('id', { count: 'exact', head: true }).eq('user_id', S.user.id);
    if (count > 0) { S.role = 'owner'; S.ownerId = S.user.id; localStorage.setItem('lun_role_' + S.user.id, 'owner'); }
    else { $('#app').hidden = false; return chooseRole(); }
  }
  $('#app').hidden = false; await refresh();
}
function chooseRole() {
  $('#view').innerHTML = `<section class="card hero"><div class="logo big" style="margin:10px 0 6px">${$('.logo svg').outerHTML}<span>月汐<small>LUNARIA</small></span></div>
    <p class="hero-sub">第一次使用，妳是哪一位？</p>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:14px"><button class="btn period block" id="asOwner">我要記錄自己的週期</button><button class="btn ghost block" id="asPartner">我是伴侶，輸入邀請碼</button></div></section>`;
  $('#nav').innerHTML = '';
  $('#asOwner').onclick = async () => { localStorage.setItem('lun_role_' + S.user.id, 'owner'); S.role = 'owner'; S.ownerId = S.user.id; await refresh(); };
  $('#asPartner').onclick = () => sheet('輸入邀請碼', `<div class="fs"><label class="f" style="margin:0">邀請碼<input name="code" required autocomplete="off" style="text-transform:uppercase;letter-spacing:.3em;font-size:22px;text-align:center" maxlength="6"></label><label class="f">妳／你的稱呼（她會看到）<input name="name" placeholder="例：Alex"></label></div>`, {
    saveLabel: '連動', onSave: async f => { await redeem(f.code.value, f.name.value.trim()); toast('連動成功'); await boot(); },
  });
}
$('#authForm')?.addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target; $('#authErr').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: f.email.value, password: f.password.value });
  if (error) $('#authErr').textContent = error.message.includes('Invalid') ? 'Email 或密碼不正確' : error.message; else boot();
});
$('#signupBtn')?.addEventListener('click', async () => {
  const f = $('#authForm'); if (!f.email.value || f.password.value.length < 6) { $('#authErr').textContent = '請填 Email 和至少 6 碼的密碼'; return; }
  const { error } = await sb.auth.signUp({ email: f.email.value, password: f.password.value });
  $('#authErr').textContent = error ? error.message : '註冊成功！如果 Supabase 有開信箱驗證，請先到信箱點連結再登入。';
  if (!error) boot();
});

/* ================================================================
 * v1.1：提醒頁、健康小圖表、我的（設定清單）、主題、密碼鎖
 * ================================================================ */
/* ---------- 今日提醒 ---------- */
function todayReminders() {
  const out = [], c = A.current, t = today();
  if (!c) return out;
  const last = A.cycles[A.cycles.length - 1];
  if (SET.rm.tips && (c.inPeriod || (last && !last.e && c.cycleDay <= 8))) out.push({ ic: 'moon', c: 'var(--period)', cs: 'var(--period-soft)', t: `經期第 ${c.cycleDay} 天`, m: c.cycleDay <= 2 ? '多喝溫水、注意保暖，經痛可以熱敷下腹' : '記得補充水分與鐵質，適度休息' });
  const od = diff(c.ovulation, t);
  if (SET.rm.ovu && od >= -1 && od <= 6) out.push({ ic: 'spark', c: 'var(--ovu)', cs: 'var(--fertile-soft)', t: od > 0 ? '接近排卵期' : od === 0 ? '今天是排卵日' : '剛過排卵日', m: `${od > 0 ? '預計' : ''}${md(c.ovulation)}${c.ovMethod === 'predicted' ? ` 左右（±${c.ovRange} 天）` : `（${OV_L[c.ovMethod]}）`}・易孕 ${md(c.fertileStart)}–${md(c.fertileEnd)}` });
  const nd = diff(c.nextStart, t);
  if (SET.rm.period && nd >= -3 && nd <= 7) out.push({ ic: 'cal', c: 'var(--period)', cs: 'var(--period-soft)', t: nd > 0 ? '下次月經提醒' : nd === 0 ? '月經預計今天來' : `月經晚了 ${-nd} 天`, m: nd > 0 ? `預計 ${mdw(c.nextStart)}（${nd} 天後），可以先準備用品` : '來了記得點「月經來了」' });
  if (SET.rm.tips && !c.inPeriod && phaseOf() && phaseOf().k === 'luteal' && nd > 0 && nd <= 5) out.push({ ic: 'leaf', c: 'var(--luteal)', cs: 'var(--luteal-soft)', t: '經前期', m: '可能比較容易累或情緒起伏，早點休息、減少咖啡因' });
  if (isOwner() && S.contra && S.contra.next_date) { const k = diff(S.contra.next_date, t); if (k >= 0 && k <= 7) out.push({ ic: 'shield', c: 'var(--plum)', cs: 'var(--plum-soft)', t: '避孕回診／更換', m: `${mdw(S.contra.next_date)}（${k === 0 ? '今天' : k + ' 天後'}）` }); }
  return out;
}
VIEWS.remind = () => {
  const rms = todayReminders(), meds = medsToday();
  return `<div class="page-h"><h2>用藥提醒</h2>${isOwner() ? '<button class="btn small ghost" data-act="add-med">＋ 新增</button>' : ''}</div>
    <section class="card">${S.meds.length ? medRows(meds) + (S.meds.some(m => m.active === false) ? '' : '') : `<div class="empty">還沒有用藥提醒${isOwner() ? '（避孕藥、鐵劑、保健品都可以加）' : ''}</div>`}
      ${S.meds.length && isOwner() ? `<button class="btn small ghost" data-act="tab" data-tab="health" style="margin-top:10px">管理全部藥物</button>` : ''}</section>
    <div class="sec"><h2>今日提醒</h2><span class="r">${rms.length ? rms.length + ' 則' : ''}</span></div>
    ${rms.length ? rms.map(r => `<div class="rm"><span class="ic" style="--c:${r.c};--c-soft:${r.cs}">${svgI(r.ic)}</span><div><div class="t">${esc(r.t)}</div><div class="m">${esc(r.m)}</div></div></div>`).join('') : '<section class="card"><div class="empty">今天沒有特別的提醒</div></section>'}
    ${CLOUD ? `<p class="note" style="margin:14px 4px">想在手機收到通知：到「我的 → 行事曆提醒」訂閱，Google 日曆／iPhone 行事曆會依時間跳出提醒。</p>` : ''}`;
};

/* ---------- 健康：小圖表 ---------- */
function sparkLine(vals) {
  const v = vals.filter(x => x != null); if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v), sp = hi - lo || 1, n = vals.length;
  const pts = vals.map((x, i) => x == null ? null : [i / (n - 1) * 100, 36 - (x - lo) / sp * 28]).filter(Boolean);
  return `<svg class="sp" viewBox="0 0 100 40" preserveAspectRatio="none"><path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')}"/>${pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="1.6"/>`).join('')}</svg>`;
}
function sparkBars(vals, goal) {
  const mx = Math.max(goal || 0, ...vals.map(x => x || 0)) || 1, n = vals.length, w = 100 / n;
  return `<svg class="sp" viewBox="0 0 100 40" preserveAspectRatio="none">${vals.map((x, i) => { const h = Math.max(2, (x || 0) / mx * 38); return `<rect x="${(i * w + w * .22).toFixed(1)}" y="${(40 - h).toFixed(1)}" width="${(w * .56).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" class="${goal && (x || 0) < goal ? 'lo' : ''}"/>`; }).join('')}</svg>`;
}
VIEWS.health = () => {
  const hs = S.health.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const t = today(), days = Array.from({ length: 7 }, (_, i) => ymd(add(t, i - 6)));
  const byDay = k => days.map(d => { const r = hs.filter(h => String(h.date).slice(0, 10) === d && h[k] != null && h[k] !== ''); return r.length ? r.reduce((s, h) => s + +h[k], 0) : null; });
  const wts = hs.filter(h => h.weight != null && h.weight !== '').slice(-10);
  const wNow = wts.length ? +wts[wts.length - 1].weight : null;
  const wWeek = wts.filter(h => diff(t, h.date) >= 7).pop();
  const water = byDay('water_ml'), ex = byDay('exercise_min'), steps = byDay('steps');
  const waterToday = water[6] ?? [...water].reverse().find(x => x != null);
  const bps = hs.filter(h => h.bp_sys).slice(-10), bp = bps[bps.length - 1];
  const exSum = ex.reduce((s, x) => s + (x || 0), 0), stSum = steps.reduce((s, x) => s + (x || 0), 0);
  const range = `${md(days[0])} – ${md(days[6])}`;
  const cyc = A.cycles.filter(c => c.length).slice(-4).reverse(), mx = Math.max(35, ...cyc.map(c => c.length));
  return `<div class="page-h"><h2>健康追蹤</h2><span class="badge">${range}</span></div>
    <div class="hgrid">
      <div class="hc" style="--tc:var(--plum)" ${isOwner() ? 'data-act="add-health"' : ''}><div class="k">體重</div><div class="v">${wNow ?? '—'}<small>${wNow ? 'kg' : ''}</small></div><div class="s">${wNow && wWeek ? `較一週前 ${(wNow - wWeek.weight >= 0 ? '+' : '')}${(wNow - wWeek.weight).toFixed(1)} kg` : '點一下記錄'}</div>${sparkLine(wts.map(h => +h.weight))}</div>
      <div class="hc" style="--tc:var(--fertile)" ${isOwner() ? 'data-act="add-health"' : ''}><div class="k">水分</div><div class="v">${waterToday ?? '—'}<small>${waterToday ? 'ml' : ''}</small></div><div class="s">${waterToday ? `達成 ${Math.round(waterToday / SET.waterGoal * 100)}%・目標 ${SET.waterGoal}` : `每日目標 ${SET.waterGoal} ml`}</div>${sparkBars(water, SET.waterGoal)}</div>
      <div class="hc" style="--tc:var(--luteal)" ${isOwner() ? 'data-act="add-health"' : ''}><div class="k">運動</div><div class="v">${exSum || '—'}<small>${exSum ? '分鐘' : ''}</small></div><div class="s">近 7 天・步數 ${stSum ? stSum.toLocaleString() : '—'}</div>${sparkBars(ex, SET.exGoal)}</div>
      <div class="hc" style="--tc:var(--period)" ${isOwner() ? 'data-act="add-health"' : ''}><div class="k">血壓／心率</div><div class="v" style="font-size:24px">${bp ? `${bp.bp_sys}/${bp.bp_dia || '—'}` : '-- / --'}</div><div class="s">${bp ? `${md(bp.date)}・心率 ${bp.resting_hr ?? '—'}` : '暫無紀錄'}</div>${sparkLine(bps.map(h => +h.bp_sys))}</div>
    </div>
    <div class="sec"><h2>近期週期</h2><span class="r">平均 ${r1(A.avgCycle)} 天</span></div>
    <section class="card">${cyc.length ? `<div class="stat-bars">${cyc.map(c => `<div class="sb"><span>${md(c.s)}</span><span class="bar"><i style="width:${c.length / mx * 100}%"></i></span><span>${c.length} 天</span></div>`).join('')}</div>` : '<div class="empty">累積兩次以上月經就會出現</div>'}
      <button class="btn ghost block" data-act="health-report" style="margin-top:12px">${svgI('pulse')} 詳細健康報告</button></section>
    <div class="sec"><h2>用藥</h2>${isOwner() ? '<button class="btn small ghost" data-act="add-med">＋ 新增</button>' : ''}</div>
    <section class="card">${S.meds.length ? `<div class="list">${S.meds.map(m => `<div class="li${isOwner() ? ' click' : ''}" ${isOwner() ? `data-act="edit-med" data-id="${m.id}"` : ''}><span class="ic" style="--c:${m.active === false ? 'var(--faint)' : 'var(--plum)'};--c-soft:var(--plum-soft)">${svgI('pill')}</span>
      <div class="g"><div class="t">${esc(m.name)}${m.dose ? ` <span class="muted small">${esc(m.dose)}</span>` : ''}</div><div class="m">${(m.times || []).join('、')}${m.weekdays && m.weekdays.length ? '・週' + m.weekdays.map(w => WD[w % 7]).join('') : '・每天'}${m.active === false ? '・已停用' : ''}</div></div></div>`).join('')}</div>` : '<div class="empty">還沒有用藥</div>'}</section>
    ${isOwner() ? contraBlock() : ''}`;
};
function healthReport() {
  const hs = S.health.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const avg = k => { const v = hs.filter(h => h[k] != null && h[k] !== '' && diff(today(), h.date) < 30).map(h => +h[k]); return v.length ? r1(v.reduce((s, x) => s + x, 0) / v.length) : '—'; };
  sheet('詳細健康報告', `<div class="fs"><div class="lab">近 30 天平均</div><div class="two">
      <div><div class="muted small">體重</div><b>${avg('weight')} kg</b></div><div><div class="muted small">喝水</div><b>${avg('water_ml')} ml</b></div>
      <div><div class="muted small">運動</div><b>${avg('exercise_min')} 分</b></div><div><div class="muted small">步數</div><b>${avg('steps')}</b></div>
      <div><div class="muted small">收縮壓</div><b>${avg('bp_sys')}</b></div><div><div class="muted small">靜止心率</div><b>${avg('resting_hr')}</b></div></div></div>
    <div class="fs"><div class="lab">週期</div><p class="note" style="margin:0">平均週期 ${r1(A.avgCycle)} 天（${A.minCycle ?? '—'}–${A.maxCycle ?? '—'}）、平均經期 ${r1(A.avgPeriod)} 天、黃體期 ${A.luteal} 天${A.lutealSamples ? '（個人數據）' : '（預設）'}。${A.irregular ? '近期週期變化較大。' : ''}</p></div>
    <div class="fs"><div class="lab">所有紀錄</div>${hs.length ? `<div class="list">${hs.map(h => `<div class="li${isOwner() ? ' click' : ''}" ${isOwner() ? `data-act="edit-health" data-id="${h.id}"` : ''}><span class="ic" style="--c:var(--luteal);--c-soft:var(--luteal-soft)">${svgI('pulse')}</span><div class="g"><div class="t">${mdw(h.date)}</div><div class="m">${[h.weight ? `${h.weight} kg` : '', h.water_ml ? `水 ${h.water_ml} ml` : '', h.exercise_min ? `運動 ${h.exercise_min} 分` : '', h.steps ? `${(+h.steps).toLocaleString()} 步` : '', h.bp_sys ? `血壓 ${h.bp_sys}/${h.bp_dia || ''}` : '', h.checkup ? esc(h.checkup) : ''].filter(Boolean).join('・') || esc(h.note || '')}</div></div></div>`).join('')}</div>` : '<div class="empty">還沒有健康紀錄</div>'}</div>`, {});
}

/* ---------- 我的：設定清單 ---------- */
function meHero() {
  return `<svg viewBox="0 0 400 170" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id="mh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--hero3)"/><stop offset="1" style="stop-color:var(--hero1)"/></linearGradient>
      <radialGradient id="mg" cx="70%" cy="34%" r="40%"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
    <rect width="400" height="170" fill="url(#mh)"/><rect width="400" height="170" fill="url(#mg)"/>
    <circle cx="282" cy="58" r="26" fill="#FBF6EA" opacity=".95"/><circle cx="294" cy="50" r="24" style="fill:var(--hero3)" opacity=".9"/>
    ${[[40, 30], [90, 18], [150, 40], [210, 22], [340, 30], [370, 70], [120, 70]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="#fff" opacity=".8"/>`).join('')}
    <path d="M0 120 60 96 110 112 170 84 230 110 290 90 350 108 400 96V170H0Z" style="fill:var(--hero2)" opacity=".85"/>
    <path d="M0 140 80 118 150 136 220 116 300 138 360 124 400 132V170H0Z" style="fill:var(--hero1)" opacity=".95"/>
    <path d="M30 170c8-30 22-46 40-56M44 140c-10-4-18-2-24 4M52 128c-10-6-20-6-26 0M60 120c-6-8-14-10-22-8" stroke="#fff" stroke-opacity=".55" stroke-width="2" fill="none" stroke-linecap="round"/>
  </svg>`;
}
const so = (act, ic, label, right = '', extra = '') => `<button class="so" data-act="${act}" ${extra}>${svgI(ic)}<span class="g">${label}</span><span class="r">${right}${svgI('chevR')}</span></button>`;
VIEWS.me = () => {
  const who = S.user ? esc(S.user.email.split('@')[0]) : '本機模式';
  const modeL = { auto: '自動切換', day: '白天', night: '夜間' }[SET.mode];
  return `<div class="me-hero">${meHero()}<div class="who"><b>${who}</b><span>${CLOUD ? (isOwner() ? '記錄者' : '伴侶・唯讀') : '資料只存在這台裝置'}</span></div></div>
    <section class="card set">
      ${isOwner() ? so('set-cycle', 'cycle', '週期設定', `${r1(A.avgCycle)} 天`) : ''}
      ${so('set-remind', 'bell', '提醒設定')}
      ${isOwner() ? so('set-goal', 'target', '健康目標', `${SET.waterGoal} ml`) : ''}
      ${so('set-theme', 'palette', '主題模式', modeL)}
      <button class="so" data-act="set-pin">${svgI('lock')}<span class="g">密碼鎖</span><span class="tgl${SET.pin ? ' on' : ''}" aria-hidden="true"></span></button>
      ${isOwner() ? so('set-backup', 'cloud', '資料備份') : ''}
      ${isOwner() ? so('export-csv', 'download', '匯出資料', 'CSV') : ''}
      ${so('about', 'info', '關於月汐', 'v' + APP_VERSION)}
    </section>
    <div class="sec"><h2>伴侶連動</h2></div><section class="card">${!CLOUD ? '<div class="warnbox">伴侶連動與行事曆提醒需要雲端同步。照 README 設定 Supabase 後即可使用。</div>' :
      isOwner() ? `${S.partners.length ? `<div class="list">${S.partners.map(p => `<div class="li"><span class="ic">${svgI('heart')}</span><div class="g"><div class="t">${esc(p.partner_name || '伴侶')}</div><div class="m">${md(p.created_at)} 連動</div></div><button class="btn small danger" data-act="unlink" data-pid="${p.partner_id}">解除</button></div>`).join('')}</div>` : '<p class="note" style="margin-top:0">產生邀請碼給他，他註冊月汐後輸入，就能看到妳分享的內容。</p>'}
        <button class="btn primary block" data-act="invite" style="margin-top:10px">${svgI('link')} 產生邀請碼</button>
        <div class="info-card"><h4>他看得到</h4>經期紀錄、排卵期、節奏、親密紀錄、藥物提醒、健康追蹤。<h4 style="margin-top:8px">只有妳看得到</h4>症狀、心情、睡眠、體溫、性慾、試紙與分泌物、避孕資訊、備註。</div>` :
      `<div class="list"><div class="li"><span class="ic">${svgI('heart')}</span><div class="g"><div class="t">已連動她的月汐</div><div class="m">${S.share ? md(S.share.created_at) + ' 起' : ''}</div></div><button class="btn small danger" data-act="unlink" data-oid="${S.share && S.share.owner_id}">解除</button></div></div>`}</section>
    <div class="sec"><h2>行事曆提醒</h2></div><section class="card">${CLOUD ? calBlock() : '<div class="empty">需要雲端同步</div>'}</section>
    ${CLOUD && S.user ? '<button class="btn ghost block" data-act="logout" style="margin-top:16px">登出</button>' : ''}
    ${!CLOUD && isOwner() ? '<button class="btn ghost block" data-act="demo" style="margin-top:16px">載入範例資料</button>' : ''}`;
};
function setCycleSheet() {
  sheet('週期設定', `<div class="fs"><p class="note" style="margin-top:0">還沒有足夠紀錄時，用這裡的數字預測；記錄 2 次以上月經後，會自動改用妳的實際平均。</p>
    <div class="two"><label class="f">預設週期長度（天）<input name="c" type="number" min="18" max="50" value="${SET.cycleLen}"></label><label class="f">預設經期天數<input name="p" type="number" min="1" max="12" value="${SET.periodLen}"></label></div>
    <label class="f">黃體期（天）<select name="l"><option value="0" ${!SET.luteal ? 'selected' : ''}>自動（用體溫確認的週期計算，預設 14）</option>${[10, 11, 12, 13, 14, 15, 16].map(n => `<option value="${n}" ${SET.luteal === n ? 'selected' : ''}>固定 ${n} 天</option>`).join('')}</select></label>
    <p class="note">黃體期＝排卵到下次月經的天數，大多數人很固定。醫師幫妳確認過的話可以直接設定，排卵預測會更準。</p></div>
    <div class="fs"><div class="lab">目前計算結果</div><p class="note" style="margin:0">平均週期 ${r1(A.avgCycle)} 天・平均經期 ${r1(A.avgPeriod)} 天・黃體期 ${A.luteal} 天（${A.lutealSamples ? `${A.lutealSamples} 個週期確認` : '預設值'}）</p></div>`, {
    onSave: async f => { SET.cycleLen = Math.min(50, Math.max(18, +f.c.value || 28)); SET.periodLen = Math.min(12, Math.max(1, +f.p.value || 5)); SET.luteal = +f.l.value || 0; saveSet(); await refresh(); toast('已更新'); },
  });
}
function setRemindSheet() {
  const row = (k, l, d) => `<button type="button" class="so" data-rm="${k}" style="padding:12px 0">${svgI('bell')}<span class="g">${l}<div class="muted small" style="font-weight:500">${d}</div></span><span class="tgl${SET.rm[k] ? ' on' : ''}"></span></button>`;
  const f = sheet('提醒設定', `<div class="fs set">${row('period', '下次月經提醒', '預計日前 7 天開始提醒')}${row('ovu', '排卵期提醒', '排卵日前 6 天到後 1 天')}${row('med', '用藥提醒', '今日用藥清單')}${row('tips', '經期與經前小提醒', '照顧自己的建議')}</div>
    <p class="note">這裡控制 App 內「今日提醒」。要手機跳通知，請到「我的 → 行事曆提醒」訂閱。</p>`, { onSave: async () => { saveSet(); render(); } });
  f.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const k = b.dataset.rm; SET.rm[k] = !SET.rm[k]; b.querySelector('.tgl').classList.toggle('on', SET.rm[k]); });
}
function setGoalSheet() {
  sheet('健康目標', `<div class="fs"><label class="f" style="margin:0">每日喝水（ml）<input name="w" type="number" step="100" value="${SET.waterGoal}"></label>
    <div class="two"><label class="f">每日運動（分鐘）<input name="e" type="number" value="${SET.exGoal}"></label><label class="f">每日步數<input name="s" type="number" step="500" value="${SET.stepGoal}"></label></div></div>`, {
    onSave: async f => { SET.waterGoal = +f.w.value || 2000; SET.exGoal = +f.e.value || 30; SET.stepGoal = +f.s.value || 8000; saveSet(); render(); },
  });
}
function setThemeSheet() {
  const f = sheet('主題模式', `<div class="fs"><div class="lab">配色</div><div class="pal-pick">${Object.entries(PALS).map(([k, [n, c]]) => `<button type="button" data-pal="${k}" class="${SET.pal === k ? 'on' : ''}"><span class="sw">${c.map(x => `<i style="background:${x}"></i>`).join('')}</span>${n}</button>`).join('')}</div></div>
    <div class="fs"><div class="lab">白天／夜間</div><div class="seg">${[['auto', '自動切換'], ['day', '白天'], ['night', '夜間']].map(([k, l]) => `<button type="button" data-mode="${k}" class="${SET.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <p class="note">自動切換會跟著手機的深色模式。</p></div>`, {});
  f.querySelectorAll('[data-pal]').forEach(b => b.onclick = () => { SET.pal = b.dataset.pal; saveSet(); applyTheme(); f.querySelectorAll('[data-pal]').forEach(x => x.classList.toggle('on', x === b)); render(); });
  f.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { SET.mode = b.dataset.mode; saveSet(); applyTheme(); f.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('on', x === b)); render(); });
}
function setBackupSheet() {
  const f = sheet('資料備份', `<div class="fs"><p class="note" style="margin-top:0">${CLOUD ? '資料已即時同步到妳的 Supabase。' : '目前資料只存在這台裝置。'}建議每個月下載一次備份，存到雲端硬碟。</p>
    <div class="row-btns"><button type="button" class="btn ghost" data-act="export">${svgI('download')} 下載備份</button><label class="btn ghost" style="cursor:pointer">${svgI('upload')} 還原備份<input type="file" accept="application/json" hidden id="restoreFile"></label></div></div>`, {});
  $('#restoreFile', f).onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const j = JSON.parse(await file.text()); if (j.app !== 'lunaria') throw new Error('不是月汐的備份檔');
      if (!confirm('會把備份裡的紀錄加回來（相同日期的每日紀錄會被覆蓋），確定嗎？')) return;
      const strip = r => { const { id, user_id, created_by, created_at, ...x } = r; return CLOUD ? { ...x, user_id: S.ownerId } : x; };
      const have = new Set(S.cycles.map(c => String(c.start_date).slice(0, 10)));
      for (const c of j.cycles || []) if (!have.has(String(c.start_date).slice(0, 10))) await DB.insert('cycles', strip(c));
      for (const l of j.day_logs || []) await DB.upsert('day_logs', strip(l));
      for (const h of j.health || []) await DB.insert('health', strip(h));
      closeSheet(); await refresh(); toast('已還原');
    } catch (err) { toast('還原失敗：' + err.message); }
  };
}
function exportCSV() {
  const lb = logsBy(), rows = [['日期', '週期第幾天', '經量', '基礎體溫', '排卵試紙', '分泌物', '症狀', '心情', '睡眠品質', '睡眠時數', '性慾', '備註']];
  const dates = Object.keys(lb).sort();
  for (const d of dates) {
    const l = lb[d], cyc = A.cycles.filter(c => c.s <= toD(d)).pop();
    rows.push([d, cyc ? diff(d, cyc.s) + 1 : '', FLOW[l.flow || 0][1], l.bbt ?? '', (LH.find(x => x[0] === l.lh) || ['', ''])[1], (MUCUS.find(x => x[0] === l.mucus) || ['', ''])[1], (l.symptoms || []).join('、'), (l.moods || []).join('、'), l.sleep_q ?? '', l.sleep_h ?? '', l.libido != null ? LIBIDO[l.libido][1] : '', l.note || '']);
  }
  const csv = '﻿' + rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const u = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const a = document.createElement('a'); a.href = u; a.download = `lunaria-${ymd(today())}.csv`; a.click(); URL.revokeObjectURL(u);
}
function aboutSheet() {
  sheet('關於月汐', `<div class="fs" style="text-align:center"><div class="logo big" style="margin:6px 0">${$('.logo svg').outerHTML}<span>月汐<small>LUNARIA</small></span></div><p class="muted">與自己的節奏，溫柔同行</p><p class="note">版本 ${APP_VERSION}</p></div>
    <div class="fs"><p class="note" style="margin:0">排卵依基礎體溫（3-over-6）、排卵試紙、分泌物判斷，沒有資料時依個人黃體期推算並標示誤差天數。<br><br>預測與排卵判斷僅供參考，不能取代醫療建議，也不建議單獨作為避孕方法。週期持續不規律或身體不適，請諮詢婦產科醫師。</p></div>`, {});
}

/* ---------- 密碼鎖（存在這台裝置） ---------- */
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('lunaria:' + s)); return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join(''); }
function pinPad(title, onDone) {
  const el = document.createElement('div'); el.className = 'lock';
  el.innerHTML = `<div class="logo big">${$('.logo svg').outerHTML}<span>月汐<small>LUNARIA</small></span></div><p class="t">${title}</p><div class="dots">${'<i></i>'.repeat(4)}</div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-n="${n}">${n}</button>`).join('')}<button class="x" data-c="1">${onDone.cancel ? '取消' : ''}</button><button data-n="0">0</button><button class="x" data-b="1">刪除</button></div><p class="msg"></p>`;
  document.body.appendChild(el);
  let v = '';
  const upd = () => el.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i < v.length));
  el.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.b) v = v.slice(0, -1); else if (b.dataset.c) { if (onDone.cancel) { el.remove(); onDone.cancel(); } return; } else if (v.length < 4) v += b.dataset.n;
    upd();
    if (v.length === 4) { const ok = await onDone(v); if (ok) el.remove(); else { el.classList.add('shake'); el.querySelector('.msg').textContent = ok === false ? '密碼不正確' : ''; setTimeout(() => el.classList.remove('shake'), 400); v = ''; upd(); } }
  });
  return el;
}
function lockScreen() { return new Promise(res => pinPad('輸入密碼', async v => { if (await sha(v) === SET.pin) { res(); return true; } return false; })); }
function setPinFlow() {
  if (SET.pin) { pinPad('輸入目前密碼以關閉', Object.assign(async v => { if (await sha(v) !== SET.pin) return false; SET.pin = null; saveSet(); render(); toast('已關閉密碼鎖'); return true; }, { cancel: () => { } })); return; }
  let first = null;
  pinPad('設定 4 位數密碼', Object.assign(async v => {
    if (!first) { first = v; document.querySelector('.lock .t').textContent = '再輸入一次'; return null; }
    if (v !== first) { first = null; document.querySelector('.lock .t').textContent = '兩次不一樣，請重新設定'; return false; }
    SET.pin = await sha(v); saveSet(); render(); toast('已開啟密碼鎖，下次打開月汐要輸入'); return true;
  }, { cancel: () => { } }));
}

/* ---------- 新動作與畫面外框 ---------- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act;
  try {
    if (a === 'set-cycle') setCycleSheet(); else if (a === 'set-remind') setRemindSheet(); else if (a === 'set-goal') setGoalSheet();
    else if (a === 'set-theme') setThemeSheet(); else if (a === 'set-backup') setBackupSheet(); else if (a === 'set-pin') setPinFlow();
    else if (a === 'export-csv') exportCSV(); else if (a === 'about') aboutSheet(); else if (a === 'health-report') healthReport();
  } catch (err) { toast('出錯了：' + (err.message || err)); }
});
const _render0 = render;
render = function () {
  _render0();
  const n = todayReminders().length;
  $('#bellBtn').innerHTML = svgI('bell') + (n ? '<span class="dot"></span>' : '');
  $('#bellBtn').classList.toggle('on', S.tab === 'remind');
};
applyTheme();
const _boot0 = boot;
boot = async function () { if (SET.pin && !boot._unlocked) { await lockScreen(); boot._unlocked = true; } return _boot0(); };


/* ================================================================
 * v1.2：顏色自訂、首頁區塊排列、字體與大小
 * ================================================================ */
const COLOR_KEYS = [['plum', '主色', '按鈕、選取、圖示'], ['period', '經期', '月曆與週期環的經期'], ['fertile', '易孕期', '易孕期底色'], ['ovu', '排卵日', '排卵日標記'], ['luteal', '黃體期', '黃體期與健康'], ['bg', '背景', '整體底色（會取代葉子背景圖）']];
const SWATCH = ['#5F8479', '#6F9488', '#7E6390', '#8C6389', '#4B5D9C', '#5E4F98', '#C9A46A', '#B4977A', '#D2955F', '#DB7B82', '#C65D5B', '#E9A3A6', '#8EA3CF', '#8AA3B2', '#B3A3D8', '#8DB3A2', '#9DB8A6', '#F7F3EA', '#F8F2F2', '#F8F7F3', '#0F1E21', '#1E1A2A', '#152B32'];
const HOME_BLOCKS = [['ring', '週期圓環'], ['rhythm', '節奏（平均週期・下次月經・排卵日）'], ['remind', '今日提醒'], ['meds', '今日用藥'], ['recent', '近期紀錄'], ['intim', '親密紀錄']];
const FONTS = {
  title: [['serif', '宋體', '"Noto Serif TC", "Songti TC", serif'], ['yuji', '手寫 Yuji', '"Yuji Luna", "Noto Serif TC", serif'], ['sans', '黑體', '"Noto Sans TC", -apple-system, "PingFang TC", sans-serif']],
  num: [['dm', '優雅襯線', '"DM Serif Display", "Noto Serif TC", Georgia, serif'], ['serif', '宋體', '"Noto Serif TC", Georgia, serif'], ['sans', '現代黑體', '"Noto Sans TC", -apple-system, system-ui, sans-serif']],
  body: [['sans', '黑體', '"Noto Sans TC", -apple-system, "PingFang TC", system-ui, sans-serif'], ['serif', '宋體', '"Noto Serif TC", "Songti TC", serif']],
};
const SIZES = [[0.92, '小'], [1, '標準'], [1.1, '大'], [1.2, '特大']];
SET.colors = SET.colors || { day: {}, night: {} };
SET.font = { title: 'serif', num: 'dm', body: 'sans', ...(SET.font || {}) };
SET.size = SET.size || 1;
SET.home = (() => { const h = Array.isArray(SET.home) ? SET.home.filter(x => HOME_BLOCKS.some(b => b[0] === x.k)) : []; for (const [k] of HOME_BLOCKS) if (!h.some(x => x.k === k)) h.push({ k, on: k !== 'intim' }); return h; })();
const curMode = () => document.documentElement.dataset.mode || 'day';

function applyCustom() {
  const de = document.documentElement, st = de.style;
  for (const v of ['--plum', '--plum-2', '--plum-soft', '--period', '--period-mid', '--period-soft', '--fertile', '--fertile-soft', '--ovu', '--luteal', '--luteal-soft', '--bg', '--bg-2', '--bgimg', '--serif', '--num', '--sans', '--zoom', '--card', '--blur', '--nav-bg', '--top-bg']) st.removeProperty(v);
  const c = SET.colors[curMode()] || {}, night = curMode() === 'night';
  const soft = (x, p) => `color-mix(in srgb, ${x} ${p}%, ${night ? 'transparent' : '#fff'})`;
  if (c.plum) { st.setProperty('--plum', c.plum); st.setProperty('--plum-2', `color-mix(in srgb, ${c.plum} 78%, #fff)`); st.setProperty('--plum-soft', soft(c.plum, 18)); }
  if (c.period) { st.setProperty('--period', c.period); st.setProperty('--period-mid', `color-mix(in srgb, ${c.period} 72%, #fff)`); st.setProperty('--period-soft', soft(c.period, 20)); }
  if (c.fertile) { st.setProperty('--fertile', c.fertile); st.setProperty('--fertile-soft', soft(c.fertile, 22)); }
  if (c.ovu) st.setProperty('--ovu', c.ovu);
  if (c.luteal) { st.setProperty('--luteal', c.luteal); st.setProperty('--luteal-soft', soft(c.luteal, 22)); }
  if (c.bg) { st.setProperty('--bg', c.bg); st.setProperty('--bg-2', `color-mix(in srgb, ${c.bg} 92%, ${night ? '#fff' : '#000'})`); st.setProperty('--bgimg', 'none'); }
  const f = k => (FONTS[k].find(x => x[0] === SET.font[k]) || FONTS[k][0])[2];
  st.setProperty('--serif', f('title')); st.setProperty('--num', f('num')); st.setProperty('--sans', f('body'));
  st.setProperty('--zoom', SET.size);
  // 透明度：用配色原本的卡片色，再乘上使用者設定的不透明度
  const op = SET.opacity ?? 100, bl = SET.blur ?? 10;
  if (op !== 100) {
    const base = getComputedStyle(de).getPropertyValue('--card').trim();
    st.setProperty('--card', `color-mix(in srgb, ${base} ${op}%, transparent)`);
    st.setProperty('--nav-bg', `color-mix(in srgb, var(--bg) ${Math.max(40, op)}%, transparent)`);
    st.setProperty('--top-bg', `color-mix(in srgb, var(--bg) ${Math.max(30, op * .8)}%, transparent)`);
  }
  st.setProperty('--blur', bl + 'px');
  de.classList.toggle('glass', op < 70);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', c.bg || getComputedStyle(de).getPropertyValue('--bg').trim());
}
const _applyTheme0 = applyTheme;
applyTheme = function () { _applyTheme0(); applyCustom(); };

/* ---------- 今天頁：依設定的順序與開關組合區塊 ---------- */
const _today0 = VIEWS.today;
VIEWS.today = () => {
  if (!A.current) return _today0();
  const h = _today0(), hero = h.slice(0, h.indexOf('</section>') + 10);
  const meds = medsToday(), rms = todayReminders();
  const B = {
    ring: () => hero,
    rhythm: () => `<div class="sec"><h2>節奏</h2><span class="r">${A.irregular ? '週期變化較大，預測僅供參考' : ''}</span></div>${rhythmTiles()}${precisionTip()}`,
    remind: () => rms.length ? `<div class="sec"><h2>今日提醒</h2><button class="btn small ghost" data-act="tab" data-tab="remind">全部</button></div>${rms.slice(0, 2).map(r => `<div class="rm"><span class="ic" style="--c:${r.c};--c-soft:${r.cs}">${svgI(r.ic)}</span><div><div class="t">${esc(r.t)}</div><div class="m">${esc(r.m)}</div></div></div>`).join('')}` : '',
    meds: () => `<div class="sec"><h2>今日用藥</h2><span class="r">${meds.filter(x => x.done).length}/${meds.length}</span></div><section class="card">${medRows(meds)}</section>`,
    recent: () => isOwner() ? `<div class="sec"><h2>近期紀錄</h2><button class="btn small ghost" data-act="tab" data-tab="records">全部</button></div><section class="card">${recentLogs(4)}</section>` : '',
    intim: () => intimacyBlock(3),
  };
  let out = SET.home.filter(x => x.on).map(x => B[x.k] ? B[x.k]() : '').join('');
  if (!isOwner() && !SET.home.find(x => x.k === 'intim').on) out += intimacyBlock(3); // 伴侶一定看得到親密紀錄入口
  return out + `<button class="btn ghost block" data-act="set-home" style="margin-top:18px">${svgI('list')} 調整首頁區塊</button>`;
};

/* ---------- 設定畫面 ---------- */
function setHomeSheet() {
  const draw = () => `<div class="fs"><p class="note" style="margin-top:0">用箭頭調整順序，右邊開關決定要不要顯示。</p><div class="hb-list">${SET.home.map((x, i) => {
    const lb = HOME_BLOCKS.find(b => b[0] === x.k)[1];
    return `<div class="hb${x.on ? '' : ' off'}"><div class="hb-mv"><button type="button" data-mv="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="上移">${svgI('chevL', 'up')}</button><button type="button" data-mv="${i}" data-d="1" ${i === SET.home.length - 1 ? 'disabled' : ''} aria-label="下移">${svgI('chevR', 'dn')}</button></div><span class="g">${lb}</span><button type="button" class="tgl${x.on ? ' on' : ''}" data-tg="${i}" aria-label="顯示 ${lb}"></button></div>`;
  }).join('')}</div></div><button type="button" class="btn ghost block" data-reset-home style="margin-top:10px">恢復預設</button>`;
  const f = sheet('首頁區塊', `<div id="hbBox">${draw()}</div>`, {});
  const box = $('#hbBox', f);
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mv != null) { const i = +b.dataset.mv, j = i + +b.dataset.d; if (j < 0 || j >= SET.home.length) return; [SET.home[i], SET.home[j]] = [SET.home[j], SET.home[i]]; }
    else if (b.dataset.tg != null) SET.home[+b.dataset.tg].on = !SET.home[+b.dataset.tg].on;
    else if (b.hasAttribute('data-reset-home')) SET.home = HOME_BLOCKS.map(([k]) => ({ k, on: k !== 'intim' }));
    else return;
    saveSet(); box.innerHTML = draw(); if (S.tab === 'today') render();
  });
}
function setThemeSheet2() {
  const mode = curMode();
  const pal = () => `<div class="pal-pick">${Object.entries(PALS).map(([k, [n, c]]) => `<button type="button" data-pal="${k}" class="${SET.pal === k ? 'on' : ''}"><span class="sw">${c.map(x => `<i style="background:${x}"></i>`).join('')}</span>${n}</button>`).join('')}</div>`;
  const cur = k => { const c = SET.colors[curMode()] || {}; return c[k] || (k === 'bg' ? getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() : getComputedStyle(document.documentElement).getPropertyValue('--' + k).trim()); };
  const toHex = v => { const m = /^#([0-9a-f]{6})$/i.exec(v); if (m) return v; const d = document.createElement('div'); d.style.color = v; document.body.appendChild(d); const rgb = getComputedStyle(d).color.match(/\d+/g) || [0, 0, 0]; d.remove(); return '#' + rgb.slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join(''); };
  const colorRows = () => COLOR_KEYS.map(([k, l, d]) => { const own = !!(SET.colors[curMode()] || {})[k]; return `<div class="cr"><label class="cr-sw" style="background:${cur(k)}"><input type="color" data-ck="${k}" value="${toHex(cur(k))}" aria-label="${l}"></label><div class="g"><b>${l}</b><span>${d}</span></div>${own ? `<button type="button" class="btn small ghost" data-cr="${k}">還原</button>` : '<span class="faint small">配色預設</span>'}</div>
    <div class="sw-row" data-for="${k}">${SWATCH.map(s => `<button type="button" data-sw="${s}" style="background:${s}" aria-label="${s}"></button>`).join('')}</div>`; }).join('');
  const fontSeg = k => `<div class="seg">${FONTS[k].map(([v, l]) => `<button type="button" data-font="${k}" data-v="${v}" class="${SET.font[k] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const body = () => `
    <div class="fs"><div class="lab">配色</div>${pal()}</div>
    <div class="fs"><div class="lab">白天／夜間</div><div class="seg">${[['auto', '自動切換'], ['day', '白天'], ['night', '夜間']].map(([k, l]) => `<button type="button" data-mode="${k}" class="${SET.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="fs"><div class="lab">自訂顏色 <span class="shr">${curMode() === 'night' ? '夜間' : '白天'}模式</span></div><p class="note" style="margin-top:0">白天和夜間分開設定。點色塊用調色盤，或點下面的建議色。</p>${colorRows()}
      <button type="button" class="btn ghost block" data-reset-colors style="margin-top:12px">全部還原成配色預設</button></div>
    <div class="fs"><div class="lab">字體</div>
      <div class="muted small" style="margin:2px 0 6px">標題</div>${fontSeg('title')}
      <div class="muted small" style="margin:12px 0 6px">數字</div>${fontSeg('num')}
      <div class="muted small" style="margin:12px 0 6px">內文</div>${fontSeg('body')}
      <div class="font-demo"><span style="font-family:var(--serif)">月汐・週期第</span> <b style="font-family:var(--num)">18</b><span style="font-family:var(--serif)"> 天</span><p style="font-family:var(--sans)">預計 10/23 開始・排卵日 10/9</p></div></div>
    <div class="fs"><div class="lab">透明度</div><p class="note" style="margin-top:0">卡片越透明，背景的葉子與月亮越清楚；毛玻璃讓透出的背景變柔和，文字比較好讀。</p>
      <div class="glass-presets">${[['不透明', 100, 10], ['霧面', 70, 14], ['透明', 45, 18], ['清透', 25, 8]].map(([l, o, b]) => `<button type="button" data-glass="${o},${b}">${l}</button>`).join('')}</div>
      <div class="rng-row"><span>卡片不透明度</span><b id="opV">${SET.opacity ?? 100}%</b></div><input class="rng" type="range" min="15" max="100" step="5" data-rng="opacity" value="${SET.opacity ?? 100}" aria-label="卡片不透明度">
      <div class="rng-row"><span>毛玻璃模糊</span><b id="blV">${SET.blur ?? 10}px</b></div><input class="rng" type="range" min="0" max="30" step="2" data-rng="blur" value="${SET.blur ?? 10}" aria-label="毛玻璃模糊"></div>
    <div class="fs"><div class="lab">字級</div><div class="seg">${SIZES.map(([v, l]) => `<button type="button" data-size="${v}" class="${SET.size === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
  const f = sheet('主題模式', `<div id="thBox">${body()}</div>`, {});
  const box = $('#thBox', f);
  const redraw = () => { const y = f.closest('.sheet').scrollTop; box.innerHTML = body(); f.closest('.sheet').scrollTop = y; render(); };
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pal) SET.pal = b.dataset.pal;
    else if (b.dataset.mode) SET.mode = b.dataset.mode;
    else if (b.dataset.font) SET.font[b.dataset.font] = b.dataset.v;
    else if (b.dataset.size) SET.size = +b.dataset.size;
    else if (b.dataset.sw) { const k = b.closest('.sw-row').dataset.for; (SET.colors[curMode()] ||= {})[k] = b.dataset.sw; }
    else if (b.dataset.cr) delete SET.colors[curMode()][b.dataset.cr];
    else if (b.hasAttribute('data-reset-colors')) SET.colors[curMode()] = {};
    else if (b.dataset.glass) { const [o, bl] = b.dataset.glass.split(',').map(Number); SET.opacity = o; SET.blur = bl; }
    else return;
    saveSet(); applyTheme(); redraw();
  });
  box.addEventListener('input', e => { const r = e.target.dataset.rng; if (r) { SET[r] = +e.target.value; $(r === 'opacity' ? '#opV' : '#blV', box).textContent = e.target.value + (r === 'opacity' ? '%' : 'px'); applyTheme(); saveSet(); } });
  box.addEventListener('input', e => { const k = e.target.dataset.ck; if (!k) return; (SET.colors[curMode()] ||= {})[k] = e.target.value; e.target.parentElement.style.background = e.target.value; applyTheme(); });
  box.addEventListener('change', e => { if (e.target.dataset.ck) { saveSet(); redraw(); } });
}
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.dataset.act === 'set-home') setHomeSheet();
  if (el.dataset.act === 'set-theme') { e.stopImmediatePropagation(); setTimeout(() => { closeSheet(); setThemeSheet2(); }, 0); }
}, true);
applyCustom();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
boot();
