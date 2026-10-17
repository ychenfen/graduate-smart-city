/* 灯语守护 · 看护台界面逻辑（依赖 simulator.js、engine.js、test/results.js） */
(function () {
  'use strict';
  var Sim = window.LampSim, Eng = window.LampEngine;
  var SPD = 96, D = 72, START_DAY = 35, START_SLOT = 22;
  var DAY0 = new Date(2026, 8, 7);            // 第 0 天为 2026 年 9 月 7 日（周一）
  var WEEK = '日一二三四五六';
  var $ = function (id) { return document.getElementById(id); };

  // ---------- 生成 36 户 ----------
  var natural = { 8: [{ type: 'stove_on', day: 35, dinner: true }], 14: [{ type: 'night_restless', day: 34 }], 20: [{ type: 'tap_on', day: 36 }], 27: [{ type: 'drift', day: 6 }], 31: [{ type: 'fall_night', day: 37 }] };
  var homes = [];
  var k = START_DAY * SPD + START_SLOT;       // 当前时段
  var selected = 0;
  var feed = [];
  var playing = false, untilAlert = null;
  var callRng = Sim.rngOf(20261017);

  function build() {
    for (var i = 0; i < 36; i++) {
      var floor = 6 - Math.floor(i / 6), col = i % 6 + 1;
      var p = Sim.makePersona(501 + i);
      p.unit = floor * 100 + col;
      var sim = Sim.simulateHousehold(p, { days: D, events: natural[i] || [] });
      var h = { i: i, p: p, sim: sim, P: sim.P, W: sim.W, origP: new Float32Array(sim.P), origW: new Float32Array(sim.W), danger: [], alerts: [], status: 'ok', handledAt: -1 };
      // 自然发生的危险事件也记入“出事时段”，外呼时老人无法接听
      sim.truth.forEach(function (t) { if (/fall|never_wake/.test(t.type)) h.danger.push([Math.floor(t.onset / 15), Math.floor(t.end / 15)]); });
      h.mon = new Eng.Monitor({ P: sim.P, W: sim.W, away: sim.away, name: p.name }, { confirm: confirmFn(h) });
      homes.push(h);
    }
    // 预先运行到起始时刻：前 35 天用于学习每位老人的作息
    for (var kk = 0; kk <= k; kk++) homes.forEach(function (h) {
      var out = h.mon.step(kk);
      out.forEach(function (a) { if (a.t >= (START_DAY - 3) * 1440) addAlert(h, a, true); });
    });
  }
  function confirmFn(h) {
    return function (mon, kk) {
      if (h.danger.some(function (r) { return kk >= r[0] && kk <= r[1]; })) return false;
      return callRng() < 0.85;
    };
  }

  // ---------- 时间 ----------
  function dateOf(kk) { var d = new Date(DAY0); d.setDate(d.getDate() + Math.floor(kk / SPD)); return d; }
  function hhmm(kk) { return Eng.fmtSlot(kk % SPD); }
  function dateLabel(kk) { var d = dateOf(kk); return (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 周' + WEEK[d.getDay()]; }
  function shortWhen(kk) { var d = dateOf(kk); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hhmm(kk); }

  // ---------- 推进 ----------
  function stepAll() {
    if (k + 1 >= D * SPD - 1) { setPlaying(false); return; }
    k++;
    homes.forEach(function (h) {
      var out = h.mon.step(k);
      out.forEach(function (a) { addAlert(h, a, false); });
    });
  }
  function addAlert(h, a, quiet) {
    a.h = h; a.id = 'a' + feed.length; a.done = false; a.fresh = !quiet;
    h.alerts.push(a); feed.unshift(a);
    if (!quiet && untilAlert && untilAlert.i === h.i && a.k >= untilAlert.since) {
      untilAlert = null; setPlaying(false); setSpeed(4); select(h.i);
    }
  }
  function statusOf(h) {
    var m = h.mon, lv = 'ok', why = '';
    var rank = { ok: 0, away: 1, warn: 2, red: 3 };
    if (m.isReportedAway(k)) { lv = 'away'; why = '已报备外出'; }
    h.alerts.forEach(function (a) {
      if (a.done || a.k < h.handledAt) return;
      var live = false;
      if (/silence|no_wake|night_odd/.test(a.type)) live = m.lastAct <= a.since || m.lastAct === a.since;
      else if (a.type === 'high_power') live = m.hpRun > 0 && k - a.k < 24;
      else if (a.type === 'water_run') live = m.wRun > 0 && k - a.k < 24;
      else if (a.level !== 'blue') live = k - a.k < 72;
      if (!live) return;
      var l = a.level === 'red' ? 'red' : a.level === 'yellow' ? (a.call === 'answered' ? 'ok' : 'warn') : 'ok';
      if (rank[l] > rank[lv]) { lv = l; why = a.title; }
    });
    return { lv: lv, why: why };
  }

  // ---------- 楼宇立面 ----------
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var a in attrs) e.setAttribute(a, attrs[a]); if (parent) parent.appendChild(e); return e; }
  var svg = $('facadeSvg'), skyTop, skyBot, stars, sun, wins = [];
  function buildFacade() {
    var defs = el('defs', {}, svg);
    var g = el('linearGradient', { id: 'sky', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    skyTop = el('stop', { offset: '0', 'stop-color': '#0b1530' }, g);
    skyBot = el('stop', { offset: '1', 'stop-color': '#1d2c52' }, g);
    var glow = el('radialGradient', { id: 'glow' }, defs);
    el('stop', { offset: '0', 'stop-color': '#ffd98a', 'stop-opacity': '.55' }, glow);
    el('stop', { offset: '1', 'stop-color': '#ffd98a', 'stop-opacity': '0' }, glow);
    el('rect', { x: 0, y: 0, width: 760, height: 560, fill: 'url(#sky)' }, svg);
    stars = el('g', {}, svg);
    var r = Sim.rngOf(7);
    for (var s = 0; s < 60; s++) el('circle', { cx: r() * 760, cy: r() * 120, r: r() * 1.2 + .3, fill: '#fff', opacity: r() * .7 + .2 }, stars);
    sun = el('circle', { cx: 650, cy: 60, r: 18, fill: '#f6f1d8' }, svg);
    // 远处楼群剪影
    el('path', { d: 'M0 420 L0 300 L40 300 L40 260 L80 260 L80 330 L0 330 Z M680 330 L700 330 L700 250 L740 250 L740 290 L760 290 L760 420 Z', fill: '#16223f', opacity: .9 }, svg);
    // 主楼
    el('rect', { x: 70, y: 48, width: 620, height: 500, rx: 4, fill: '#cfc6b8' }, svg);
    el('rect', { x: 70, y: 40, width: 620, height: 14, fill: '#a99f90' }, svg);
    for (var f = 0; f < 6; f++) el('rect', { x: 70, y: 48 + f * 80 + 76, width: 620, height: 4, fill: '#b8ae9f' }, svg);
    homes.forEach(function (h, i) {
      var row = Math.floor(i / 6), col = i % 6;
      var x = 88 + col * 100, y = 62 + row * 80;
      var gw = el('g', { class: 'win', tabindex: 0, role: 'button', 'aria-label': h.p.unit + ' ' + h.p.name }, svg);
      var halo = el('ellipse', { cx: x + 38, cy: y + 24, rx: 58, ry: 40, fill: 'url(#glow)', opacity: 0 }, gw);
      var glass = el('rect', { x: x, y: y, width: 76, height: 48, rx: 2, fill: '#24324f' }, gw);
      el('line', { x1: x + 38, y1: y, x2: x + 38, y2: y + 48, stroke: '#8f8676', 'stroke-width': 2 }, gw);
      var person = el('rect', { x: x + 12, y: y + 22, width: 7, height: 20, rx: 3, fill: '#5a4630', opacity: 0 }, gw);
      var drop = el('path', { d: 'M' + (x + 64) + ' ' + (y + 8) + ' q5 7 0 11 q-5 -4 0 -11z', fill: '#5fb3ff', opacity: 0 }, gw);
      var frame = el('rect', { class: 'frame', x: x - 3, y: y - 3, width: 82, height: 54, rx: 4, fill: 'none', stroke: '#7d7466', 'stroke-width': 2 }, gw);
      var label = el('text', { x: x + 38, y: y + 63, 'text-anchor': 'middle', 'font-size': 11.5, fill: '#3a3329', 'font-family': 'Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif' }, gw);
      label.textContent = h.p.unit + ' ' + h.p.name;
      gw.addEventListener('click', function () { select(i); });
      gw.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i); } });
      wins.push({ g: gw, glass: glass, frame: frame, halo: halo, drop: drop, person: person, label: label });
    });
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  function mix(c1, c2, t) { var a = hex(c1), b = hex(c2); return 'rgb(' + Math.round(lerp(a[0], b[0], t)) + ',' + Math.round(lerp(a[1], b[1], t)) + ',' + Math.round(lerp(a[2], b[2], t)) + ')'; }
  function skyAt(slot) {
    var hr = slot / 4;
    var keys = [[0, '#081126', '#16244a'], [5, '#0d1a3a', '#24335e'], [6.2, '#3d4f80', '#e8a983'], [7.5, '#7fa8d8', '#cfe0f0'], [16.5, '#86aedb', '#d7e5f2'], [17.8, '#4a4f80', '#e88f6b'], [19, '#111d40', '#283a66'], [24, '#081126', '#16244a']];
    for (var i = 0; i < keys.length - 1; i++) if (hr >= keys[i][0] && hr < keys[i + 1][0]) {
      var t = (hr - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
      return { top: mix(keys[i][1], keys[i + 1][1], t), bot: mix(keys[i][2], keys[i + 1][2], t), dark: hr < 6.3 || hr > 18.2 };
    }
    return { top: '#081126', bot: '#16244a', dark: true };
  }
  function renderFacade() {
    var s = k % SPD, sky = skyAt(s);
    skyTop.setAttribute('stop-color', sky.top); skyBot.setAttribute('stop-color', sky.bot);
    stars.setAttribute('opacity', sky.dark ? 1 : 0);
    var hr = s / 4;
    sun.setAttribute('fill', sky.dark ? '#f2eed8' : '#fff4c2');
    sun.setAttribute('cy', sky.dark ? 54 : 40 + Math.abs(12 - hr) * 6);
    var counts = { ok: 0, warn: 0, red: 0, away: 0 };
    homes.forEach(function (h, i) {
      var w = wins[i], m = h.mon;
      var v = h.P[k] - (m.model ? m.model.bg : 0.05);
      var lit = m.model ? (v > m.model.sleepLevel.q90 + m.model.sleepLevel.m + 0.01 || m.isAct(k)) : v > 0.05;
      var L = Math.min(1, Math.max(0, v / 0.3));
      var dim = sky.dark ? '#1b2640' : '#5f7799';
      w.glass.setAttribute('fill', lit ? mix(dim, sky.dark ? '#ffc95c' : '#f3d79a', Math.min(1, 0.45 + L * 0.8)) : dim);
      w.halo.setAttribute('opacity', lit && sky.dark ? Math.min(1, 0.4 + L) : 0);
      w.drop.setAttribute('opacity', h.W[k] > 1 ? 1 : 0);
      w.person.setAttribute('opacity', m.isAct(k) ? 0.85 : 0);
      var st = statusOf(h); h.status = st.lv; h.statusWhy = st.why; counts[st.lv]++;
      var col = st.lv === 'red' ? '#ff4a4a' : st.lv === 'warn' ? '#f08a2b' : st.lv === 'away' ? '#8fa0bb' : (i === selected ? '#2a4f86' : '#7d7466');
      w.frame.setAttribute('stroke', col);
      w.frame.setAttribute('stroke-width', st.lv === 'red' || st.lv === 'warn' || i === selected ? 4 : 2);
      w.frame.setAttribute('class', 'frame' + (st.lv === 'red' ? ' pulse' : ''));
      w.label.setAttribute('font-weight', i === selected ? 700 : 400);
      if (st.lv === 'away') w.glass.setAttribute('fill', sky.dark ? '#2a3550' : '#7a8aa3');
    });
    $('tally').innerHTML = '<span><i class="dot" style="background:var(--ok)"></i>平稳<b>' + counts.ok + '</b></span><span><i class="dot" style="background:var(--warn)"></i>关注<b>' + counts.warn + '</b></span><span><i class="dot" style="background:var(--red)"></i>紧急<b>' + counts.red + '</b></span><span><i class="dot" style="background:var(--away)"></i>外出<b>' + counts.away + '</b></span>';
    $('clockTime').textContent = hhmm(k);
    $('clockDate').textContent = dateLabel(k);
  }

  // ---------- 户详情 ----------
  function select(i) { selected = i; renderAll(); }
  var STATUS_TXT = { ok: ['ok', '平稳'], warn: ['warn', '关注'], red: ['red', '紧急'], away: ['away', '报备外出'] };
  function renderDetail() {
    var h = homes[selected], m = h.mon.model, p = h.p;
    $('dUnit').textContent = p.unit;
    $('dName').textContent = p.name;
    $('dMeta').textContent = p.age + ' 岁 · 独居 · ' + p.persona + ' · ' + (p.heater === 'electric' ? '电热水器' : '燃气热水器');
    var st = STATUS_TXT[h.status || 'ok'];
    var pill = $('dPill'); pill.className = 'pill ' + st[0]; pill.textContent = st[1];
    var gap = h.mon.lastAct >= 0 ? k - h.mon.lastAct : 0;
    var line;
    if (h.status === 'red' || h.status === 'warn') line = '⚠ ' + h.statusWhy;
    else if (h.status === 'away') line = '已报备外出，静默不报警；电器、用水异常照常提醒。';
    else if (h.mon.isAct(k)) line = '此刻有人在活动' + (h.W[k] > 1 ? '（在用水）' : '') + '。';
    else line = '最近一次活动在 ' + hhmm(h.mon.lastAct) + '，一切在 TA 的日常范围内。';
    $('dStatus').textContent = line;
    if (m) {
      $('fWake').textContent = Eng.fmtSlot(Math.round(m.wake.q95)) + ' 前';
      $('fBed').textContent = isFinite(m.bed.q50) ? '约 ' + Eng.fmtSlot(Math.round(m.bed.q50) + 1) : '—';
      $('fGap').textContent = Eng.fmtDur(gap);
      var hrs = Math.floor((h.mon.lastAct % SPD) / 4);
      $('fThr').textContent = Eng.fmtDur(m.silThr[hrs]);
    }
    drawDay(h); drawPrint(h);
  }
  function canvasCtx(cv) {
    var dpr = window.devicePixelRatio || 1, w = cv.clientWidth, hgt = +cv.getAttribute('height');
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); cv.style.height = hgt + 'px'; }
    var c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, hgt);
    return { c: c, w: w, h: hgt };
  }
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  var profCache = {};
  function drawDay(h) {
    var X = canvasCtx($('cvDay')), c = X.c, W = X.w, H = X.h;
    var m = h.mon.model; if (!m) return;
    var key = h.i + ':' + m.days[m.days.length - 1];
    var prof = profCache[key] || (profCache[key] = Eng.profile(h.P, h.W, m, m.days));
    var d0 = Math.floor(k / SPD) * SPD, now = k - d0;
    var L = 30, R = 8, T = 8, B = 42, wh = 26;
    var pw = W - L - R, ph = H - T - B;
    var ymax = 0.6;
    for (var s = 0; s <= now; s++) ymax = Math.max(ymax, h.P[d0 + s]);
    for (var s2 = 0; s2 < SPD; s2++) ymax = Math.max(ymax, prof.p90[s2]);
    ymax = Math.ceil(ymax * 2.2) / 2;
    function x(s) { return L + s / SPD * pw; }
    function y(v) { return T + ph - Math.min(v, ymax) / ymax * ph; }
    var muted = css('--muted'), line = css('--line'), fg = css('--fg');
    c.font = '11px ' + css('--sans'); c.fillStyle = muted; c.strokeStyle = line; c.lineWidth = 1;
    for (var g = 0; g <= 24; g += 6) { c.beginPath(); c.moveTo(x(g * 4), T); c.lineTo(x(g * 4), T + ph + wh + 6); c.stroke(); c.fillText(g + '时', x(g * 4) - (g === 24 ? 22 : 0), H - 4); }
    [0, ymax / 2, ymax].forEach(function (v) { c.fillText(v.toFixed(1), 2, y(v) + 4); });
    // 个人常见范围
    c.fillStyle = 'rgba(80,130,200,.18)'; c.beginPath();
    for (var s3 = 0; s3 < SPD; s3++) c.lineTo(x(s3 + .5), y(prof.p90[s3]));
    for (var s4 = SPD - 1; s4 >= 0; s4--) c.lineTo(x(s4 + .5), y(prof.p10[s4]));
    c.closePath(); c.fill();
    // 今日用电
    c.strokeStyle = '#e9a23b'; c.lineWidth = 2; c.beginPath();
    for (var s5 = 0; s5 <= now; s5++) { var vx = x(s5 + .5), vy = y(h.P[d0 + s5]); if (s5 === 0) c.moveTo(vx, vy); else c.lineTo(vx, vy); }
    c.stroke();
    // 用水
    var wy = T + ph + 4;
    for (var s6 = 0; s6 <= now; s6++) { var wv = h.W[d0 + s6]; if (wv > 0) { var bh = Math.min(wh, 4 + wv / 60 * wh); c.fillStyle = '#3d8fd6'; c.fillRect(x(s6) + 1, wy + wh - bh, Math.max(1.5, pw / SPD - 2), bh); } }
    c.fillStyle = muted; c.fillText('用水', 2, wy + wh - 4);
    // 今日预警
    h.alerts.forEach(function (a) {
      if (a.k < d0 || a.k > k) return;
      var ax = x(a.k - d0 + .5);
      c.fillStyle = a.level === 'red' ? '#cc3333' : a.level === 'yellow' ? '#c96a10' : '#2a4f86';
      c.beginPath(); c.moveTo(ax - 6, T); c.lineTo(ax + 6, T); c.lineTo(ax, T + 9); c.closePath(); c.fill();
    });
    // 现在
    c.strokeStyle = fg; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x(now + 1), T); c.lineTo(x(now + 1), T + ph + wh + 4); c.stroke(); c.setLineDash([]);
  }
  function drawPrint(h) {
    var X = canvasCtx($('cvPrint')), c = X.c, W = X.w, H = X.h;
    var m = h.mon.model; if (!m) return;
    var today = Math.floor(k / SPD), rows = 29, L = 44, T = 4, B = 16;
    var cw = (W - L - 4) / SPD, ch = (H - T - B) / rows;
    var sunk = css('--sunk'), muted = css('--muted');
    c.font = '11px ' + css('--sans');
    for (var r = 0; r < rows; r++) {
      var d = today - 28 + r;
      var away = false;
      for (var s = 0; s < SPD; s++) {
        var kk = d * SPD + s;
        if (kk > k) break;
        var col = sunk;
        if (h.mon.isReportedAway(kk)) { col = 'rgba(140,155,180,.35)'; away = true; }
        if (h.mon.isAct(kk)) col = h.W[kk] > 1 && Math.abs(h.P[kk] - h.P[kk - 1]) <= m.delta ? '#5fa3e0' : '#e9a23b';
        else if (h.P[kk] - m.bg > 0.03) col = 'rgba(233,162,59,.32)';
        c.fillStyle = col; c.fillRect(L + s * cw, T + r * ch, Math.max(1, cw - .4), Math.max(1, ch - .6));
      }
    }
    c.fillStyle = muted;
    c.fillText('4 周前', 2, T + 9); c.fillText('今天', 2, T + (rows - .2) * ch);
    [0, 6, 12, 18].forEach(function (g) { c.fillText(g + '时', L + g * 4 * cw, H - 3); });
  }

  // ---------- 预警流 ----------
  function renderFeed() {
    var list = feed.slice(0, 24);
    $('feedEmpty').hidden = list.length > 0;
    $('feed').innerHTML = list.map(function (a) {
      var lvTxt = a.level === 'red' ? '紧急' : a.level === 'yellow' ? '关注' : '提示';
      var steps = '';
      if (/silence|no_wake|night_odd/.test(a.type) && a.level === 'yellow') {
        steps = a.call === 'answered' ? '<li class="safe">自动外呼：老人已接听、按键报平安</li><li>记录备查</li>'
          : '<li class="on">自动外呼：未接通</li><li class="on">已通知家属</li><li>90 分钟内仍无活动将升级紧急</li>';
      } else if (a.level === 'red') steps = '<li class="go">已通知家属</li><li class="go">已派单网格员上门</li><li class="on">同步自动外呼老人</li>';
      else if (a.level === 'yellow') steps = '<li class="on">已推送家属</li><li>建议家庭医生随访</li>';
      else steps = '<li>记入周报，继续观察</li>';
      return '<article class="alert ' + (a.level === 'red' ? 'red' : a.level === 'blue' ? 'blue' : '') + (a.done ? ' done' : '') + (a.fresh && a.level === 'red' && !a.done ? ' fresh' : '') + '">' +
        '<div class="h"><span>' + lvTxt + ' · ' + a.h.p.unit + ' ' + a.h.p.name + '</span><span class="num">' + shortWhen(a.k) + '</span></div>' +
        '<p class="t">' + a.title + '</p><p class="why">' + a.why + '</p><ul class="steps">' + steps + '</ul>' +
        (a.done ? '<div class="acts"><span class="hint" style="font-size:12px;color:var(--muted)">' + a.doneText + '</span></div>' :
          '<div class="acts"><button data-act="view" data-id="' + a.id + '">查看这户</button><button data-act="done" data-id="' + a.id + '">已处置</button><button data-act="fp" data-id="' + a.id + '">标记误报</button></div>') +
        '</article>';
    }).join('');
  }
  $('feed').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var a = feed.filter(function (x) { return x.id === b.dataset.id; })[0]; if (!a) return;
    if (b.dataset.act === 'view') { select(a.h.i); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    a.done = true; a.doneText = b.dataset.act === 'done' ? '已处置（' + hhmm(k) + '）' : '已标记误报，将用于调整这户的个人阈值';
    if (b.dataset.act === 'done') rescue(a.h);
    renderAll();
  });
  // 上门处置后：这户恢复正常生活（演示中用原始模拟数据替换之后的读数）
  function rescue(h) {
    h.handledAt = k;
    h.alerts.forEach(function (x) { if (!x.done) { x.done = true; x.doneText = '已随本户处置'; } });
    var stillDanger = h.danger.some(function (r) { return k >= r[0] && k <= r[1]; });
    if (!stillDanger) return;
    h.danger = h.danger.map(function (r) { return k >= r[0] && k <= r[1] ? [r[0], k] : r; });
    // 从下一天早上起恢复日常
    var resume = (Math.floor(k / SPD) + 1) * SPD + 28;
    for (var j = k + 1; j < h.P.length; j++) {
      if (j < resume) { h.P[j] = quiet(h, j) + 0.06; h.W[j] = (j - k) % 8 === 0 ? 6 : 0; }
      else { h.P[j] = h.origP[j]; h.W[j] = h.origW[j]; }
    }
    h.mon.exclude[Math.floor(k / SPD)] = 1;
  }

  // ---------- 现场注入 ----------
  function quiet(h, j) { var src = (Math.floor(j / SPD) - 2) * SPD + 8 + (j % 10); return h.origP[Math.max(0, src)]; }
  function jumpToSlot(slot) {
    var target = Math.floor(k / SPD) * SPD + slot;
    if (target <= k) target += SPD;
    while (k < target) stepAll();
  }
  function inject(type) {
    var h = homes[selected], p = h.p, s = k % SPD, j, end;
    if (type === 'fall_day' && (s < 32 || s > 78)) jumpToSlot(38);
    if (type === 'fall_night') jumpToSlot(6);
    if (type === 'fall_bath' && (s < 76 || s > 86)) jumpToSlot(80);
    var k0 = k + 1;   // 从下一个时段开始改写读数（当前时段已被算法处理过）
    if (type === 'fall_day') {
      var on = h.P[k0] - h.mon.model.bg; var stuck = on > 0.03 && on < 0.4 ? on : p.tvKw;
      h.W[k0] = 6; h.P[k0] = quiet(h, k0) + stuck;   // 刚刚还在活动（冲了马桶），随后倒地
      for (j = k0 + 1; j < Math.min(h.P.length, k0 + 130); j++) { h.P[j] = quiet(h, j) + stuck; h.W[j] = 0; }
      if (h.mon.silState === 3) h.mon.silState = 0;
      h.danger.push([k0, k0 + 130]);
    } else if (type === 'fall_night') {
      h.P[k0] = quiet(h, k0) + p.lightKw; h.W[k0] = 6;
      for (j = k0 + 1; j < Math.min(h.P.length, k0 + 130); j++) { h.P[j] = quiet(h, j) + p.lightKw; h.W[j] = 0; }
      h.danger.push([k0, k0 + 130]);
    } else if (type === 'fall_bath') {
      for (j = k0 + 1; j < Math.min(h.P.length, k0 + 130); j++) {
        h.P[j] = quiet(h, j) + p.lightKw + (p.heater === 'electric' && j - k0 < 9 ? 2.0 : 0);
        h.W[j] = j - k0 < 16 ? 52 : 0;
      }
      h.W[k0] = 40;
      h.danger.push([k0, k0 + 130]);
    } else if (type === 'stove_on') {
      for (j = k0 + 1; j < k0 + 13; j++) h.P[j] += p.stoveKw;
    } else if (type === 'tap_on') {
      for (j = k0 + 1; j < k0 + 11; j++) h.W[j] += 45;
    } else if (type === 'away') {
      end = k0 + 2 * SPD;
      h.mon.reported.push([k0 + 1, end]);
      for (j = k0 + 1; j < end; j++) { h.P[j] = quiet(h, j); h.W[j] = 0; }
      for (j = end; j < end + 2; j++) { h.P[j] = h.origP[j] + 0.3; h.W[j] = 6; }
      renderAll(); return;
    }
    untilAlert = { i: h.i, since: k0 };
    setSpeed(16); setPlaying(true);
  }
  $('inject').addEventListener('click', function (e) { var b = e.target.closest('button[data-inj]'); if (b) inject(b.dataset.inj); });

  // ---------- 家属端 ----------
  function familyDay(h) {
    var m = h.mon.model, d0 = Math.floor(k / SPD) * SPD, ev = [];
    if (!m) return ev;
    var wake = -1;
    for (var s = 16; s <= k - d0; s++) if (h.mon.isAct(d0 + s)) { var c2 = 0; for (var j = 1; j <= 8; j++) if (d0 + s + j <= k && h.mon.isAct(d0 + s + j)) c2++; if (c2 >= 1) { wake = s; break; } }
    if (wake >= 0) ev.push([wake, '起床了（开灯、用水）']);
    [[24, 40, '做了早饭'], [43, 54, '做了午饭'], [66, 80, '做了晚饭']].forEach(function (w) {
      for (var s2 = w[0]; s2 < w[1] && d0 + s2 <= k; s2++) if (h.P[d0 + s2] - m.bg > 0.5) { ev.push([s2, w[2]]); break; }
    });
    var run = 0;
    for (var s3 = 30; s3 <= Math.min(76, k - d0); s3++) {
      var quietSlot = h.P[d0 + s3] - m.bg < 0.03 && h.W[d0 + s3] < 1 && !h.mon.isAct(d0 + s3);
      if (quietSlot) run++; else { if (run >= 5) ev.push([s3 - run, '出门了，约 ' + Eng.fmtDur(run) + '后回家']); run = 0; }
    }
    for (var s4 = 70; s4 <= Math.min(94, k - d0); s4++) if (h.W[d0 + s4] >= 40) { ev.push([s4, '洗了澡']); break; }
    ev.sort(function (a, b) { return a[0] - b[0]; });
    return ev;
  }
  function renderFamily() {
    var h = homes[selected], p = h.p;
    $('phTime').textContent = hhmm(k);
    var who = p.female ? '妈妈' : '爸爸';
    var st = h.status, card;
    if (st === 'red') card = '<div class="card alarm"><div class="big">' + who + '家需要有人去看看</div><p class="sm" style="color:#8a1f1f">' + h.statusWhy + '。系统已通知社区网格员，电话打不通。</p><button class="primary" style="background:#b42318">我离得近，我去</button><button class="ghost">请网格员先上门</button></div>';
    else if (st === 'warn') card = '<div class="card" style="background:#fdf1e2;color:#7a3d00"><div class="big">' + h.statusWhy + '</div><p class="sm" style="color:#7a3d00">系统刚给' + who + '打了电话没人接，建议您也打一个。</p><button class="primary">给' + who + '打电话</button></div>';
    else if (st === 'away') card = '<div class="card"><div class="big">' + who + '外出中</div><p class="sm">已报备外出，这几天家里没动静不会提醒。</p></div>';
    else card = '<div class="card calm"><div class="big">' + who + '今天挺好</div><p class="sm" style="color:#1f5a3c">作息在平常范围内</p></div>';
    var ev = familyDay(h);
    var tl = ev.length ? ev.map(function (e) { return '<li><time class="num">' + Eng.fmtSlot(e[0]) + '</time><span>' + e[1] + '</span></li>'; }).join('') : '<li><span class="sm">今天还没有动静记录</span></li>';
    $('phoneApp').innerHTML = '<h3>' + who + '（' + p.name + '）</h3><div class="sm">' + p.unit + ' 室 · ' + dateLabel(k) + '</div>' + card +
      '<div class="card"><div style="font-weight:600">今天</div><ul class="tl">' + tl + '</ul></div>' +
      '<button class="ghost" id="phAway">报备外出两天</button>';
    $('phAway').onclick = function () { inject('away'); renderFamily(); };
  }

  // ---------- 方法与实测 ----------
  function pct(v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; }
  function hrs(v) { return v == null ? '—' : v.toFixed(1) + ' 小时'; }
  function renderMethod() {
    var R = window.LAMP_RESULTS; if (!R) { $('methodDoc').innerHTML = '<p>缺少 test/results.js，请先运行 node test/eval.js。</p>'; return; }
    var r = R.results, ab = R.ablation;
    var rows = Object.keys(r.perType).map(function (t) { var x = r.perType[t]; return '<tr><td>' + x.name + '</td><td class="n">' + x.n + '</td><td class="n">' + pct(x.recall) + '</td><td class="n">' + pct(x.recallRed) + '</td><td class="n">' + hrs(x.medianDelayH) + '</td></tr>'; }).join('');
    var abRows = ab.map(function (a) { return '<tr' + (a.key === 'full' ? ' class="hl"' : '') + '><td>' + a.name + '</td><td class="n">' + pct(a.dangerRecall) + '</td><td class="n">' + hrs(a.dangerMedianDelayH) + '</td><td class="n">' + pct(a.careRecall) + '</td><td class="n">' + a.redFA.toFixed(2) + '</td><td class="n">' + a.yellowFA.toFixed(2) + '</td></tr>'; }).join('');
    $('methodDoc').innerHTML =
      '<h2>只看电表和水表，怎么知道老人“还好吗”</h2>' +
      '<p>每户智能电表每 15 分钟报一次用电量，远传水表报一次用水量。开灯、烧水、冲马桶都会在这两条曲线上留下“台阶”。系统用每位老人自己过去 28 天的数据学出 TA 的作息，再盯住“该有动静却没有动静”的反常时刻。</p>' +
      '<div class="flow"><div><b>采集</b>15 分钟电量与水量，经用户授权，不装任何新设备</div><div><b>个人基线</b>每晚用近 28 个正常日重新学习：起床、入睡、各时段通常会安静多久</div><div><b>情境判断</b>灯一直亮着没人关？只剩冰箱在转像是出门了？水一直流？</div><div><b>分级处置</b>关注先自动外呼老人确认；紧急同时通知家属与网格员</div><div><b>反馈</b>处置结果与误报标记回流，调整这户的阈值</div></div>' +
      '<h3>留出测试集上的实测结果</h3>' +
      '<p class="muted">' + r.split + '。参数只在开发集（另外 40 户）上调整，定稿后才运行留出集。数据由团队编写的模拟器生成，尚未在真实住户上验证。</p>' +
      '<div class="kpis"><div class="kpi"><b>' + pct(r.danger.recall) + '</b><span>六类危险事件检出率（' + r.danger.n + ' 起）</span></div><div class="kpi"><b>' + r.danger.medianDelayH.toFixed(1) + ' h</b><span>从出事到报警的中位时间</span></div><div class="kpi"><b>' + r.fa.redPerHouseMonth.toFixed(2) + '</b><span>需人上门的误报，次/户·月</span></div><div class="kpi"><b>' + (r.avgStepMs * 1000).toFixed(0) + ' μs</b><span>每户每 15 分钟的计算耗时</span></div></div>' +
      '<table><thead><tr><th>事件</th><th class="n">起数</th><th class="n">检出率</th><th class="n">紧急级检出</th><th class="n">中位检出时间</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="muted" style="margin-top:8px">“睡梦中突发疾病”从发病时刻算起较晚，是因为老人本就在睡觉；从 TA 平时起床的时刻算起，中位约 ' + (r.perType.never_wake.medianAfterUsualWakeH || 0).toFixed(1) + ' 小时报警。夜间起夜跌倒因灯一直亮着，中位在平时起床前 ' + Math.abs(r.perType.fall_night.medianAfterUsualWakeH || 0).toFixed(1) + ' 小时就报警。</p>' +
      '<h3>消融与对比</h3>' +
      '<table><thead><tr><th>方案</th><th class="n">危险事件检出</th><th class="n">中位检出时间</th><th class="n">关注类检出</th><th class="n">紧急误报/户·月</th><th class="n">关注误报/户·月</th></tr></thead><tbody>' + abRows + '</tbody></table>' +
      '<p class="muted" style="margin-top:8px">固定阈值规则是团队参照公开报道中电力看护平台的常见做法自行复现的（连续 12 小时无用电变化、日用电量低于近期均值的 40% 等），并非任何一家的真实系统。关注误报大多由自动外呼直接消化，老人按键报平安即可，不需要人上门。</p>';
  }

  // ---------- 播放控制 ----------
  var speed = 4, acc = 0, lastT = 0;
  function setSpeed(v) { speed = v; $('speed').value = String(v); }
  function setPlaying(v) { playing = v; $('btnPlay').textContent = v ? '❚❚ 暂停' : '▶ 播放'; if (v) { lastT = performance.now(); requestAnimationFrame(loop); } }
  $('btnPlay').addEventListener('click', function () { setPlaying(!playing); });
  $('speed').addEventListener('change', function () { speed = +this.value; });
  function loop(t) {
    if (!playing) return;
    acc += (t - lastT) / 1000 * speed; lastT = t;
    var n = 0;
    while (acc >= 1 && n < 40) { stepAll(); acc -= 1; n++; if (!playing) break; }
    if (n) { feed.forEach(function (a) { if (a.fresh && k - a.k > 8) a.fresh = false; }); renderAll(); }
    if (untilAlert && k - untilAlert.since > SPD * 1.5) { untilAlert = null; setPlaying(false); setSpeed(4); }
    if (playing) requestAnimationFrame(loop);
  }

  // ---------- 视图切换 ----------
  var view = 'board';
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      view = b.dataset.view;
      document.querySelectorAll('.tabs button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
      ['board', 'family', 'method'].forEach(function (v) { $('view-' + v).hidden = v !== view; });
      renderAll();
    });
  });
  function renderAll() {
    renderFacade();
    if (view === 'board') { renderDetail(); renderFeed(); }
    else if (view === 'family') renderFamily();
    else renderMethod();
  }
  window.addEventListener('resize', function () { if (view === 'board') renderDetail(); });

  // 启动
  setTimeout(function () {
    build(); buildFacade();
    // 默认选中一位有故事的老人
    selected = 8;
    renderAll();
    window.__lamp = { homes: homes, step: stepAll, inject: inject, select: select, get k() { return k; }, setPlaying: setPlaying, jumpToSlot: jumpToSlot, render: renderAll, feed: feed };
  }, 30);
})();
