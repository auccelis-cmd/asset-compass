/* 月汐 Lunaria · 週期與排卵計算（純函式，瀏覽器與 Node 都能跑）
 *
 * 排卵判斷的優先順序（越前面越準）：
 *   1. 基礎體溫升高（3-over-6 規則）：連續 3 天體溫高於前 6 天最高值，且第 3 天至少高 0.2°C
 *      → 排卵日 ≈ 第一個高溫日的前一天（「已確認」，但要升溫後才知道）
 *   2. 排卵試紙 LH 峰值：第一個強陽／陽性日的隔天
 *   3. 分泌物高峰日：最後一個蛋清狀／水狀分泌物的日子
 *   4. 推算：下次月經 −（個人黃體期，預設 14 天）
 */
(function (root) {
  const DAY = 86400000;
  const toD = s => { if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate()); const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const add = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const diff = (a, b) => Math.round((toD(a) - toD(b)) / DAY);
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };

  /** 用體溫找排卵（3-over-6） */
  function bbtShift(temps) {
    // temps: [{date: Date, t: number}] 依日期排序，同一週期內
    for (let i = 6; i + 2 < temps.length; i++) {
      const prev = temps.slice(i - 6, i).map(x => x.t);
      const cover = Math.max(...prev);
      const [a, b, c] = [temps[i], temps[i + 1], temps[i + 2]];
      // 中間不能斷超過 1 天，避免缺資料造成誤判
      if (diff(c.date, a.date) > 3) continue;
      if (a.t > cover && b.t > cover && c.t >= cover + 0.2) {
        return { ovulation: add(a.date, -1), coverline: cover, firstHigh: a.date };
      }
    }
    return null;
  }

  /** 分析某一個週期內的紀錄，找出排卵日 */
  function detectOvulation(start, endExclusive, logs) {
    const inCycle = logs.filter(l => { const d = toD(l.date); return d >= start && d < endExclusive; })
      .sort((a, b) => toD(a.date) - toD(b.date));
    const temps = inCycle.filter(l => l.bbt != null && l.bbt !== '' && !isNaN(+l.bbt) && +l.bbt > 34 && +l.bbt < 39)
      .map(l => ({ date: toD(l.date), t: +l.bbt }));
    const shift = bbtShift(temps);
    const lhDay = inCycle.find(l => l.lh === 'peak') || inCycle.find(l => l.lh === 'pos');
    const mucusPeak = [...inCycle].reverse().find(l => l.mucus === 'eggwhite' || l.mucus === 'watery');
    const res = { bbt: shift, lh: lhDay ? add(toD(lhDay.date), 1) : null, mucus: mucusPeak ? toD(mucusPeak.date) : null };
    if (shift) {
      res.date = shift.ovulation; res.method = 'bbt';
      // 體溫與試紙差 2 天內，取兩者中間（試紙通常較早）
      if (res.lh && Math.abs(diff(res.lh, shift.ovulation)) <= 2) res.date = add(res.lh, Math.round(diff(shift.ovulation, res.lh) / 2));
    } else if (res.lh) { res.date = res.lh; res.method = 'lh'; }
    else if (res.mucus) { res.date = res.mucus; res.method = 'mucus'; }
    return res;
  }

  /**
   * 主計算
   * cycles: [{start_date, end_date}]，logs: [{date, flow, bbt, lh, mucus}]
   */
  function analyze(cycles, logs = [], today = new Date(), opts = {}) {
    today = toD(today);
    const cs = cycles.filter(c => c.start_date).map(c => ({ ...c, s: toD(c.start_date), e: c.end_date ? toD(c.end_date) : null }))
      .sort((a, b) => a.s - b.s);
    // 週期長度（排除 18 天以下、50 天以上的異常值）
    const lens = [];
    for (let i = 1; i < cs.length; i++) { const L = diff(cs[i].s, cs[i - 1].s); if (L >= 18 && L <= 50) lens.push(L); }
    const recentLens = lens.slice(-6);
    const avgCycle = recentLens.length ? mean(recentLens) : (+opts.cycleLen || 28);
    const cycleSd = sd(recentLens);
    const pLens = cs.filter(c => c.e).map(c => diff(c.e, c.s) + 1).filter(x => x >= 1 && x <= 12).slice(-6);
    const avgPeriod = pLens.length ? mean(pLens) : (+opts.periodLen || 5);

    // 每個週期的排卵
    const per = cs.map((c, i) => {
      const next = cs[i + 1] ? cs[i + 1].s : add(today, 1);
      const ov = detectOvulation(c.s, next, logs);
      // 伴侶端看不到每日紀錄：改用記錄者 App 寫回的排卵日
      if (!ov.date && c.ovulation_date && c.ovulation_method && c.ovulation_method !== 'predicted') { ov.date = toD(c.ovulation_date); ov.method = c.ovulation_method; }
      return { ...c, next: cs[i + 1] ? cs[i + 1].s : null, length: cs[i + 1] ? diff(cs[i + 1].s, c.s) : null, ov };
    });
    // 個人黃體期：用已確認（體溫／試紙）的完整週期算
    const luts = per.filter(p => p.next && p.ov.date && (p.ov.method === 'bbt' || p.ov.method === 'lh'))
      .map(p => diff(p.next, p.ov.date)).filter(x => x >= 9 && x <= 18);
    const luteal = +opts.luteal ? +opts.luteal : luts.length ? Math.round(mean(luts.slice(-6))) : 14;

    const last = per[per.length - 1] || null;
    const nextStart = last ? add(last.s, Math.round(avgCycle)) : null;
    let cur = null;
    if (last) {
      const cycleDay = diff(today, last.s) + 1;
      const detected = last.ov.date && (last.ov.method === 'bbt' || last.ov.method === 'lh' || last.ov.method === 'mucus') ? last.ov : null;
      const predictedOv = add(nextStart, -luteal);
      const ovDate = detected ? detected.date : predictedOv;
      // 精準度：已確認 → 0；試紙 → ±1；分泌物 → ±2；推算 → 依週期變異
      const range = detected ? (detected.method === 'bbt' ? 0 : detected.method === 'lh' ? 1 : 2)
        : Math.max(1, Math.min(5, Math.round(cycleSd + (luts.length ? 0.5 : 1.5))));
      // 已確認排卵 → 下次月經改用「排卵日＋黃體期」，比平均週期準
      const nextByOv = detected && detected.method !== 'mucus' ? add(detected.date, luteal) : null;
      cur = {
        start: last.s, cycleDay, late: nextStart && today > (nextByOv || nextStart) ? diff(today, nextByOv || nextStart) : 0,
        ovulation: ovDate, ovMethod: detected ? detected.method : 'predicted', ovRange: range,
        bbt: last.ov.bbt, lh: last.ov.lh, mucus: last.ov.mucus,
        fertileStart: add(ovDate, -5 - (detected ? 0 : range)), fertileEnd: add(ovDate, 1 + (detected ? 0 : Math.min(range, 1))),
        nextStart: nextByOv || nextStart, inPeriod: last.e ? today <= last.e : cycleDay <= Math.round(avgPeriod),
      };
    }
    // 往後預測 3 個週期
    const future = [];
    if (cur) {
      let s = cur.nextStart;
      for (let k = 0; k < 3; k++) {
        const ov = add(s, Math.round(avgCycle) - luteal);
        future.push({ start: s, end: add(s, Math.round(avgPeriod) - 1), ovulation: ov, fertileStart: add(ov, -5), fertileEnd: add(ov, 1) });
        s = add(s, Math.round(avgCycle));
      }
    }
    return {
      avgCycle: Math.round(avgCycle * 10) / 10, avgPeriod: Math.round(avgPeriod * 10) / 10, cycleSd: Math.round(cycleSd * 10) / 10,
      minCycle: recentLens.length ? Math.min(...recentLens) : null, maxCycle: recentLens.length ? Math.max(...recentLens) : null,
      samples: recentLens.length, luteal, lutealSamples: luts.length, cycles: per, current: cur, future,
      irregular: recentLens.length >= 3 && (Math.max(...recentLens) - Math.min(...recentLens) > 9),
    };
  }

  /** 某一天的狀態（月曆上色用） */
  function dayStatus(a, date, logsByDate = {}) {
    const d = toD(date), key = ymd(d);
    const st = { period: false, predictedPeriod: false, fertile: false, ovulation: false, ovPredicted: false, logged: !!logsByDate[key] };
    for (const c of a.cycles) {
      const end = c.e || add(c.s, Math.round(a.avgPeriod) - 1);
      if (d >= c.s && d <= end) st.period = true;
      if (c.ov.date && (c.ov.method === 'bbt' || c.ov.method === 'lh') && c !== a.cycles[a.cycles.length - 1] && diff(d, c.ov.date) === 0) st.ovulation = true;
    }
    const l = logsByDate[key];
    if (l && l.flow > 0) st.period = true;
    const cur = a.current;
    if (cur) {
      if (d >= cur.fertileStart && d <= cur.fertileEnd) st.fertile = true;
      if (diff(d, cur.ovulation) === 0) { st.ovulation = true; st.ovPredicted = cur.ovMethod === 'predicted'; }
    }
    for (const f of a.future) {
      if (d >= f.start && d <= f.end && !st.period) st.predictedPeriod = true;
      if (d >= f.fertileStart && d <= f.fertileEnd) st.fertile = true;
      if (diff(d, f.ovulation) === 0) { st.ovulation = true; st.ovPredicted = true; }
    }
    if (st.period || st.predictedPeriod) st.fertile = false;
    return st;
  }

  const api = { analyze, dayStatus, detectOvulation, bbtShift, toD, ymd, add, diff };
  root.Cycle = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
