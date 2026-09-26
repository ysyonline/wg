// simulate-v2.js —— Monte Carlo 数值模拟 v2.0-alpha（规则全部来自 engine-v2.js）
// 跑法: node simulate-v2.js
// 回答三个问题（见《数值提案-战斗与城防-v2.md》第六节）：
//   1) 可赢性 —— 玩得好的风格能不能守住第 90 天总攻（存活率 ≥70% 为 PASS）
//   2) 张力   —— 赢的人墙血剩 10%~60%（全 100% = 没张力；全贴 0 = 运气游戏）
//   3) 策略分歧 —— 风格间存活率差 ≥15pp（"什么时候从种田转向备战"必须是真选择）
// 本脚本只读 TUNING-v2.js（经 engine-v2 转出），不复制数字。

const { createEngine, TUNING } = require('./engine-v2.js')
const E = createEngine({ jitter: true }) // 模拟开噪声：±15% 敌骑 / ±10% 产出

const RUNS = 1000

// ———— 分配工具：把剩余平民全塞进某个岗位 ————
function alloc(s, parts) {
  // parts: {farm, wood, stone, iron, earth} 期望比例（0~1）
  let used = 0
  const a = {}
  for (const k of Object.keys(parts)) {
    a[k] = Math.min(Math.round(s.civ * parts[k]), s.civ - used)
    used += a[k]
  }
  a.earth = Math.max(0, s.civ - used) // 剩余人手全部挖土（土是修墙/升墙硬通货，闲着也是闲着）
  return a
}
// 征兵到目标：兵 = 驻守需求 + 预备队
function crewTo(s, reserve) {
  const want = E.crewNeeded(s) + reserve
  if (s.sol < want) E.recruit(s, want - s.sol)
}

// ———— 四种纸面玩家风格（模拟的是"风格"，不是最优解）————
const strategies = {
  // A 均衡流：前 25 天种田开田，之后逐步军备；墙走灰土线，武器 4 塔 2 弩
  均衡流(s) {
    const d = s.day
    E.dayTick(s, alloc(s, { farm: 0.45, wood: 0.25, stone: 0.1, iron: 0.05 }))
    if (d <= 25 && s.fields.length < 4) E.buildField(s, s.fields.length % 2 ? 'ma' : 'su')
    // 军备序列：2 塔 → 1 弩 → (45 天起) 3 塔 2 弩 → (60 天起) 4 塔 2 弩
    const wantT = d >= 60 ? 4 : d >= 45 ? 3 : 2
    const wantB = d >= 45 ? 2 : 1
    if (s.towers < wantT && s.wood >= TUNING.TOWER.COST_WOOD && s.iron >= TUNING.TOWER.COST_IRON) E.buildTower(s)
    else if (s.ballistas < wantB && s.wood >= TUNING.BALLISTA.COST_WOOD && s.iron >= TUNING.BALLISTA.COST_IRON) E.buildBallista(s)
    crewTo(s, 2)
    E.repair(s) // 有多少土修多少（留土升墙）
    if (d >= 55 && s.wallTier === 'hui' && s.earth >= 130 && s.stone >= 90) E.upgradeWall(s)
    E.buySettlers(s, 120)
  },
  // B 墙塔流：防御优先。武器分期到 5 塔 2 弩（当量 100），40 天起全力升黄土墙
  墙塔流(s) {
    const d = s.day
    E.dayTick(s, alloc(s, { farm: 0.45, wood: 0.3, stone: 0.12, iron: 0.08 }))
    if (s.fields.length < 5 && d <= 30) E.buildField(s, s.fields.length % 2 ? 'ma' : 'su')
    // 分期军备：45 天前 2 塔 1 弩 → 60 天前 4 塔 2 弩 → 终盘 5 塔 2 弩
    const wantT = d >= 60 ? 5 : d >= 45 ? 4 : 2
    const wantB = d >= 45 ? 2 : 1
    if (s.ballistas < wantB && s.wood >= TUNING.BALLISTA.COST_WOOD && s.iron >= TUNING.BALLISTA.COST_IRON) E.buildBallista(s)
    else if (s.towers < wantT && s.wood >= TUNING.TOWER.COST_WOOD && s.iron >= TUNING.TOWER.COST_IRON) E.buildTower(s)
    crewTo(s, 3)
    E.repair(s)
    if (d >= 40 && s.wallTier !== 'huang' && s.earth >= 130 && s.stone >= 90) E.upgradeWall(s)
    E.buySettlers(s, 100)
  },
  // C 经济流（对照组）：重生产轻防御——只建 2 塔且几乎不征兵（武器半瞎）
  经济流(s) {
    const d = s.day
    E.dayTick(s, alloc(s, { farm: 0.6, wood: 0.2, stone: 0.05, iron: 0.05 }))
    if (s.fields.length < 6 && E.buildField(s, s.fields.length % 2 ? 'ma' : 'su')) {}
    if (s.towers < 2 && s.wood >= TUNING.TOWER.COST_WOOD && s.iron >= TUNING.TOWER.COST_IRON) E.buildTower(s)
    crewTo(s, 0) // 卡着最低驻守数征兵
    E.repair(s)
    E.buySettlers(s, 60)
  },
  // D 裸墙流（必死对照）：纯种田零防御——验证"不设防=必死"
  裸墙流(s) {
    E.dayTick(s, alloc(s, { farm: 0.7, wood: 0.2, stone: 0.05, iron: 0.05 }))
    if (s.fields.length < 6 && E.buildField(s, s.fields.length % 2 ? 'ma' : 'su')) {}
    E.buySettlers(s, 150)
    E.repair(s)
  },
}

// ———— 单局 ————
function run(name) {
  const s = E.newState()
  for (let d = 1; d <= TUNING.TIME.DAYS; d++) {
    strategies[name](s)
    const r = E.battle(s, d)
    if (r === 'lose') return { result: 'lose', s }
    if (s.civ <= 0) return { result: 'lose', s } // 人跑光了也输
  }
  return { result: 'survive', s }
}

// ———— Monte Carlo ————
const report = {}
for (const name of Object.keys(strategies)) {
  let survive = 0, clean = 0, wallSum = 0, grainSum = 0, popSum = 0
  let trimSum = 0, starveSum = 0, breachSum = 0, solLostSum = 0
  for (let i = 0; i < RUNS; i++) {
    const { result, s } = run(name)
    if (result !== 'lose') {
      survive++
      if (!s.breached && s.day >= TUNING.TIME.DAYS) clean++ // 总攻零骑摸墙 = 完守
      wallSum += s.wallHP / E.wallCap(s)
      grainSum += s.grain
      popSum += E.pop(s)
    }
    trimSum += s.trimsTotal
    starveSum += s.starveDays
    breachSum += s.breaches
    solLostSum += s.solLost
  }
  report[name] = {
    survival: (survive / RUNS) * 100,
    cleanPct: (clean / RUNS) * 100,
    avgWallLeft: survive ? (wallSum / survive) * 100 : 0,
    avgGrain: survive ? grainSum / survive : 0,
    avgPop: survive ? popSum / survive : 0,
    avgTrims: trimSum / RUNS,
    avgStarve: starveSum / RUNS,
    avgBreaches: breachSum / RUNS,
    avgSolLost: solLostSum / RUNS,
  }
}

console.log(`=== 长城守城 v${TUNING.VERSION} · Monte Carlo ×${RUNS}（engine ${E.jitter ? 'jitter on' : 'jitter off'}）===`)
console.log('风格\t存活%\t完守%\t存活者墙血%\t期末粮\t期末人口\t削骑均值\t破防次\t断粮天\t损兵')
for (const [name, r] of Object.entries(report)) {
  console.log(
    `${name}\t${r.survival.toFixed(1)}\t${r.cleanPct.toFixed(1)}\t${r.avgWallLeft.toFixed(0)}\t\t${Math.round(r.avgGrain)}\t\t${Math.round(r.avgPop)}\t\t${r.avgTrims.toFixed(0)}\t\t${r.avgBreaches.toFixed(2)}\t${r.avgStarve.toFixed(1)}\t${r.avgSolLost.toFixed(0)}`
  )
}

// ———— 五指标判读（经济流/裸墙流是对照组，不参与风格排名）————
const entries = Object.entries(report).filter(([n]) => n !== '经济流' && n !== '裸墙流')
const best = entries.reduce((a, b) => (b[1].survival > a[1].survival ? b : a))
const worst = entries.reduce((a, b) => (b[1].survival < a[1].survival ? b : a))

console.log('\n—— 五指标判读 ——')
console.log(
  `可赢性  : ${best[1].survival >= 70 ? 'PASS' : 'FAIL'}（最好风格「${best[0]}」存活率 ${best[1].survival.toFixed(1)}%，目标 ≥70%；最弱正统「${worst[0]}」${worst[1].survival.toFixed(1)}%）`
)
const w = best[1].avgWallLeft
console.log(
  `张力    : ${w >= 10 && w <= 60 ? 'PASS' : 'FAIL'}（最好风格存活者平均墙血 ${w.toFixed(0)}%，目标 10%~60%——${w > 60 ? '赢得太轻松' : w < 10 ? '赢在运气不在经营' : '贴脸赢，张力合适'}）`
)
// 分歧口径：防御投资的价值差 = 最好正统 vs 轻防御经济流（正统之间比存活率无意义——两种正统赢法都该活）
const eco = report['经济流']
const spread = best[1].survival - eco.survival
console.log(
  `策略分歧: ${spread >= 15 ? 'PASS' : 'FAIL'}（最好正统 ${best[1].survival.toFixed(0)}% vs 轻防御经济流 ${eco.survival.toFixed(1)}%，差 ${spread.toFixed(0)}pp，目标 ≥15pp）`
)
console.log(
  `裸墙测试: ${report['裸墙流'].survival === 0 ? 'PASS' : 'FAIL'}（零防御存活率 ${report['裸墙流'].survival.toFixed(1)}%，必须为 0）`
)
console.log(
  `武器参与: ${best[1].avgTrims >= 85 ? 'PASS' : 'FAIL'}（最好风格全程平均削骑 ${Math.round(best[1].avgTrims)}。参考线：三波满削 50 + 总攻削到灰土存活线约 90 → ≥85 说明武器系统真在干活）`
)

// ———— 风格叙事对照（正统两种赢法的差异）————
console.log(`\n—— 正统风格赢法对照 ——`)
for (const [n, r] of entries) {
  console.log(
    `${n}：墙血 ${r.avgWallLeft.toFixed(0)}%　粮 ${Math.round(r.avgGrain)} 斛　人口 ${Math.round(r.avgPop)}　断粮 ${r.avgStarve.toFixed(1)} 天`
  )
}

// ———— 经济流专项：轻防御到底死不死 ————
console.log(`\n—— 经济流判读（轻防御对照）——`)
console.log(
  `存活率 ${eco.survival.toFixed(1)}%，平均破防 ${eco.avgBreaches.toFixed(1)} 次。${
    eco.survival < best[1].survival - 20 ? 'PASS——省钱不设防被明显惩罚' : 'WARN——轻防御代价不明显，敌情或削量需要加压'
  }`
)
