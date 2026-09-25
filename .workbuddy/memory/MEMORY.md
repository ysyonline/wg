# wg · 项目长期记忆（长城守城 · 设计 + 仿真）

## 项目形态
- **设计 + 数值仿真项目**，不是前端游戏成品：`design/` 是主战场，`demo/` 是可玩骨架
- **无 package.json / 无测试框架 / 无门控脚本**——禁止套用别的项目（如 PvZlite）的 run-gates、code-map、harness 流程
- 核心文件：`design/engine.js`（机制）、`TUNING.js`（数值）、`simulate.js`（Monte Carlo）、`DECISIONS.md`（决策记录 v1.x）、`probe-*.js`（单点探针）、`demo/index.html` + `demo/smoke.js`

## 铁律（从本仓库真实结构推导）
- **设计先落 `DECISIONS.md`**（版本号 + 验证结论表），再动 engine / TUNING
- 机制改动必须过 `simulate.js` 的 Monte Carlo（×1000，五指标：存活% / 城破% / 总攻财富 / 期末民心 / 起义%），结论写回 DECISIONS.md 的验证表
- **改 `TUNING.js` 必须同步 DECISIONS.md 的曲线表**——脚本改了文档没跟 = 下次基于旧曲线误判
- 单点假设用 `probe-*.js` 验证，输出 json 留证
- 可玩性验证走 `demo/index.html` + `demo/smoke.js`
- 平衡结论必须给**五指标判定**，不靠主观手感（v0.9 的"压榨流"就是靠这条定性的）

## 会话生命周期（2026-09-25 定）
- **开窗口**：工作区选 `D:\code\wg`（通用时间戳工作区读不到本项目记忆与 checkpoint）
- **开局三件事**：读本文件 → 读 `checkpoints/` 最新文件 → `git status`，再动手
- **进行中**：0.5~1.5h 一任务单元、一刀一提交；每 10~15 次工具调用更新 checkpoint
- **归档** = commit + push；origin=**SSH**，裸 `git push`；**网络不通 → 立即停下确认加速器（bludcloud 127.0.0.1:7892），不检测网络、不换端口**
- **收尾**：任务完结后把 checkpoint 有价值部分并入日志/本文件，然后删除 checkpoint

## 当前状态
- **v0.9-paper 已推送（`19cdd7b`）**：人口效率权重 POP_EFF 曲线（30 人 0.9 / 45 人 1.0 / 每超 1 人 +0.04 / 封顶 2.5）接线 engine + 压榨流探针入 simulate；Monte Carlo ×1000 五指标 PASS，压榨流存活 0%（均徒流 82.6%）
- **v0.9 遗留待决**：压榨流"死得对但死法不对"——死因是城破不是饿死。候选杠杆 = `WELL_FED_SURPLUS` 人/块 10 粮提到 12-15，或 STARVE_HIT 叠加"逃亡"效果；**不动权重曲线本身**
- **下一入口**：demo 验证真人是否会在 45-60 人时主动停手（仿真脚本回答不了这个）
