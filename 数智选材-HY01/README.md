# 数智选材 HY-01课题一

本项目为道路养护材料推荐概念验证。使用演示气候、材料先验和构造案例，不代表实际工程适用性已验证。

## 本地运行

需要 Node.js（本轮使用24.3.0），无第三方JavaScript依赖。

```sh
node --test tests/*.test.js
node tools/build.js
node tools/case_report.js
node engine/server.js 8765
```

浏览器访问 `http://localhost:8765`；也可直接打开 `prototype/index.html`。修改引擎、知识库或界面模板后，必须重新运行构建命令。

## 数据与技术交接

- `cases/cases.json`：7个构造场景；不是真实工程采样。
- `engine/kb.js`：气候、材料、级配、工法、规则与费用参数。STD标记表示按规范整理但尚待逐条现行版本核对；LIT为典型趋势先验；ENG为本作品的工程假设。不能将这些标记当作完整文献证据。
- `engine/schema.json`：输入字段描述；运行时未全面执行该schema，外部系统应自行验证字段。当前引擎只对部分输入做边界校验。
- `engine/engine.js`：规则剪枝、联合通过比例、Pareto及选优、解释、反馈偏差更新。没有训练完成的通用材料AI模型。
- `prototype/app.template.html`：可编辑界面；`prototype/index.html`：构建产物。
- `paper/verification_20261022/`：可复现七案例结果JSON与报告。

## API

- `GET /api/v1/health`：服务版本和知识库信息。
- `GET /api/v1/kb`：知识库快照。
- `POST /api/v1/recommend`：请求可直接使用案例中的input对象，也可使用 `{"scenario":输入对象,"includeCloud":true}`；返回推荐或不可行结果。`module: "infeasible"` 时 `recommended` 为null，不能直接访问其属性。`targetReached: false` 表示模型内未达目标。
- `POST /api/v1/feedback`：`{"observations":[{"binderFamily":"sbs","gradType":"dense","indicator":"tsr","ratio":0.88}]}`。ratio为实测/预测，fatigue例外为对数寿命差值。应提供可追溯试验记录并校验数值；当前接口仅供本地演示，无认证、持久化和生产审计。

当前服务不适合公开部署。反馈状态重启后清空；同一服务内的推荐共享状态，比较基准时应重启或明确记录反馈状态。

## 正式材料准备

官网要求及模板见 `paper/官网提交要求_20261022.md` 与 `00_赛题/官网附件_20261022/`。`deliverables/文档/` 已包含官方模板回填的简表、说明书、商业计划书及技术交接、七案例报告，均提供DOCX和渲染检查后的PDF。`deliverables/演示/` 包含10页可编辑PPTX、PDF及约134秒中文合成语音方案解说视频（不是软件录屏）。

24项引擎/API测试通过；7个构造案例可复现。浏览器实际交互和移动端尚未验收。团队名称、作品编号、真实成员信息及匿名处理方式仍待确认，报名、资格审核和上传状态尚无回执。不能把本地交付视为已提交或工程性能已验证。

核心软件无第三方依赖。文档生成另需Python及python-docx/lxml；演示生成使用Codex artifact-tool运行时与LibreOffice，视频生成使用macOS Tingting和ffmpeg。生成入口为 `tools/build_documents.py`、`tools/build_deck.mjs`、`tools/build_video.py`，字体与许可见 `assets/fonts/`。完整归档、SHA256清单及独立解压复验回执见 `提交包/`。
