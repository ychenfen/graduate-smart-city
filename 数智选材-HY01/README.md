# 数智选材 HY-01课题一（v2）

v2 变更与仍未解决的问题见 `CHANGELOG_v2.md`。默认选优数值与 v1 一致，由回归测试锁定。

本项目为道路养护材料推荐概念验证。使用演示气候、材料先验和构造案例，不代表实际工程适用性已验证。

## 本地运行

需要 Node.js（本轮使用24.3.0），无第三方JavaScript依赖。

```sh
node --test tests/*.test.js     # 36 项
node tools/build.js              # 重建离线页面与 data/kb.json
node tools/case_report.js        # 七案例报告 → paper/verification_v2/
node tools/robustness.js         # 多种子稳定性与选优乐观偏差
python3 tools/ui_check.py        # 无头 Chromium 界面检查（需 playwright）
node engine/server.js 8765
```

浏览器访问 `http://localhost:8765`；也可直接打开 `prototype/index.html`。修改引擎、知识库或界面模板后，必须重新运行构建命令。

## 数据与技术交接

- `cases/cases.json`：7个构造场景；不是真实工程采样。
- `engine/kb.js`：气候、材料、级配、工法、规则与费用参数。STD标记表示按规范整理但尚待逐条现行版本核对；LIT为典型趋势先验；ENG为本作品的工程假设。不能将这些标记当作完整文献证据。
- `engine/schema.json`：输入字段描述；`engine/validate.js` 在接口层按该schema逐字段校验（类型、枚举、范围、必填，未知字段仅警告），引擎内部仍保留关键边界检查。
- `engine/graph.js`：由知识库与机理先验导出的材料—指标—规则图及查询（improvers/profile/drivers）。边权不是实测数据，不是实测知识图谱。
- `engine/engine.js`：规则剪枝、联合通过比例、Pareto及选优、独立种子复验、可选稳健选优、碳排约束、精确Shapley归因、雷达数据、反馈偏差更新。没有训练完成的通用材料AI模型；Shapley解释的是机理先验公式。
- `prototype/app.template.html`：可编辑界面；`prototype/index.html`：构建产物。
- `paper/verification_20261022/`：可复现七案例结果JSON与报告。

## API

- `GET /api/v1/health`：服务版本和知识库信息。
- `POST /api/v1/validate`：只校验场景输入，返回字段级错误与警告。
- `GET /api/v1/graph`（`?summary=1`）、`/graph/improvers?indicator=tsr&top=5`、`/graph/profile?id=rut:antirut`、`/graph/drivers?indicator=ds`：材料—性能关联查询。
- `GET /api/v1/feedback`、`POST /api/v1/feedback/reset`：查看与清空反馈状态。
- `GET /api/v1/kb`：知识库快照。
- `POST /api/v1/recommend`：请求可直接使用案例中的input对象，也可使用 `{"scenario":输入对象,"includeCloud":true}`；返回推荐或不可行结果。新增输入 `carbonCapYr`（年均碳排上限）、`selection`（`point` 默认 / `validated` 稳健选优）；新增输出 `recommended.validation`（独立复验）、`explain`（Shapley）、`radar`、`selection`。输入未通过校验返回400及 `errors`。`module: "infeasible"` 时 `recommended` 为null，不能直接访问其属性。`targetReached: false` 表示模型内未达目标。
- `POST /api/v1/feedback`：`{"observations":[{"binderFamily":"sbs","gradType":"dense","indicator":"tsr","ratio":0.88}]}`。ratio为实测/预测，fatigue例外为对数寿命差值。应提供可追溯试验记录并校验数值；当前接口仅供本地演示，无认证、持久化和生产审计。

当前服务不适合公开部署：仅绑定127.0.0.1，跨域只放行同源回环来源（可用环境变量 `SZXC_CORS_ORIGIN` 显式放行一个来源），请求体上限1 MB，无认证、持久化和审计。反馈状态重启后清空；同一服务内的推荐共享状态，比较基准时应重启或明确记录反馈状态。

## 正式材料准备

官网要求及模板见 `paper/官网提交要求_20261022.md` 与 `00_赛题/官网附件_20261022/`。`deliverables/文档/` 为 v1 冻结版；`deliverables/文档_v2/` 为 v2 更新版（说明书、技术交接、七案例报告含新内容；简表、商业计划书内容未变），均提供DOCX和渲染检查后的PDF。`deliverables/演示/` 包含10页可编辑PPTX、PDF及约134秒中文合成语音方案解说视频（不是软件录屏）。

36项引擎/API测试通过；7个构造案例可复现。离线页面已用无头Chromium在桌面与移动视口检查（`paper/verification_v2/ui/`，含截图与收据），非真机、读屏或用户测试。PPTX与解说视频沿用v1，未展示v2新能力。团队名称、作品编号、真实成员信息及匿名处理方式仍待确认，报名、资格审核和上传状态尚无回执。不能把本地交付视为已提交或工程性能已验证。

核心软件无第三方依赖。文档生成另需Python及python-docx/lxml；演示生成使用Codex artifact-tool运行时与LibreOffice，视频生成使用macOS Tingting和ffmpeg。生成入口为 `tools/build_documents.py`、`tools/build_deck.mjs`、`tools/build_video.py`，字体与许可见 `assets/fonts/`。完整归档、SHA256清单及独立解压复验回执见 `提交包/`。
