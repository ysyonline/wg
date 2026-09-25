// simulate.js —— Monte Carlo 数值模拟 v0.9（规则全部来自 engine.js）
// 跑法: node simulate.js
// 回答三个问题：
//   1) 可赢性 —— 玩得好的风格能不能守住第60天总攻（存活率≥70% 为 PASS）
//   2) 松弛度 —— 赢的人赢得多勉强（总攻时防御富余量，太高=没张力）
//   3) 策略分歧 —— 三种风格的存活率差距（≥15pp 才说明数值做出了“选择感”）
// 本脚本只读 TUNING.js（经 engine 转出），不复制数字——两边数字分叉，模拟就白跑。
//
// [v0.7.1] 规则下沉到 engine.js：demo 与模拟跑同一份结算，杜绝两份 produce/enemyPhase 分叉。
// 本文件只留下：风格脚本 + Monte Carlo + 判读。

const { createEngine, TUNING } = require('./engine.js')
const E = createEngine({ jitter: true }) // 模拟开噪声：±15% 敌情 / ±10% 产出

const RUNS = 1000

// ———— 三种纸面玩家风格（模拟的是“风格”，不是最优解）————
// [校准v0.1] 一回合=10天，允许每回合最多3项建造（v0.1首轮单建造导致全员裸防，已修正）
const strategies = {
  // A 均衡流：一半人种田，田够用就转军备，什么都想要但都不极致
  均衡流(s, t) {
    E.produce(s, {
      farm: Math.round(s.pop * 0.5),
      wood: Math.round(s.pop * 0.3),
      stone: Math.round(s.pop * 0.15),
      iron: Math.round(s.pop * 0.05),
    })
    if (s.fields.length < 4 && t <= 3)
      while (s.fields.length < 4 && E.tryBuild(s, { wood: TUNING.FIELD.COST_WOOD })) s.fields.push('su')
    let builds = 3
    while (builds-- > 0) {
      // [v0.6] 均衡流第1优先建油坊：什么都想要的风格不会放过新玩具
      if (!s.press && E.tryBuild(s, { wood: TUNING.OIL.PRESS_COST_WOOD, stone: TUNING.OIL.PRESS_COST_STONE })) s.press = true
      else if (s.towers < 5 && E.tryBuild(s, { wood: TUNING.TOWER.COST_WOOD, iron: TUNING.TOWER.COST_IRON })) s.towers++
      else if (s.ballistas < 2 && E.tryBuild(s, { wood: TUNING.BALLISTA.COST_WOOD, iron: TUNING.BALLISTA.COST_IRON })) s.ballistas++
      else break
    }
    s.fire = s.press && s.oil >= TUNING.OIL.FIRE_COST
    E.openGranary(s, 45, 200) // [v0.7] 均衡流民意低于45就放粮，保底200粮不饿死人
    E.buySettlers(s, 200)
    E.repair(s)
  },
  // B 农业流：前3回合疯狂开田攒粮换人口，后2回合才暴起造防
  农业流(s, t) {
    if (t <= 3) {
      E.produce(s, { farm: Math.round(s.pop * 0.7), wood: Math.round(s.pop * 0.25), stone: 0, iron: 0 })
      while (s.fields.length < 6 && E.tryBuild(s, { wood: TUNING.FIELD.COST_WOOD }))
        s.fields.push(s.fields.length % 2 === 0 ? 'ma' : 'su') // 混种，保证一点铁来源
      // [v0.6] 农业流第2回合起补油坊：田优先，油坊是护田保险
      if (t >= 2 && !s.press && E.tryBuild(s, { wood: TUNING.OIL.PRESS_COST_WOOD, stone: TUNING.OIL.PRESS_COST_STONE })) s.press = true
    } else {
      E.produce(s, {
        farm: Math.round(s.pop * 0.4),
        wood: Math.round(s.pop * 0.4),
        stone: Math.round(s.pop * 0.1),
        iron: Math.round(s.pop * 0.1),
      })
      let builds = 3
      while (builds-- > 0) {
        if (!s.press && E.tryBuild(s, { wood: TUNING.OIL.PRESS_COST_WOOD, stone: TUNING.OIL.PRESS_COST_STONE })) s.press = true
        else if (s.towers < 6 && E.tryBuild(s, { wood: TUNING.TOWER.COST_WOOD, iron: TUNING.TOWER.COST_IRON })) s.towers++
        else if (s.ballistas < 3 && E.tryBuild(s, { wood: TUNING.BALLISTA.COST_WOOD, iron: TUNING.BALLISTA.COST_IRON })) s.ballistas++
        else break
      }
    }
    s.fire = s.press && s.oil >= TUNING.OIL.FIRE_COST
    E.openGranary(s, 45, 150) // [v0.7] 农业流粮多，放粮阈值同均衡流
    E.buySettlers(s, 150)
    E.repair(s)
  },
  // C 军备流：田只保底不扩张，木头全变箭塔
  军备流(s, t) {
    E.produce(s, {
      farm: Math.min(Math.round(s.pop * 0.4), s.fields.length * TUNING.FIELD.WORK_CAP),
      wood: Math.round(s.pop * 0.4),
      stone: Math.round(s.pop * 0.1),
      iron: Math.round(s.pop * 0.1),
    })
    let builds = 3
    while (builds-- > 0) {
      if (s.towers < 8 && E.tryBuild(s, { wood: TUNING.TOWER.COST_WOOD, iron: TUNING.TOWER.COST_IRON })) s.towers++
      else if (s.ballistas < 3 && E.tryBuild(s, { wood: TUNING.BALLISTA.COST_WOOD, iron: TUNING.BALLISTA.COST_IRON })) s.ballistas++
      else if (s.fields.length < 3 && E.tryBuild(s, { wood: TUNING.FIELD.COST_WOOD })) s.fields.push('su')
      else break
    }
    E.buySettlers(s, 100) // [校准v0.4] 军备流也招人：真玩家有粮盈余就会扩人口，不招是脚本失真
    E.openGranary(s, 30, 100) // [v0.7] 军备流攒粮抠门，只在治安线前紧急放粮——预期它会体验阶段一
    s.fire = false // [v0.6] 军备流不建油坊（木头全变塔的纯粹主义）——作为"无油"对照组保留风格分歧
    E.repair(s)
  },
  // D 裸墙对照组：纯种田零防御——验证“不设防=必死”，不参与风格排名
  裸墙(s, t) {
    E.produce(s, {
      farm: Math.min(Math.round(s.pop * 0.7), s.fields.length * TUNING.FIELD.WORK_CAP),
      wood: Math.round(s.pop * 0.2),
      stone: Math.round(s.pop * 0.05),
      iron: 0,
    })
    while (s.fields.length < 6 && E.tryBuild(s, { wood: TUNING.FIELD.COST_WOOD }))
      s.fields.push(s.fields.length % 2 === 0 ? 'ma' : 'su')
    E.buySettlers(s, 150)
    E.repair(s)
  },
  // E 压榨流 [v0.9 探针]：真人贪心打法——有粮就招人，一点余粮不留（keepGrain=0）。
  // 验证目标：人口效率权重下，"无脑招人"是否还能滚雪球；断粮→民意链条是否咬人。
  // 判读：存活率应显著低于均衡流（否则权重无效）；断粮回合>0 且起义>0（否则民意无牙）。
  压榨流(s, t) {
    E.produce(s, {
      farm: Math.min(Math.round(s.pop * 0.6), s.fields.length * TUNING.FIELD.WORK_CAP),
      wood: Math.round(s.pop * 0.25),
      stone: Math.round(s.pop * 0.1),
      iron: Math.round(s.pop * 0.05),
    })
    while (s.fields.length < 6 && E.tryBuild(s, { wood: TUNING.FIELD.COST_WOOD }))
      s.fields.push(s.fields.length % 2 === 0 ? 'ma' : 'su')
    let builds = 2
    while (builds-- > 0) {
      if (!s.press && E.tryBuild(s, { wood: TUNING.OIL.PRESS_COST_WOOD, stone: TUNING.OIL.PRESS_COST_STONE })) s.press = true
      else if (s.towers < 4 && E.tryBuild(s, { wood: TUNING.TOWER.COST_WOOD, iron: TUNING.TOWER.COST_IRON })) s.towers++
      else break
    }
    s.fire = s.press && s.oil >= TUNING.OIL.FIRE_COST
    E.buySettlers(s, 0) // 贪心核心：粮全变人，不留口粮缓冲
    E.openGranary(s, 40, 0) // 民意告急才放粮，且不留保底——压榨到底
    E.repair(s)
  },
}

// ———— 单局 ————
function run(name) {
  const s = E.newState()
  for (let t = 1; t <= TUNING.TOTAL_TURNS; t++) {
    strategies[name](s, t)
    const r = E.enemyPhase(s, t)
    if (t === TUNING.ASSAULT.TURN) return { result: r, s }
    // [v0.7] 民意结算排在敌情后：事件（断粮/破防/烧田）当回合就兑现成民意变动
    const m = E.moralePhase(s)
    if (m) return { result: m, s }
    if (s.wallHP <= 0) return { result: 'lose', s } // 袭扰把墙磨塌也算输
  }
  return { result: 'lose', s }
}

// ———— Monte Carlo ————
const report = {}
for (const name of Object.keys(strategies)) {
  let clean = 0, barely = 0, lose = 0, marginSum = 0, wallSum = 0, presses = 0, fires = 0
  let moraleSum = 0, granaries = 0, uprisings = 0, starved = 0, popSum = 0, weightSum = 0
  for (let i = 0; i < RUNS; i++) {
    const { result, s } = run(name)
    if (result === 'clean') clean++
    else if (result === 'barely') barely++
    else lose++
    marginSum += s.margin
    if (result !== 'lose') wallSum += Math.max(0, s.wallHP)
    if (s.press) presses++
    fires += s.fires
    moraleSum += s.morale
    granaries += s.granaries
    uprisings += s.uprisings
    starved += s.starvedTurns
    popSum += s.pop
    weightSum += E.popWeight(s.pop)
  }
  const survival = ((clean + barely) / RUNS) * 100
  report[name] = {
    survival,
    cleanPct: (clean / RUNS) * 100,
    barelyPct: (barely / RUNS) * 100,
    losePct: (lose / RUNS) * 100,
    avgMargin: marginSum / RUNS,
    avgWallLeft: wallSum / Math.max(1, clean + barely),
    pressPct: (presses / RUNS) * 100,
    avgFires: fires / RUNS,
    avgMorale: moraleSum / RUNS,
    avgGranaries: granaries / RUNS,
    uprisingPct: (uprisings / RUNS) * 100,
    avgStarvedTurns: starved / RUNS,
    avgPop: popSum / RUNS,
    avgWeight: weightSum / RUNS,
  }
}

console.log(`=== 长城守城 v${TUNING.VERSION} · Monte Carlo ×${RUNS}（engine ${E.jitter ? 'jitter on' : 'jitter off'}）===`)
console.log('风格\t存活%\t正面扛住%\t惨胜%\t城破%\t总攻防御富余\t存活者平均剩余墙耐久\t油坊%\t火攻均值\t期末民意\t放粮次\t起义%\t断粮回合\t期末人口\t效率权重')
for (const [name, r] of Object.entries(report)) {
  console.log(
    `${name}\t${r.survival.toFixed(1)}\t${r.cleanPct.toFixed(1)}\t\t${r.barelyPct.toFixed(1)}\t${r.losePct.toFixed(1)}\t${Math.round(r.avgMargin)}\t\t${Math.round(r.avgWallLeft)}\t\t${r.pressPct.toFixed(0)}\t${r.avgFires.toFixed(2)}\t\t${r.avgMorale.toFixed(0)}\t\t${r.avgGranaries.toFixed(2)}\t${r.uprisingPct.toFixed(1)}\t${r.avgStarvedTurns.toFixed(2)}\t${Math.round(r.avgPop)}\t\t${r.avgWeight.toFixed(2)}`
  )
}

// ———— 三指标判读（裸墙/压榨流是对照组，不参与风格排名）————
const entries = Object.entries(report).filter(([n]) => n !== '裸墙' && n !== '压榨流')
const best = entries.reduce((a, b) => (b[1].survival > a[1].survival ? b : a))
const worst = entries.reduce((a, b) => (b[1].survival < a[1].survival ? b : a))
const spread = best[1].survival - worst[1].survival
const naked = report['裸墙']

const managed = entries
const worstUprising = managed.reduce((a, b) => (b[1].uprisingPct > a[1].uprisingPct ? b : a))
const anyUprising = managed.some(([, r]) => r.uprisingPct > 0)

console.log('\n—— 五指标判读 ——')
console.log(
  `可赢性  : ${best[1].survival >= 70 ? 'PASS' : 'FAIL'}（最好风格「${best[0]}」存活率 ${best[1].survival.toFixed(1)}%，目标 ≥70%）`
)
console.log(
  `松弛度  : 最好风格总攻平均富余 ${Math.round(best[1].avgMargin)} 点防御。${
    best[1].avgMargin > 500 ? '太高——玩家会睡着，建议加压敌情' : best[1].avgMargin > 0 ? '偏松，可接受' : '贴脸赢，张力合适'
  }`
)
console.log(
  `策略分歧: ${spread.toFixed(1)}pp（${best[0]} ${best[1].survival.toFixed(0)}% vs ${worst[0]} ${worst[1].survival.toFixed(0)}%）。${
    spread >= 15 ? 'PASS——数值做出了风格差异' : 'FAIL——三种玩法没区别，调 TUNING'
  }`
)
console.log(
  `裸墙测试: ${naked.survival === 0 ? 'PASS' : 'FAIL'}（零防御存活率 ${naked.survival.toFixed(1)}%，必须为 0——否则防御投资无意义）`
)
console.log(
  `民意压力: ${worstUprising[1].uprisingPct <= 10 ? 'PASS' : 'FAIL'}（正常经营的风格里最高起义率 ${worstUprising[0]} ${worstUprising[1].uprisingPct.toFixed(1)}%，目标 ≤10%——民意要咬人但不能咬死正常人）`
)
if (!anyUprising)
  console.log('  ⚠ 正常经营全风格零起义：脚本太乖，民意可能对模拟无感——demo 里重点观察真人会不会踩进阶段二')
if (naked.uprisingPct >= 50)
  console.log(`  ✓ 民变先于外敌杀死摆烂者：裸墙起义率 ${naked.uprisingPct.toFixed(0)}%——不经营内政的死法比城破更早`)

// ———— 压榨流专项判读 [v0.9] ————
// 它是"无脑招人"打法的数学化身，验证两件事：①人口效率权重咬不咬人 ②断粮→民意链条有没有牙
const sq = report['压榨流']
console.log('\n—— 压榨流判读（无脑招人探针）——')
console.log(
  `存活率  : ${sq.survival.toFixed(1)}%（vs 均衡流 ${report['均衡流'].survival.toFixed(1)}%）。${
    sq.survival < report['均衡流'].survival - 10 ? 'PASS——贪心招人被惩罚' : 'FAIL——权重没咬住，无脑招人仍是好策略'
  }`
)
console.log(
  `断粮回合: ${sq.avgStarvedTurns.toFixed(2)}。${sq.avgStarvedTurns > 0 ? '有——压榨流真的会饿' : '无——keepGrain=0 仍不断粮，口粮压力形同虚设'}`
)
console.log(
  `起义率  : ${sq.uprisingPct.toFixed(1)}%。${sq.uprisingPct > 0 ? '有——民意咬到了贪心者' : '无——民意对贪心打法无感，STARVE_HIT 需加压'}`
)
