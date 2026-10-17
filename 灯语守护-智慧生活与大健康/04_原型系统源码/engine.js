/*
 * 灯语守护 · 无感预警引擎
 * ------------------------------------------------------------
 * 输入：一户人家的 15 分钟电表曲线 P（kW）与水表曲线 W（升/时段）。
 * 不需要摄像头、手环或任何额外传感器。
 *
 * 1. 个人基线学习（每晚用最近 28 个正常日重新学习）
 *    - 底噪：凌晨时段的冰箱 + 待机功率；活动阈值 δ 由凌晨功率波动自适应确定
 *    - 活动：功率出现台阶变化（开/关电器）或有用水，即判定“有人在动”
 *    - 静默画像：从一天中第 h 小时开始安静，这位老人通常会安静多久（按小时分别统计分位数）
 *    - 大功率、持续用水的个人最长时长；夜间起夜次数；起床时间、日活动量
 * 2. 在线检测（每 15 分钟一步）
 *    D1 静默超长：安静时长超过该时刻的个人阈值 → 关注；再过 90 分钟仍无活动 → 紧急
 *       · 起床前就开始的静默 → “晨起未见活动”
 *       · 静默期间有电器一直开着且功率纹丝不动（灯、电视没人关）→ 阈值打 8 折、直接紧急
 *       · 静默前所有电器被关掉、只剩冰箱 → 更像出门，先“疑似外出未归”，自动外呼确认
 *       · 已报备外出的时段不报静默
 *    D2 大功率长时间运行：超过个人最长时长，或功率恒定不变超过 75 分钟 → 紧急（干烧/火灾隐患）
 *    D3 持续用水：连续出水超过个人最长时长（至少 60 分钟）→ 紧急；若同时无任何电器操作，提示“疑似浴室跌倒”
 *    D4 夜间频繁起夜：起夜次数显著高于个人平常（≥均值+3 且 z≥3），连续两晚 → 关注
 *    D5 作息持续偏离：近 7 天起床时间、日活动量相对基线持续偏离 5 天 → 关注
 * 3. 每条预警都附带可解释的依据（“她过去 28 天 95% 的日子在 7:10 前起床”）
 *
 * 浏览器与 Node.js 通用，不依赖任何第三方库。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LampEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SPD = 96, SLOT = 15;
  var DEFAULTS = {
    trainDays: 28,
    minDelta: 0.05,        // 活动台阶最小阈值 kW
    waterAct: 1.0,         // 一个时段用水超过 1 升算活动
    silQ: 0.98,            // 静默分位数
    silScale: 1.2,         // 分位数放大系数
    silPad: 2,             // 再加 2 个时段（30 分钟）余量
    silMin: 8,             // 最短静默阈值 2 小时
    silMax: 64,            // 最长 16 小时
    escalate: 6,           // 关注 → 紧急 再等 90 分钟
    wakePad: 4,            // 晨起未见活动：平时 95% 起床时刻再等 60 分钟
    plateauFactor: 0.8,    // 有电器一直开着时阈值打折
    oddFactor: 0.5,        // 开着的负载明显高于该时段平时的静默水平（如半夜灯一直亮）→ 阈值减半
    oddMin: 6,             // 但至少 90 分钟
    hpKw: 0.9,             // 大功率：超出底噪 0.9 kW
    hpMinSlots: 5,         // 大功率个人阈值下限 75 分钟
    hpFlatSlots: 5,        // 恒定大功率 75 分钟即报
    hpFlatTol: 0.12,       // “恒定”的容差 kW
    wRunLevel: 18,         // 持续用水：每时段 ≥18 升（约 1.2 升/分钟）
    wMinSlots: 4,          // 至少 60 分钟
    nightFrom: 0, nightTo: 20,   // 夜间统计窗 00:00–05:00
    nightAbs: 3, nightZ: 3, nightRepeat: 2,
    driftZ: 1.6, driftDays: 4,
    // 消融开关
    useHourly: true, useContext: true, useFlat: true, usePersonal: true
  };

  function quantile(arr, q) {
    if (!arr.length) return NaN;
    var a = Array.prototype.slice.call(arr).sort(function (x, y) { return x - y; });
    var pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  }
  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : NaN; }
  function sd(a) { var m = mean(a), s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return a.length > 1 ? Math.sqrt(s / (a.length - 1)) : 0; }
  function fmtSlot(slot) { slot = ((slot % SPD) + SPD) % SPD; var m = slot * SLOT; var h = Math.floor(m / 60), mi = m % 60; return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi; }
  function fmtDur(slots) { var m = slots * SLOT; var h = Math.floor(m / 60), mi = m % 60; return (h ? h + ' 小时' : '') + (mi ? (h ? ' ' : '') + mi + ' 分钟' : (h ? '' : '0 分钟')); }

  // ---------- 学习个人基线 ----------
  function learn(P, W, days, opt) {
    opt = Object.assign({}, DEFAULTS, opt || {});
    var nightVals = [], nightDiffs = [];
    days.forEach(function (d) {
      for (var s = 4; s <= 18; s++) { var k = d * SPD + s; nightVals.push(P[k]); if (k > 0) nightDiffs.push(Math.abs(P[k] - P[k - 1])); }
    });
    var bg = quantile(nightVals, 0.2);
    var delta = Math.max(opt.minDelta, 2.5 * quantile(nightDiffs, 0.8) + 0.02);
    var model = { bg: bg, delta: delta, opt: opt, days: days.slice() };
    if (!opt.usePersonal) model.delta = 0.08;

    var isTrain = {}; days.forEach(function (d) { isTrain[d] = 1; });
    function act(k) { return k > 0 && (Math.abs(P[k] - P[k - 1]) > model.delta || W[k] > opt.waterAct); }

    // 静默段：按开始时刻（小时）统计长度
    var byHour = [], levelByHour = []; for (var h = 0; h < 24; h++) { byHour.push([]); levelByHour.push([]); }
    var allSil = [];
    var hpRuns = [], wRuns = [];
    var nights = [], wakes = [], acts = [], hpCnt = [];
    days.forEach(function (d) {
      var k0 = d * SPD;
      var cnt = 0, wake = -1, hpc = 0;
      for (var s = 0; s < SPD; s++) {
        var k = k0 + s;
        var a = act(k);
        if (a && s >= 20 && s < 92) cnt++;
        if (wake < 0 && s >= 16 && a) {
          var c2 = 0; for (var j = 1; j <= 8; j++) if (act(k + j)) c2++;
          if (c2 >= 1) wake = s;   // 起床：此后 2 小时内还有别的动静（区别于起夜）
        }
      }
      var nc = 0; for (var s2 = opt.nightFrom; s2 < opt.nightTo; s2++) if (act(k0 + s2)) nc++;
      nights.push(nc); acts.push(cnt); if (wake >= 0) wakes.push(wake);
      // 大功率段
      var run = 0;
      for (var s3 = 0; s3 < SPD; s3++) {
        var kk = k0 + s3;
        if (P[kk] - bg > opt.hpKw) run++; else { if (run) { hpRuns.push(run); hpc++; } run = 0; }
      }
      if (run) hpRuns.push(run);
      hpCnt.push(hpc);
      var wr = 0;
      for (var s4 = 0; s4 < SPD; s4++) { if (W[k0 + s4] >= opt.wRunLevel) wr++; else { if (wr) wRuns.push(wr); wr = 0; } }
      if (wr) wRuns.push(wr);
    });
    // 静默段（跨天连续，只在训练日内部统计）
    var last = -1;
    var first = Math.min.apply(null, days) * SPD, end = (Math.max.apply(null, days) + 1) * SPD;
    for (var k = first; k < end; k++) {
      var d = Math.floor(k / SPD);
      if (!isTrain[d]) { last = -1; continue; }
      if (act(k)) {
        if (last >= 0) {
          var len = k - last - 1;
          if (len > 0) {
            var hh0 = Math.floor((last % SPD) / 4);
            byHour[hh0].push(len); allSil.push(len);
            var lv = 0; for (var q2 = last + 1; q2 < k; q2++) lv += P[q2] - bg;
            levelByHour[hh0].push(lv / len);
          }
        }
        last = k;
      }
    }
    // 入睡时刻与睡眠期间的负载水平：每天 19:00–次日 03:00 之间开始的最长静默视为睡眠
    var beds = [], sleepLv = [];
    days.forEach(function (d) {
      if (!isTrain[d + 1]) return;
      var best = 0, bestK = -1, lastA = -1;
      for (var k2 = d * SPD + 76; k2 < (d + 1) * SPD + 40; k2++) {
        if (act(k2)) {
          if (lastA >= 0 && k2 - lastA - 1 > best && lastA < (d + 1) * SPD + 12) { best = k2 - lastA - 1; bestK = lastA; }
          lastA = k2;
        }
      }
      if (bestK >= 0 && best >= 12) {
        beds.push(bestK - d * SPD);
        var lv2 = 0; for (var q3 = bestK + 1; q3 <= bestK + best; q3++) lv2 += P[q3] - bg;
        sleepLv.push(lv2 / best);
      }
    });
    var thr = [], levelQ = [], levelM = [];
    var globalQ = quantile(allSil, opt.silQ);
    for (var hh = 0; hh < 24; hh++) {
      var pool = [];
      var w = 1;
      while (pool.length < 12 && w <= 4) {
        pool = [];
        for (var o = -w; o <= w; o++) pool = pool.concat(byHour[(hh + o + 24) % 24]);
        w++;
      }
      var q = opt.useHourly && pool.length >= 5 ? quantile(pool, opt.silQ) : globalQ;
      var lp = []; for (var o2 = -1; o2 <= 1; o2++) lp = lp.concat(levelByHour[(hh + o2 + 24) % 24]);
      levelQ.push(lp.length >= 3 ? quantile(lp, 0.9) : 0.05);
      levelM.push(lp.length >= 3 ? Math.max(0.012, 0.5 * (quantile(lp, 0.9) - quantile(lp, 0.1))) : 0.03);
      var t = Math.ceil(q * opt.silScale + opt.silPad);
      thr.push(Math.max(opt.silMin, Math.min(opt.silMax, t)));
    }
    if (!opt.usePersonal) { thr = []; for (var h2 = 0; h2 < 24; h2++) thr.push(h2 >= 20 || h2 < 4 ? 40 : 16); } // 统一阈值：夜间 10 小时、白天 4 小时
    model.silThr = thr;
    model.levelQ = levelQ; model.levelM = levelM;
    model.bed = { list: beds, q10: quantile(beds, 0.1), q50: quantile(beds, 0.5) };
    model.sleepLevel = { q90: sleepLv.length ? quantile(sleepLv, 0.9) : 0.03, m: sleepLv.length ? Math.max(0.012, 0.6 * (quantile(sleepLv, 0.9) - quantile(sleepLv, 0.1))) : 0.03 };
    model.silByHour = byHour.map(function (a) { return a.length; });
    model.hpThr = opt.usePersonal ? Math.max(opt.hpMinSlots, Math.ceil((quantile(hpRuns, 0.99) || 0) + 2)) : 4;
    model.wThr = opt.usePersonal ? Math.max(opt.wMinSlots, Math.ceil((quantile(wRuns, 0.99) || 0) + 2)) : 4;
    model.night = { mean: mean(nights), sd: sd(nights) };
    model.wake = { list: wakes, q50: quantile(wakes, 0.5), q95: quantile(wakes, 0.95), mean: mean(wakes), sd: sd(wakes) };
    model.act = { mean: mean(acts), sd: sd(acts) };
    model.hpCnt = { mean: mean(hpCnt), sd: sd(hpCnt) };
    return model;
  }

  // ---------- 在线监测 ----------
  // hh: { P, W, away:[{s,e,reported}] (分钟), name }
  function Monitor(hh, opt) {
    this.P = hh.P; this.W = hh.W; this.hh = hh;
    this.opt = Object.assign({}, DEFAULTS, opt || {});
    this.reported = (hh.away || []).filter(function (a) { return a.reported; }).map(function (a) { return [Math.floor(a.s / SLOT), Math.ceil(a.e / SLOT)]; });
    this.exclude = {};     // 不进入基线的日子（已确认的异常日）
    this.model = null;
    this.lastAct = -1;
    this.awayUntil = -1;
    this.confirmedAt = -1;
    this.silState = 0;     // 0 无, 1 已报关注（外呼未确认）, 2 已报紧急, 3 外呼已确认平安
    this.hpRun = 0; this.hpMin = 0; this.hpMax = 0; this.hpAlerted = false;
    this.wRun = 0; this.wAlerted = false;
    this.nightStreak = 0;
    this.daily = [];       // 每日特征
    this.driftStreak = 0; this.driftCool = -1;
    this.alerts = [];
    this.k = -1;
  }
  Monitor.prototype.isAct = function (k) {
    var m = this.model; if (!m || k <= 0) return false;
    return Math.abs(this.P[k] - this.P[k - 1]) > m.delta || this.W[k] > this.opt.waterAct;
  };
  Monitor.prototype.isReportedAway = function (k) {
    for (var i = 0; i < this.reported.length; i++) if (k >= this.reported[i][0] && k < this.reported[i][1]) return true;
    return false;
  };
  Monitor.prototype.relearn = function (day) {
    var days = [];
    for (var d = day - 1; d >= 0 && days.length < this.opt.trainDays; d--) {
      if (this.exclude[d]) continue;
      // 报备外出整天不在家的日子也不进入基线
      var k0 = d * SPD, aw = 0;
      for (var s = 24; s < 88; s += 8) if (this.isReportedAway(k0 + s)) aw++;
      if (aw >= 4) continue;
      days.push(d);
    }
    if (days.length >= 7) this.model = learn(this.P, this.W, days.reverse(), this.opt);
  };
  Monitor.prototype.emit = function (k, level, type, title, why, extra) {
    var a = Object.assign({ k: k, t: k * SLOT, level: level, type: type, title: title, why: why, name: this.hh.name }, extra || {});
    this.alerts.push(a);
    return a;
  };
  // 推进到时段 k，返回本步新产生的预警
  Monitor.prototype.step = function (k) {
    var out = [];
    var self = this, opt = this.opt, P = this.P, W = this.W;
    var s = k % SPD, day = Math.floor(k / SPD);
    if (s === 0 && day > 0) {
      this.endOfDay(day - 1, out);
      this.relearn(day);
    }
    this.k = k;
    var m = this.model;
    if (!m) { if (this.isAct(k)) this.lastAct = k; return out; }

    var act = this.isAct(k);
    if (act) {
      this.lastAct = k;
      if (this.silState) this.silState = 0;
    }
    // ---- D1 静默超长 ----
    if (this.isReportedAway(k)) this.awayUntil = k;
    if (this.lastAct >= 0 && !act) {
      // 报备外出结束后，从报备结束时刻重新计算静默（人可能还在回家路上）
      var gap = k - Math.max(this.lastAct, this.awayUntil);
      var h = Math.floor((this.lastAct % SPD) / 4);
      var thr = m.silThr[h];
      // 静默期间的状态：有没有负载一直开着、功率纹丝不动
      var sum = 0, mn = 1e9, mx = -1e9, n = 0;
      for (var j = this.lastAct + 1; j <= k; j++) { var v = P[j] - m.bg; sum += v; mn = Math.min(mn, v); mx = Math.max(mx, v); n++; }
      var avg = n ? sum / n : 0;
      var stuck = n >= 2 && (mx - mn) < m.delta && avg > 0.015;
      // 开着的负载明显高于“这个时段平时安静时”的水平：如半夜卫生间灯一直亮、上午电视开着没人管
      // 只在睡眠时段启用“加速”：平时入睡后家里只剩冰箱，此时若有灯一直亮着且纹丝不动，十分反常
      var lsl = this.lastAct % SPD;
      var inSleep = isFinite(m.bed.q10) && (lsl >= Math.min(m.bed.q10, 88) || lsl < Math.max(16, (m.wake.q50 || 24) - 2));
      var odd = opt.useContext && stuck && inSleep && avg > m.sleepLevel.q90 + m.sleepLevel.m;
      var oddDay = opt.useContext && stuck && !inSleep && avg > m.levelQ[h] + m.levelM[h];
      var clean = opt.useContext && !stuck && avg < Math.max(0.02, m.delta * 0.4);
      var effThr = odd ? Math.max(opt.oddMin, Math.ceil(thr * opt.oddFactor)) : thr;
      var away = this.isReportedAway(k);
      var lastSlot = this.lastAct % SPD;
      var startedAtNight = lastSlot >= 80 || lastSlot < 16;
      var wq = m.wake.q95;
      // 夜里开始的安静：最晚在“平时 95% 的起床时刻 + 60 分钟”还没动静就报
      if (startedAtNight && isFinite(wq)) {
        var target = Math.ceil(wq) + opt.wakePad;
        var need = lastSlot >= 80 ? SPD - lastSlot + target : target - lastSlot;
        if (need >= 4) effThr = Math.min(effThr, need);
      }
      // 外呼确认平安后，若又安静满 24 小时，重新进入监测（每天至少确认一次）
      if (this.silState === 3 && k - this.confirmedAt >= SPD) { this.silState = 0; effThr = 0; }
      if (!away && this.silState === 0 && gap >= effThr) {
        var lv = odd ? 'red' : 'yellow';
        var beforeWake = isFinite(m.wake.q50) && (s < m.wake.q50 || s >= 80);
        var type = odd && beforeWake ? 'night_odd' : (startedAtNight && s >= 16 && s < 64 ? 'no_wake' : 'silence');
        var title, why;
        if (type === 'no_wake') {
          title = odd ? '晨起未见活动（夜里的灯一直亮着）' : '晨起未见活动';
          why = '平时 95% 的日子在 ' + fmtSlot(Math.round(wq)) + ' 前起床，今天到 ' + fmtSlot(s) + ' 仍没有开关电器、用水等任何动静（最后一次活动 ' + fmtSlot(lastSlot) + '）';
        } else if (type === 'night_odd') {
          title = '夜间异常：灯一直亮着无人操作';
          why = fmtSlot(lastSlot) + ' 有过动静后，约 ' + Math.round(avg * 1000) + ' W 的负载一直开着、功率没有任何变化，已 ' + fmtDur(gap) + '。平时这个时段安静时基本只有冰箱在运行，像是起夜后没能回到床上';
        } else {
          title = (odd || oddDay) ? '长时间无人操作（电器一直开着）' : (clean ? '长时间无活动（疑似外出未归）' : '长时间无活动');
          why = '从 ' + fmtSlot(lastSlot) + ' 起已静默 ' + fmtDur(gap) + '；这个时段开始的安静，平时最长约 ' + fmtDur(Math.max(1, thr - opt.silPad)) + '';
          if (odd || oddDay) why += '；期间约 ' + Math.round(avg * 1000) + ' W 的负载一直开着、功率没有任何变化，平时这个时段很少这样';
        }
        var al = this.emit(k, lv, type, title, why, { gap: gap, thr: effThr, odd: odd, clean: clean, since: this.lastAct });
        this.silState = lv === 'red' ? 2 : 1;
        // 自动语音外呼老人确认平安
        if (typeof opt.confirm === 'function') {
          var ok = opt.confirm(this, k, al);
          al.call = ok ? 'answered' : 'no_answer';
          if (ok && lv === 'yellow') { this.silState = 3; this.confirmedAt = k; }
        }
        out.push(al);
      } else if (!away && this.silState === 1 && gap >= effThr + opt.escalate) {
        this.silState = 2;
        out.push(this.emit(k, 'red', 'silence_escalate', '静默持续，升级为紧急', '关注预警发出后又过了 ' + fmtDur(opt.escalate) + ' 仍无任何活动，自动外呼未确认平安，请家属与网格员尽快上门', { gap: gap, since: this.lastAct }));
      }
    }
    // ---- D2 大功率长时间运行 ----
    var hpv = P[k] - m.bg;
    if (hpv > opt.hpKw) {
      if (this.hpRun === 0) { this.hpMin = hpv; this.hpMax = hpv; }
      this.hpRun++; this.hpMin = Math.min(this.hpMin, hpv); this.hpMax = Math.max(this.hpMax, hpv);
      var flat = opt.useFlat && (this.hpMax - this.hpMin) < opt.hpFlatTol && this.hpRun >= opt.hpFlatSlots;
      if (!this.hpAlerted && (this.hpRun >= m.hpThr || flat)) {
        this.hpAlerted = true;
        out.push(this.emit(k, 'red', 'high_power', '大功率电器长时间运行', '约 ' + hpv.toFixed(1) + ' kW 的负载已连续运行 ' + fmtDur(this.hpRun) + (flat ? '，功率恒定不变（电磁炉、电暖器空烧的典型特征）' : '') + '；平时最长约 ' + fmtDur(m.hpThr - 2) + '，存在干烧、火灾隐患', { run: this.hpRun }));
      }
    } else { this.hpRun = 0; this.hpAlerted = false; }
    // ---- D3 持续用水 ----
    if (W[k] >= opt.wRunLevel) {
      this.wRun++;
      if (!this.wAlerted && this.wRun >= m.wThr) {
        this.wAlerted = true;
        var still = true; for (var j2 = k - this.wRun + 1; j2 <= k; j2++) if (Math.abs(P[j2] - P[j2 - 1]) > m.delta) { still = false; break; }
        out.push(this.emit(k, 'red', 'water_run', still ? '持续用水且无人操作（疑似浴室跌倒）' : '持续用水不止', '已连续出水 ' + fmtDur(this.wRun) + '（约 ' + (W[k] / 15).toFixed(1) + ' 升/分钟）；平时最长约 ' + fmtDur(m.wThr - 2) + (still ? '，期间没有任何开关电器的动作' : '，可能是水龙头忘关'), { run: this.wRun, still: still }));
      }
    } else { this.wRun = 0; this.wAlerted = false; }
    // ---- D4 夜间频繁起夜：每天 05:00 评估 ----
    if (s === 20 && !this.isReportedAway(k)) {
      var nc = 0; for (var s2 = opt.nightFrom; s2 < opt.nightTo; s2++) if (this.isAct(day * SPD + s2)) nc++;
      var z = (nc - m.night.mean) / Math.max(0.7, m.night.sd);
      if (nc >= m.night.mean + opt.nightAbs && z >= opt.nightZ) {
        this.nightStreak++;
        if (this.nightStreak === opt.nightRepeat) out.push(this.emit(k, 'yellow', 'night_restless', '连续夜间频繁起夜', '昨夜凌晨有 ' + nc + ' 个时段有动静，平时约 ' + m.night.mean.toFixed(1) + ' 个；已连续 ' + this.nightStreak + ' 晚明显偏多，可能与尿路感染、发热、心衰加重或失眠有关，建议家属关心、必要时就医', { nights: this.nightStreak }));
        else if (this.nightStreak === 1) out.push(this.emit(k, 'blue', 'night_restless_once', '昨夜起夜偏多', '凌晨有 ' + nc + ' 个时段有动静，平时约 ' + m.night.mean.toFixed(1) + ' 个，继续观察', { nights: 1 }));
      } else this.nightStreak = 0;
    }
    return out;
  };
  // 每日结束：记录特征，检测作息漂移
  Monitor.prototype.endOfDay = function (d, out) {
    var m = this.model; if (!m) return;
    var k0 = d * SPD, cnt = 0, wake = -1;
    for (var s = 0; s < SPD; s++) {
      var a = this.isAct(k0 + s);
      if (a && s >= 20 && s < 92) cnt++;
      if (wake < 0 && s >= 16 && a) { var c2 = 0; for (var j = 1; j <= 8; j++) if (this.isAct(k0 + s + j)) c2++; if (c2 >= 1) wake = s; }
    }
    var awayDay = false; for (var s3 = 24; s3 < 88; s3 += 8) if (this.isReportedAway(k0 + s3)) awayDay = true;
    this.daily.push({ d: d, act: cnt, wake: wake, away: awayDay });
    var recent = this.daily.filter(function (x) { return !x.away && x.d > d - 7; });
    var ref = this.daily.filter(function (x) { return !x.away && x.d <= d - 14 && x.d > d - 42; });
    if (recent.length < 5 || ref.length < 14) return;
    function wk(x) { return x.wake < 0 ? 72 : x.wake; }
    var rw = ref.map(wk), ra = ref.map(function (x) { return x.act; });
    var mw = mean(rw), sw = sd(rw), ma = mean(ra), sa = sd(ra);
    var cw = mean(recent.map(wk)), ca = mean(recent.map(function (x) { return x.act; }));
    var zw = (cw - mw) / Math.max(1.5, sw);
    var za = (ma - ca) / Math.max(2, sa);
    var score = Math.max(zw, za, (zw + za) / 1.6);
    if (score >= this.opt.driftZ) this.driftStreak++; else this.driftStreak = 0;
    if (this.driftStreak >= this.opt.driftDays && (this.driftCool < 0 || d - this.driftCool > 14)) {
      this.driftCool = d;
      var parts = [];
      if (zw > 1) parts.push('起床时间比一个月前平均晚 ' + Math.round((cw - mw) * 15) + ' 分钟');
      if (za > 1) parts.push('日间活动量比一个月前下降 ' + Math.round((1 - ca / ma) * 100) + '%');
      out.push(this.emit((d + 1) * SPD, 'yellow', 'drift', '作息持续偏离', '近 7 天' + (parts.join('、') || '作息明显偏离个人基线') + '，已持续 ' + this.driftStreak + ' 天。可能与情绪低落、慢病加重或认知变化有关，建议家属或家庭医生上门看看', { score: score }));
    }
  };
  // 把一户从头到 kEnd 全部跑一遍（评测用）
  Monitor.prototype.run = function (kStart, kEnd) {
    var all = [];
    for (var k = kStart; k < kEnd; k++) { var o = this.step(k); if (o.length) all = all.concat(o); }
    return all;
  };

  // 画像：用于界面展示
  function profile(P, W, model, days) {
    var slots = []; for (var s = 0; s < SPD; s++) slots.push([]);
    days.forEach(function (d) { for (var s = 0; s < SPD; s++) slots[s].push(P[d * SPD + s]); });
    return {
      p10: slots.map(function (a) { return quantile(a, 0.1); }),
      p50: slots.map(function (a) { return quantile(a, 0.5); }),
      p90: slots.map(function (a) { return quantile(a, 0.9); })
    };
  }

  return { DEFAULTS: DEFAULTS, learn: learn, Monitor: Monitor, profile: profile, quantile: quantile, fmtSlot: fmtSlot, fmtDur: fmtDur, SPD: SPD, SLOT: SLOT };
});
