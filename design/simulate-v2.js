// simulate-v2.js —— Monte Carlo 数值模拟 v2.1-draft（规则全部来自 engine-v2.js）
// 跑法: node simulate-v2.js
// 验证目标（本轮 A 线：民心数值草案 + 10 人开局产能）：
//   1) 可赢性 —— 正统风格能不能守住第 90 天总攻（存活率 ≥70% 为 PASS）
//   2) 张力   —— 赢的人墙血剩 10%~60%
//   3) 策略分歧 —— 正统 vs 轻防御存活率差 ≥15pp
//   4) 裸墙测试 —— 零防御必死
//   5) 武器参与 —— 削骑均值 ≥85
// 本脚本只读 TUNING-v2.js（经 engine-v2 转出），不复制数字。

const { createEngine, TUNING } = require('./engine-v2.js')
const E = createEngine({ jitter: true }) // 模拟开噪声：±15% 敌骑 / ±10% 产出

const RUNS = 1000
const ORDER = ['sha', 'hui', 'huang']
const maxDigTier = (s) => ORDER[s.workshopLv - 1] // 坊等级=解锁上限（拍板）

// ———— 分配工具：比例 → 岗位；剩余人手全部挖土（digTier 指定土种，超出解锁自动降档）————
function alloc(s, parts) {
  let used = 0
  const a = { farm: 0, wood: 0, stone: 0, iron: 0, earthSha: 0, earthHui: 0, earthHuang: 0 }
  for (const k of ['farm', 'wood', 'stone', 'iron']) {
    a[k] = Math.min(Math.round(s.civ * (parts[k] || 0)), s.civ - used)
    used += a[k]
  }
  let tier = parts.digTier || 'sha'
  if (ORDER.indexOf(tier) > ORDER.indexOf(maxDigTier(s))) tier = maxDigTier(s)
  a['earth' + tier[0].toUpperCase() + tier.slice(1)] = Math.max(0, s.civ - used)
  return a
}
// 兵务（征召制完全体）：敌情前 5 天征召到满编；和平期全员退伍下田（军饷归零、劳力回笼）
function manageTroops(s, d) {
  const near = [30, 45, 60, 90].some((t) => d > t - 5 && d <= t)
  if (near) {
    const want = E.crewNeeded(s) + 1
    if (s.sol < want) E.recruit(s, want - s.sol)
  } else if (s.sol > 0) {
    E.disband(s, s.sol)
  }
}
// 征兵到目标：兵 = 驻守需求 + 预备队
function crewTo(s, reserve) {
  const want = E.crewNeeded(s) + reserve
  if (s.sol < want) E.recruit(s, want - s.sol)
}
// 修墙：优先用手里最好的土（够升档门槛或 ≥ 墙当前档才用，否则降档找）
function smartRepair(s, budget) {
  const wallIdx = ORDER.indexOf(s.wallTier)
  for (const tier of ['huang', 'hui', 'sha']) {
    const idx = ORDER.indexOf(tier)
    if (s.earth[tier] <= 0) continue
    if (idx >= wallIdx || s.earth[tier] >= TUNING.WALL.PROMOTE_MIN_EARTH) {
      E.repairWall(s, tier, budget)
      return
    }
  }
}
// 紧急杠杆（拍板）：民心 <40 时放粮拉回
function granaryLever(s) {
  if (s.morale < 40 && s.grain >= 80) E.openGranary(s)
}
const canTower = (s) => s.wood >= TUNING.TOWER.COST_WOOD && s.iron >= TUNING.TOWER.COST_IRON
const canBallista = (s) => s.wood >= TUNING.BALLISTA.COST_WOOD && s.iron >= TUNING.BALLISTA.COST_IRON

// ———— 四种纸面玩家风格（模拟的是"风格"，不是最优解）————
const strategies = {
  // A 均衡流：先升坊保命（45 天硬约束，攒齐前冻结一切开销）→ 2 塔 → 灰土升档墙 → 开田扩军备
  //          军备：2 塔(45前) → 3 塔 1 弩(60前) → 4 塔 2 弩
  均衡流(s) {
    const d = s.day
    const parts = s.workshopLv < 2
      ? { farm: 0.4, wood: 0.3, stone: 0.3, digTier: 'sha' }  // 攒升坊
      : d < 55
        ? { farm: 0.4, wood: 0.25, stone: 0.05, iron: 0.15, digTier: 'hui' }  // 转挖灰土+补铁
        : { farm: 0.25, wood: 0.2, stone: 0, iron: 0.15, digTier: 'hui' }     // 决战前夜：粮够就行，全力挖土修墙
    E.dayTick(s, alloc(s, parts))
    if (s.workshopLv < 2) { // 升坊线：别的啥都不干
      E.upgradeWorkshop(s)
      manageTroops(s, d)
      smartRepair(s)
      granaryLever(s)
      return
    }
    if (s.workshopLv < 3 && d >= 55 && s.earth.hui >= 20) E.upgradeWorkshop(s) // 后期有余力才冲坊3
    const wantT = d >= 60 ? 4 : d >= 45 ? 3 : 2
    const wantB = d >= 45 ? 2 : 1
    if (s.ballistas < wantB && canBallista(s)) E.buildBallista(s)
    else if (s.towers < wantT && canTower(s)) E.buildTower(s)
    if (s.towers >= wantT && s.ballistas >= wantB && s.fields.length < 5) E.buildField(s, s.fields.length % 2 ? 'ma' : 'su') // 军备优先，齐了才开田
    manageTroops(s, d)
    smartRepair(s)
    granaryLever(s)
  },
  // B 墙塔流：防御优先。先坊 2 保命 → 2 塔 → 攒坊 3 → 全力挖黄土冲 2400 裸扛总攻
  墙塔流(s) {
    const d = s.day
    const dig = s.workshopLv >= 3 ? 'huang' : s.workshopLv >= 2 ? 'hui' : 'sha'
    const parts = s.workshopLv < 3
      ? { farm: 0.4, wood: 0.25, stone: 0.25, digTier: dig } // 攒坊（坊2 前冻结开销）
      : { farm: 0.3, wood: 0.1, stone: 0.05, iron: 0.15, digTier: 'huang' } // 全力挖黄+补铁
    E.dayTick(s, alloc(s, parts))
    if (s.workshopLv < 2) { // 坊2 前同均衡流
      E.upgradeWorkshop(s)
      manageTroops(s, d)
      smartRepair(s)
      granaryLever(s)
      return
    }
    if (s.workshopLv < 3 && s.towers >= 2) E.upgradeWorkshop(s)
    const wantT = d >= 45 ? 3 : 2
    const wantB = d >= 45 ? 2 : 1
    if (s.ballistas < wantB && canBallista(s)) E.buildBallista(s)
    else if (s.towers < wantT && canTower(s)) E.buildTower(s)
    if (s.towers >= wantT && s.ballistas >= wantB && s.fields.length < 4) E.buildField(s, 'su')
    manageTroops(s, d)
    smartRepair(s)
    granaryLever(s)
  },
  // C 经济流（对照组）：重生产轻防御——只建 2 塔且卡最低驻守
  经济流(s) {
    const d = s.day
    E.dayTick(s, alloc(s, { farm: 0.5, wood: 0.2, stone: 0.1, iron: 0.15, digTier: 'sha' }))
    if (s.fields.length < 6) E.buildField(s, s.fields.length % 2 ? 'ma' : 'su')
    if (s.towers < 2 && canTower(s)) E.buildTower(s)
    manageTroops(s, d)
    smartRepair(s)
    granaryLever(s)
  },
  // D 裸墙流（必死对照）：纯种田，只修砂土墙，不升坊不军备
  裸墙流(s) {
    E.dayTick(s, alloc(s, { farm: 0.6, wood: 0.2, stone: 0.1, iron: 0.05, digTier: 'sha' }))
    if (s.fields.length < 6) E.buildField(s, s.fields.length % 2 ? 'ma' : 'su')
    smartRepair(s)
    granaryLever(s)
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
  let survive = 0, clean = 0, wallSum = 0, grainSum = 0, popSum = 0, moraleSum = 0
  let trimSum = 0, starveSum = 0, breachSum = 0, solLostSum = 0, granarySum = 0, owedSum = 0
  for (let i = 0; i < RUNS; i++) {
    const { result, s } = run(name)
    if (result !== 'lose') {
      survive++
      if (!s.breached && s.day >= TUNING.TIME.DAYS) clean++ // 总攻零骑摸墙 = 完守
      wallSum += s.wallHP / E.wallCap(s)
      grainSum += s.grain
      popSum += E.pop(s)
      moraleSum += s.morale
    }
    trimSum += s.trimsTotal
    starveSum += s.starveDays
    breachSum += s.breaches
    solLostSum += s.solLost
    granarySum += s.granaries
    owedSum += s.owedDays
  }
  report[name] = {
    survival: (survive / RUNS) * 100,
    cleanPct: (clean / RUNS) * 100,
    avgWallLeft: survive ? (wallSum / survive) * 100 : 0,
    avgGrain: survive ? grainSum / survive : 0,
    avgPop: survive ? popSum / survive : 0,
    avgMorale: survive ? moraleSum / survive : 0,
    avgTrims: trimSum / RUNS,
    avgStarve: starveSum / RUNS,
    avgBreaches: breachSum / RUNS,
    avgSolLost: solLostSum / RUNS,
    avgGranaries: granarySum / RUNS,
    avgOwed: owedSum / RUNS,
  }
}

console.log(`=== 长城守城 v${TUNING.VERSION} · Monte Carlo ×${RUNS}（engine ${E.jitter ? 'jitter on' : 'jitter off'}）===`)
console.log('风格\t存活%\t完守%\t墙血%\t期末粮\t期末人口\t期末民心\t削骑均值\t破防次\t断粮天\t欠饷天\t放粮次\t损兵')
for (const [name, r] of Object.entries(report)) {
  console.log(
    `${name}\t${r.survival.toFixed(1)}\t${r.cleanPct.toFixed(1)}\t${r.avgWallLeft.toFixed(0)}\t${Math.round(r.avgGrain)}\t${Math.round(r.avgPop)}\t${r.avgMorale.toFixed(0)}\t${r.avgTrims.toFixed(0)}\t\t${r.avgBreaches.toFixed(2)}\t${r.avgStarve.toFixed(1)}\t${r.avgOwed.toFixed(1)}\t${r.avgGranaries.toFixed(2)}\t${r.avgSolLost.toFixed(0)}`
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
  `张力    : ${w >= 10 && w <= 60 ? 'PASS' : 'FAIL'}（最好风格存活者平均墙血 ${w.toFixed(0)}%，目标 10%~60%）`
)
const eco = report['经济流']
const spread = best[1].survival - eco.survival
console.log(
  `策略分歧: ${spread >= 15 ? 'PASS' : 'FAIL'}（最好正统 ${best[1].survival.toFixed(0)}% vs 轻防御经济流 ${eco.survival.toFixed(1)}%，差 ${spread.toFixed(0)}pp，目标 ≥15pp）`
)
console.log(
  `裸墙测试: ${report['裸墙流'].survival === 0 ? 'PASS' : 'FAIL'}（零防御存活率 ${report['裸墙流'].survival.toFixed(1)}%，必须为 0）`
)
console.log(
  `武器参与: ${best[1].avgTrims >= 85 ? 'PASS' : 'FAIL'}（最好风格全程平均削骑 ${Math.round(best[1].avgTrims)}，参考线 ≥85）`
)

// ———— 风格叙事对照 ————
console.log(`\n—— 正统风格赢法对照 ——`)
for (const [n, r] of entries) {
  console.log(
    `${n}：墙血 ${r.avgWallLeft.toFixed(0)}%　粮 ${Math.round(r.avgGrain)} 斛　人口 ${Math.round(r.avgPop)}　民心 ${r.avgMorale.toFixed(0)}　断粮 ${r.avgStarve.toFixed(1)} 天`
  )
}
console.log(`\n—— 经济流判读（轻防御对照）——`)
console.log(
  `存活率 ${eco.survival.toFixed(1)}%，平均破防 ${eco.avgBreaches.toFixed(1)} 次。${
    eco.survival < best[1].survival - 20 ? 'PASS——省钱不设防被明显惩罚' : 'WARN——轻防御代价不明显，敌情或削量需要加压'
  }`
)
