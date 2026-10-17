// 录制原型演示视频：node video.js → video/raw.webm + video/subs.srt，再由 ffmpeg 合成带字幕的 mp4
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const SRC = path.resolve(__dirname, '../04_原型系统源码/index.html');
const OUT = path.resolve(__dirname, 'video');
fs.mkdirSync(OUT, { recursive: true });
const card = (big, small) => `<html><body style="margin:0;height:100vh;display:flex;flex-direction:column;justify-content:center;padding:0 120px;background:#1b2a4a;color:#fff;font-family:'Noto Sans CJK SC',sans-serif">
<div style="display:grid;grid-template-columns:40px 40px;gap:6px;margin-bottom:36px"><i style="height:40px;background:#f2b33d"></i><i style="height:40px;background:#3a4c70"></i><i style="height:40px;background:#3a4c70"></i><i style="height:40px;background:#f2b33d"></i></div>
<div style="font:700 64px 'Noto Serif CJK SC',serif;letter-spacing:.06em">${big}</div><div style="font-size:28px;color:#f2b33d;margin-top:22px">${small}</div></body></html>`;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } });
  const p = await ctx.newPage();
  const t0 = Date.now(); const subs = [];
  const now = () => (Date.now() - t0) / 1000;
  let cur = null;
  const wait = (ms) => p.waitForTimeout(ms);
  const sub = async (text) => { if (cur) { const shown = now() - cur.start; if (shown < 3.8) await wait((3.8 - shown) * 1000); cur.end = now(); } const t = now(); cur = text ? { start: t, end: t + 4, text } : null; if (cur) subs.push(cur);
    await p.evaluate((tx) => { let el = document.getElementById('__cap'); if (!el) { el = document.createElement('div'); el.id = '__cap'; el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:1200px;padding:12px 26px;border-radius:10px;background:rgba(12,18,32,.82);color:#fff;font:500 26px/1.45 "Noto Sans CJK SC",sans-serif;z-index:9999;text-align:center;pointer-events:none'; document.body.appendChild(el); } el.textContent = tx || ''; el.style.display = tx ? 'block' : 'none'; }, text); };

  await p.setContent(card('灯语守护', '不装设备，只读两块表，守护独居老人的居家安全')); await wait(4200);
  await p.goto('file://' + SRC); await p.waitForFunction(() => window.__lamp); await wait(600);
  await sub('清晨 5:30，36 户独居老人的楼。每扇窗的明暗，由这一户此刻的用电量驱动');
  await p.selectOption('#speed', '4'); await p.click('#btnPlay');
  await wait(3800);
  await sub('蓝色水滴表示正在用水。不装摄像头、不戴手环，只读电表和水表');
  await p.waitForFunction(() => window.__lamp.k % 96 >= 40); // 10:00
  await sub('系统为每位老人学出自己的作息基线：当天曲线、常见范围、近 28 天的作息指纹');
  await p.selectOption('#speed', '16');
  await p.waitForFunction(() => window.__lamp.feed.some((a) => a.type === 'high_power' && a.k >= 35 * 96), null, { timeout: 60000 });
  await p.click('#btnPlay'); // 暂停
  await p.evaluate(() => { window.__lamp.select(8); });
  await sub('19:15　503 熊大娘家的电磁炉恒定运行超过 1 小时，系统报紧急');
  await wait(3500);
  await p.evaluate(() => window.scrollTo({ top: 900, behavior: 'smooth' })); await wait(1200);
  await sub('每条预警都写明依据，并自动通知家属和网格员');
  await wait(3000);
  await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await wait(900);
  await p.evaluate(() => window.__lamp.select(16)); await wait(800);
  await sub('现场注入：405 乔叔凌晨起夜时跌倒，卫生间的灯一直亮着');
  await p.click('button[data-inj="fall_night"]');
  await p.waitForFunction(() => { const h = window.__lamp.homes[16]; return h.alerts.some((a) => a.level === 'red' && a.k > 35 * 96 + 60); }, null, { timeout: 60000 });
  await wait(600);
  await sub('算法只看读数：睡眠时段灯亮着且纹丝不动，在他平时起床前就报警');
  await wait(4200);
  await p.evaluate(() => window.__lamp.select(11)); await wait(700);
  await sub('再注入：506 贾大爷家的水龙头忘关');
  await p.click('button[data-inj="tap_on"]');
  await p.waitForFunction(() => window.__lamp.homes[11].alerts.some((a) => a.type === 'water_run'), null, { timeout: 60000 });
  await wait(500);
  await sub('持续出水约 1 小时，系统报紧急');
  await wait(3200);
  await p.click('button[data-view="family"]'); await wait(400);
  await sub('家属端只说家人关心的话；电话没人接时，家属和网格员同时收到提醒');
  await wait(4300);
  await p.click('button[data-view="method"]'); await wait(400);
  await sub('模拟留出测试集 100 户：163 起危险事件全部检出，中位 1.2 小时报警');
  await wait(2500);
  await p.evaluate(() => window.scrollTo({ top: 520, behavior: 'smooth' })); await wait(2600);
  await sub(null);
  await p.setContent(card('让每一盏灯，都替老人报一声平安', '原型系统纯本地运行 · 全部数据为模拟生成')); await wait(4200);
  const dur = now();
  await p.close(); await ctx.close(); await b.close();
  const vids = fs.readdirSync(OUT).filter((f) => f.endsWith('.webm')).map((f) => path.join(OUT, f)).sort((a, b2) => fs.statSync(b2).mtimeMs - fs.statSync(a).mtimeMs);
  fs.renameSync(vids[0], path.join(OUT, 'raw.webm'));
  const ts = (s) => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60, r = ms % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(r).padStart(3, '0')}`; };
  fs.writeFileSync(path.join(OUT, 'subs.srt'), subs.map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${s.text}\n`).join('\n'));
  console.log('duration', dur.toFixed(1), 'subs', subs.length);
})();
