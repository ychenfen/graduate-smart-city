const { chromium } = require('playwright');
const out = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await p.goto('file://' + process.cwd() + '/index.html'); await p.waitForTimeout(1200);
  // 推进到当晚 20:00（预置的电磁炉忘关事件已发生）
  await p.evaluate(() => { const L = window.__lamp; while (L.k % 96 !== 80) L.step(); L.select(8); L.render(); });
  await p.screenshot({ path: out + '/s_board.png' });
  await p.locator('#facade').screenshot({ path: out + '/s_facade.png' });
  await p.locator('.feed').screenshot({ path: out + '/s_feed.png' });
  // 夜间跌倒注入
  await p.evaluate(() => { const L = window.__lamp; L.select(16); L.inject('fall_night'); L.setPlaying(false); const h=L.homes[16]; const st=L.k; while(!h.alerts.some(a=>a.k>=st)) L.step(); L.render(); });
  await p.locator('#detail').screenshot({ path: out + '/s_detail.png' });
  await p.click('button[data-view="family"]'); await p.waitForTimeout(300);
  await p.locator('.phone').screenshot({ path: out + '/s_phone.png' });
  await b.close();
})();
