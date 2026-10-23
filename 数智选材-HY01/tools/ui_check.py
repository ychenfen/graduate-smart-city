#!/usr/bin/env python3
"""用无头 Chromium 实测离线原型：七案例、无解提示、碳排约束、稳健选优、反馈、导出、移动端与暗色。
依赖：pip install playwright && playwright install chromium。输出截图与 receipt.json 到 paper/verification_v2/ui/。
用法：python3 tools/ui_check.py [index.html 路径]"""
import json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

R = Path(__file__).resolve().parents[1]
PAGE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else R / 'prototype/index.html'
OUT = R / 'paper/verification_v2/ui'
OUT.mkdir(parents=True, exist_ok=True)
receipt = {'page': str(PAGE.relative_to(R)) if PAGE.is_relative_to(R) else str(PAGE), 'checks': [], 'console_errors': [], 'page_errors': []}

def check(name, ok, detail=''):
    receipt['checks'].append({'name': name, 'ok': bool(ok), 'detail': str(detail)})
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))

def wait_result(page, timeout=20000):
    page.wait_for_function("() => !document.getElementById('runBtn').disabled && document.getElementById('runBtn').textContent === '生成材料方案'", timeout=timeout)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
    page = ctx.new_page()
    page.on('console', lambda m: receipt['console_errors'].append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: receipt['page_errors'].append(str(e)))
    page.goto(PAGE.as_uri())
    wait_result(page)
    check('首屏自动载入 C1 并出结论', page.locator('.verdict .big').count() == 1, page.locator('.verdict .big').inner_text())
    heads = page.locator('main h2').all_inner_texts()
    check('结论页包含 02–12 共 11 个章节', len(heads) == 11, len(heads))
    check('雷达图至少 3 条多边形', page.locator('#radar svg polygon').count() >= 3 + 4, page.locator('#radar svg polygon').count())
    check('雷达图数据表 6 行', page.locator('#radarSide tbody tr').count() == 6)
    check('Shapley 指标页签 7 个', page.locator('#exTabs button').count() == 7)
    check('Shapley 贡献条存在', page.locator('#exBody .cbar').count() >= 3, page.locator('#exBody .cbar').count())
    page.click('#exTabs button[data-ind="tsr"]')
    check('切换 Shapley 指标页签生效', page.locator('#exTabs button[data-ind="tsr"]').get_attribute('aria-pressed') == 'true')
    check('知识图谱查询有结果行', page.locator('#gOut tbody tr').count() >= 1, page.locator('#gOut tbody tr').count())
    page.click('#gOut tbody tr >> nth=0')
    check('点击图谱行展开材料影响', page.locator('#gProfile details').count() == 1)
    page.select_option('#gInd', 'strain'); page.select_option('#gCls', 'binder')
    check('图谱按指标与类别筛选', page.locator('#gOut tbody tr').count() >= 1)
    check('独立复验行可见', '独立种子复验' in page.locator('.verdict').inner_text())
    page.screenshot(path=str(OUT / 'desktop_C1.png'), full_page=True)

    # 七案例逐一点击
    for cid in ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']:
        page.click(f'[data-case="{cid}"]'); wait_result(page)
        ok = page.locator('.verdict .big').count() == 1
        check(f'案例 {cid} 渲染结论', ok, page.locator('.verdict .big').inner_text()[:40] if ok else page.locator('#out').inner_text()[:80])
        if cid in ('C2', 'C7', 'C4'):
            page.screenshot(path=str(OUT / f'desktop_{cid}.png'), full_page=True)
    # C7 裂缝页不应出现混合料章节
    check('C7 裂缝页不含雷达/Shapley', page.locator('#radar').count() == 0)

    # 无解：零预算 / 极低气温 / 极小碳排
    page.click('[data-case="C6"]'); wait_result(page)
    page.fill('#budget', '0'); page.click('#runBtn'); wait_result(page)
    check('零预算给出无解提示', '预算内无可行方案' in page.locator('#out').inner_text(), page.locator('#out .empty').inner_text()[:60])
    page.screenshot(path=str(OUT / 'desktop_infeasible_budget.png'), full_page=False)
    page.click('[data-case="C1"]'); wait_result(page)
    page.fill('#ambientT', '-40'); page.click('#runBtn'); wait_result(page)
    check('极低施工气温给出无解提示', '无可行方案' in page.locator('#out').inner_text())
    page.click('[data-case="C1"]'); wait_result(page)
    page.fill('#carbonCap', '0.1'); page.click('#runBtn'); wait_result(page)
    txt = page.locator('#out').inner_text()
    check('极小碳排上限给出无解提示且统计碳排剔除', '碳排上限内无可行方案' in txt and '碳排上限剔除' in txt, txt[:90])
    page.fill('#carbonCap', '0.9'); page.click('#runBtn'); wait_result(page)
    check('碳排上限 0.9 仍可推荐且不超限', page.locator('.verdict .big').count() == 1)
    # 稳健选优
    page.click('[data-case="C1"]'); wait_result(page)
    page.check('#selMode'); page.click('#runBtn'); wait_result(page)
    check('稳健选优显示复算候选数', '独立噪声复算' in page.locator('.verdict').inner_text())
    # 无效输入
    page.click('[data-case="C1"]'); wait_result(page)
    page.fill('#haulMin', '-5'); page.click('#runBtn'); wait_result(page)
    check('非法运输时长显示错误提示', page.locator('[role=alert]').count() == 1, page.locator('[role=alert]').inner_text()[:50] if page.locator('[role=alert]').count() else '')
    # 反馈
    page.click('[data-case="C6"]'); wait_result(page)
    before = page.locator('.verdict .v').nth(0).inner_text()
    page.click('#fbBtn'); wait_result(page)
    check('回流反馈后状态栏出现修正', '已修正' in page.locator('#fbState').inner_text(), page.locator('#fbState').inner_text()[:60])
    page.click('#fbReset'); wait_result(page)
    check('清空反馈', '尚无回流数据' in page.locator('#fbState').inner_text())
    # 导出
    with page.expect_download() as dl:
        page.click('#exportBtn')
    d = dl.value; path = OUT / 'exported.json'; d.save_as(str(path))
    data = json.loads(path.read_text())
    check('导出 JSON 含输入与输出', 'input' in data and data['output']['recommended'], d.suggested_filename)
    path.unlink()
    # 暗色
    page.click('#themeBtn'); page.wait_for_timeout(300)
    check('暗色主题重绘雷达图', page.locator('#radar svg').count() == 1)
    page.screenshot(path=str(OUT / 'desktop_C6_dark.png'), full_page=True)
    ctx.close()

    # 移动端
    m = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    mp = m.new_page()
    mp.on('console', lambda x: receipt['console_errors'].append('[mobile] ' + x.text) if x.type == 'error' else None)
    mp.on('pageerror', lambda e: receipt['page_errors'].append('[mobile] ' + str(e)))
    mp.goto(PAGE.as_uri()); wait_result(mp)
    sw = mp.evaluate('document.documentElement.scrollWidth'); iw = mp.evaluate('window.innerWidth')
    check('移动端页面无横向溢出', sw <= iw + 1, f'scrollWidth={sw} innerWidth={iw}')
    rw = mp.evaluate("document.querySelector('#radar svg').getBoundingClientRect().width")
    check('移动端雷达图不超出视口', rw <= iw, rw)
    mp.screenshot(path=str(OUT / 'mobile_C1.png'), full_page=True)
    m.close()
    browser.close()

receipt['all_passed'] = all(c['ok'] for c in receipt['checks']) and not receipt['console_errors'] and not receipt['page_errors']
receipt['generated'] = time.strftime('%Y-%m-%d %H:%M:%S')
(OUT / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
print('console errors:', receipt['console_errors'], 'page errors:', receipt['page_errors'])
print('ALL PASSED' if receipt['all_passed'] else 'SOME FAILED')
sys.exit(0 if receipt['all_passed'] else 1)
