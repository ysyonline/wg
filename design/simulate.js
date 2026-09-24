// simulate.js —— Monte Carlo 数值模拟 v0.1
// 跑法: node simulate.js
// 回答三个问题：
//   1) 可赢性 —— 玩得好的风格能不能守住第60天总攻（存活率≥70% 为 PASS）
//   2) 松弛度 —— 赢的人赢得多勉强（总攻时防御富余量，太高=没张力）
//   3) 策略分歧 —— 三种风格的存活率差距（≥15pp 才说明数值做出了“选择感”）
// 本脚本只读 TUNING.js，不复制数字——两边数字分叉，模拟就白跑。

const TUNING = require('./TUNING.js')

const RUNS = 1000
const jit = (v, pct = 0.15) => v * (1 - pct + Math.random() * pct * 2)

// ———— 状态 ————
function newState() {
  return {
    grain: TUNING.START.GRAIN,
    wood: TUNING.START.WOOD,
    stone: TUNING.START.STONE,
    iron: TUNING.START.IRON,
    pop: TUNING.START.POP,
    fields: Array(TUNING.START.FIELDS).fill('su'), // 'su' 粟 | 'ma' 麻
    towers: 0,
    ballistas: 0,
    wallHP: TUNING.WALL.HP,
    margin: 0, // 总攻时的防御富余（负=缺口）
    oil: 0, // [v0.6] 油料库存
    press: false, // 油坊（限1座）
    fire: false, // 本回合是否发动火攻（策略在敌情前决定）
    fires: 0, // 统计：火攻次数
    // [v0.7] 民意系统
    morale: TUNING.MORALE.START,
    granaries: 0, // 统计：开仓放粮次数
    uprisings: 0, // 统计：农民起义次数
    starved: false, // 本回合是否断粮（事件标记，民意阶段结算后清空）
    breached: false, // 本回合袭扰是否破防
    burnedCount: 0, // 本回合被烧田数
  }
}

// ———— 生产结算 ————
function produce(s, alloc) {
  const cap = s.fields.length * TUNING.FIELD.WORK_CAP
  const eff = Math.min(alloc.farm, cap) / cap // 耕作效率：人不够则田闲，人多则浪费
  for (const f of s.fields) {
    if (f === 'su') s.grain += TUNING.FIELD.YIELD_SU_GRAIN * eff * jit(1, 0.1)
    else {
      s.grain += TUNING.FIELD.YIELD_MA_GRAIN * eff * jit(1, 0.1)
      s.iron += TUNING.FIELD.YIELD_MA_IRON * eff * jit(1, 0.1)
    }
  }
  s.wood += alloc.wood * TUNING.WORKER.WOOD
  s.stone += alloc.stone * TUNING.WORKER.STONE
  s.iron += alloc.iron * TUNING.WORKER.IRON
  s.grain -= s.pop * TUNING.POP.EAT_PER_TURN
  if (s.press) s.oil += TUNING.OIL.OIL_PER_TURN // [v0.6] 油坊被动产油
}

// ———— 通用动作 ————
function tryBuild(s, cost) {
  for (const k of Object.keys(cost)) if (s[k] < cost[k]) return false
  for (const k of Object.keys(cost)) s[k] -= cost[k]
  return true
}
function buySettlers(s, keepGrain) {
  let n = 0
  while (s.grain - TUNING.POP.GRAIN_PER_SETTLER >= keepGrain && n < 10) {
    s.grain -= TUNING.POP.GRAIN_PER_SETTLER
    s.pop++
    n++
  }
}
function repair(s) {
  const missing = TUNING.WALL.HP - s.wallHP
  if (missing > 0) {
    const stones = Math.min(s.stone, Math.ceil(missing / TUNING.WALL.REPAIR_HP_PER_STONE))
    s.stone -= stones
    s.wallHP += stones * TUNING.WALL.REPAIR_HP_PER_STONE
  }
}
// [v0.7] 开仓放粮：民意唯一主动回复手段——粮的第4个出口（招人/修墙/护城之外还要买人心）
function openGranary(s, threshold, keepGrain) {
  const M = TUNING.MORALE
  if (s.morale < threshold && s.grain >= keepGrain + M.GRANARY_COST_GRAIN) {
    s.grain -= M.GRANARY_COST_GRAIN
    s.morale = Math.min(M.MAX, s.morale + M.GRANARY_GAIN)
    s.granaries++
  }
}

// ———— 敌情 ————
const defensePower = s =>
  s.towers * TUNING.TOWER.DEF +
  s.ballistas * TUNING.BALLISTA.DEF +
  s.wallHP * TUNING.WALL_DEF_SHARE

function enemyPhase(s, t) {
  const R = TUNING.RAID
  const A = TUNING.ASSAULT
  const idx = R.TURNS.indexOf(t)
  if (idx >= 0) {
    const riders = Math.round(jit(R.RIDERS[idx]))
    let atk = riders * R.ATK_PER_RIDER
    // [v0.6] 火攻：敌情前决定，20油换敌攻-35%且免疫烧田（保引擎不保库存）
    const fired = s.fire && s.oil >= TUNING.OIL.FIRE_COST
    if (fired) {
      s.oil -= TUNING.OIL.FIRE_COST
      s.fires++
      atk *= TUNING.OIL.FIRE_ATK_MULT
    }
    const gap = atk - defensePower(s)
    if (gap > 0) {
      s.wallHP -= gap * R.WALL_DMG_SHARE
      s.grain = Math.max(0, s.grain - riders * R.GRAIN_STEAL_PER_RIDER)
      s.breached = true // [v0.7] 破防标记→民意-10
      // [v0.5] 烧田：惩罚打在生产引擎上——但烧空不赶尽杀绝，至少留1块地让人有翻盘路
      // [v0.6] 火攻成功则田保住——"修墙护田"之外多了"烧油护田"这条主动解
      if (s.fields.length > 1 && R.BURN_FIELDS > 0 && !fired) {
        const burn = Math.min(R.BURN_FIELDS, s.fields.length - 1)
        s.fields.splice(Math.floor(Math.random() * s.fields.length), burn)
        s.burnedCount += burn // [v0.7] 烧田标记→每田民意-8
      }
    }
  }
  if (t === A.TURN) {
    const riders = Math.round(jit(A.RIDERS))
    // [v0.6] 火油倾泻：剩余油一次性折算防御，油在终局永远有用（尾部 sink）
    const dump = Math.min(s.oil, TUNING.OIL.ASSAULT_CAP) / 10 * TUNING.OIL.ASSAULT_PER10
    s.oil = 0
    s.margin = defensePower(s) + dump - riders * A.ATK_PER_RIDER
    if (s.margin >= 0) return 'clean' // 防线正面扛住
    s.wallHP -= -s.margin * A.WALL_DMG_SHARE // 被撕开口子，看血条够不够厚
    return s.wallHP > 0 ? 'barely' : 'lose'
  }
  return null
}

// ———— 民意结算 [v0.7]（每回合末，敌情之后）————
// 顺序设计：衰减/丰年/事件惩罚 → 阶段二治安（逃亡+劫粮）→ 阶段三起义 → 清事件标记
function moralePhase(s) {
  const M = TUNING.MORALE
  let m = s.morale
  m -= M.DECAY_PER_TURN // 乱世被动衰减：背景压力
  if (s.grain >= s.pop * M.WELL_FED_SURPLUS) m += M.WELL_FED_GAIN // 仓廪实
  if (s.starved) m -= M.STARVE_HIT // 断粮：民变第一因
  if (s.breached) m -= M.BREACH_HIT // 破防：人心浮动
  m -= s.burnedCount * M.BURN_HIT // 烧田：口粮来源被端
  s.morale = Math.min(M.MAX, m)
  // 阶段二：治安恶化——飞轮倒转（人口逃亡）+ 库存税（流民劫粮）
  if (s.morale < M.STAGE2_MORALE) {
    s.pop -= Math.ceil(s.pop * M.DESERT_PCT)
    s.grain = Math.max(0, s.grain - Math.round(s.pop * M.BANDIT_PER_POP))
  }
  // 阶段三：农民起义——自家人口变成第4波敌情，打自家防御
  if (s.morale < M.UPRISING_MORALE) {
    s.uprisings++
    const rebelAtk = s.pop * M.REBEL_ATK_PER_POP
    const gap = rebelAtk - defensePower(s)
    s.pop -= Math.ceil(s.pop * M.REBEL_POP_LOSS_PCT) // 起义必损人，无论成败
    if (gap > 0) {
      s.wallHP -= gap * M.REBEL_WALL_DMG_SHARE
      if (s.fields.length > 1 && M.REBEL_BURN_FIELDS > 0) {
        const burn = Math.min(M.REBEL_BURN_FIELDS, s.fields.length - 1)
        s.fields.splice(Math.floor(Math.random() * s.fields.length), burn)
      }
    }
    s.morale = M.AFTER_UPRISING_MORALE // 怨气随流血释放：留爬回来的路，也可能连环起义
  }
  s.starved = s.breached = false
  s.burnedCount = 0
  return s.wallHP <= 0 ? 'lose' : null // 被自家起义军砸塌城墙也算输
}

// ———— 三种纸面玩家风格（模拟的是“风格”，不是最优解）————
// [校准v0.1] 一回合=10天，允许每回合最多3项建造（v0.1首轮单建造导致全员裸防，已修正）
const strategies = {
  // A 均衡流：一半人种田，田够用就转军备，什么都想要但都不极致
  均衡流(s, t) {
    produce(s, {
      farm: Math.round(s.pop * 0.5),
      wood: Math.round(s.pop * 0.3),
      stone: Math.round(s.pop * 0.15),
      iron: Math.round(s.pop * 0.05),
    })
    if (s.fields.length < 4 && t <= 3)
      while (s.fields.length < 4 && tryBuild(s, { wood: TUNING.FIELD.COST_WOOD })) s.fields.push('su')
    let builds = 3
    while (builds-- > 0) {
      // [v0.6] 均衡流第1优先建油坊：什么都想要的风格不会放过新玩具
      if (!s.press && tryBuild(s, { wood: TUNING.OIL.PRESS_COST_WOOD, stone: TUNING.OIL.PRESS_COST_STONE })) s.press = true
      else if (s.towers < 5 && tryBuild(s, { wood: TUNING.TOWER.COST_WOOD, iron: TUNING.TOWER.COST_IRON })) s.towers++
      else if (s.ballistas < 2 && tryBuild(s, { wood: TUNING.BALLISTA.COST_WOOD, iron: TUNING.BALLISTA.COST_IRON })) s.ballistas++
      else break
    }
    s.fire = s.press && s.oil >= TUNING.OIL.FIRE_COST
    openGranary(s, 45, 200) // [v0.7] 均衡流民意低于45就放粮，保底200粮不饿死人
    buySettlers(s, 200)
    repair(s)
  },
  // B 农业流：前3回合疯狂开田攒粮换人口，后2回合才暴起造防
  农业流(s, t) {
    if (t <= 3) {
      produce(s, { farm: Math.round(s.pop * 0.7), wood: Math.round(s.pop * 0.25), stone: 0, iron: 0 })
      while (s.fields.length < 6 && tryBuild(s, { wood: TUNING.FIELD.COST_WOOD }))
        s.fields.push(s.fields.length % 2 === 0 ? 'ma' : 'su') // 混种，保证一点铁来源
      // [v0.6] 农业流第2回合起补油坊：田优先，油坊是护田保险
      if (t >= 2 && !s.press && tryBuild(s, { wood: TUNING.OIL.PRESS_COST_WOOD, stone: TUNING.OIL.PRESS_COST_STONE })) s.press = true
    } else {
      produce(s, {
        farm: Math.round(s.pop * 0.4),
        wood: Math.round(s.pop * 0.4),
        stone: Math.round(s.pop * 0.1),
        iron: Math.round(s.pop * 0.1),
      })
      let builds = 3
      while (builds-- > 0) {
        if (!s.press && tryBuild(s, { wood: TUNING.OIL.PRESS_COST_WOOD, stone: TUNING.OIL.PRESS_COST_STONE })) s.press = true
        else if (s.towers < 6 && tryBuild(s, { wood: TUNING.TOWER.COST_WOOD, iron: TUNING.TOWER.COST_IRON })) s.towers++
        else if (s.ballistas < 3 && tryBuild(s, { wood: TUNING.BALLISTA.COST_WOOD, iron: TUNING.BALLISTA.COST_IRON })) s.ballistas++
        else break
      }
    }
    s.fire = s.press && s.oil >= TUNING.OIL.FIRE_COST
    openGranary(s, 45, 150) // [v0.7] 农业流粮多，放粮阈值同均衡流
    buySettlers(s, 150)
    repair(s)
  },
  // C 军备流：田只保底不扩张，木头全变箭塔
  军备流(s, t) {
    produce(s, {
      farm: Math.min(Math.round(s.pop * 0.4), s.fields.length * TUNING.FIELD.WORK_CAP),
      wood: Math.round(s.pop * 0.4),
      stone: Math.round(s.pop * 0.1),
      iron: Math.round(s.pop * 0.1),
    })
    let builds = 3
    while (builds-- > 0) {
      if (s.towers < 8 && tryBuild(s, { wood: TUNING.TOWER.COST_WOOD, iron: TUNING.TOWER.COST_IRON })) s.towers++
      else if (s.ballistas < 3 && tryBuild(s, { wood: TUNING.BALLISTA.COST_WOOD, iron: TUNING.BALLISTA.COST_IRON })) s.ballistas++
      else if (s.fields.length < 3 && tryBuild(s, { wood: TUNING.FIELD.COST_WOOD })) s.fields.push('su')
      else break
    }
    buySettlers(s, 100) // [校准v0.4] 军备流也招人：真玩家有粮盈余就会扩人口，不招是脚本失真
    openGranary(s, 30, 100) // [v0.7] 军备流攒粮抠门，只在治安线前紧急放粮——预期它会体验阶段一
    s.fire = false // [v0.6] 军备流不建油坊（木头全变塔的纯粹主义）——作为"无油"对照组保留风格分歧
    repair(s)
  },
  // D 裸墙对照组：纯种田零防御——验证“不设防=必死”，不参与风格排名
  裸墙(s, t) {
    produce(s, {
      farm: Math.min(Math.round(s.pop * 0.7), s.fields.length * TUNING.FIELD.WORK_CAP),
      wood: Math.round(s.pop * 0.2),
      stone: Math.round(s.pop * 0.05),
      iron: 0,
    })
    while (s.fields.length < 6 && tryBuild(s, { wood: TUNING.FIELD.COST_WOOD }))
      s.fields.push(s.fields.length % 2 === 0 ? 'ma' : 'su')
    buySettlers(s, 150)
    repair(s)
  },
}

// ———— 单局 ————
function run(name) {
  const s = newState()
  for (let t = 1; t <= TUNING.TOTAL_TURNS; t++) {
    strategies[name](s, t)
    const r = enemyPhase(s, t)
    if (t === TUNING.ASSAULT.TURN) return { result: r, s }
    // [v0.7] 民意结算排在敌情后：事件（断粮/破防/烧田）当回合就兑现成民意变动
    const m = moralePhase(s)
    if (m) return { result: m, s }
    if (s.wallHP <= 0) return { result: 'lose', s } // 袭扰把墙磨塌也算输
  }
  return { result: 'lose', s }
}

// ———— Monte Carlo ————
const report = {}
for (const name of Object.keys(strategies)) {
  let clean = 0, barely = 0, lose = 0, marginSum = 0, wallSum = 0, presses = 0, fires = 0
  let moraleSum = 0, granaries = 0, uprisings = 0
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
  }
}

console.log(`=== 长城守城 v${TUNING.VERSION} · Monte Carlo ×${RUNS} ===`)
console.log('风格\t存活%\t正面扛住%\t惨胜%\t城破%\t总攻防御富余\t存活者平均剩余墙耐久\t油坊%\t火攻均值\t期末民意\t放粮次\t起义%')
for (const [name, r] of Object.entries(report)) {
  console.log(
    `${name}\t${r.survival.toFixed(1)}\t${r.cleanPct.toFixed(1)}\t\t${r.barelyPct.toFixed(1)}\t${r.losePct.toFixed(1)}\t${Math.round(r.avgMargin)}\t\t${Math.round(r.avgWallLeft)}\t\t${r.pressPct.toFixed(0)}\t${r.avgFires.toFixed(2)}\t\t${r.avgMorale.toFixed(0)}\t\t${r.avgGranaries.toFixed(2)}\t${r.uprisingPct.toFixed(1)}`
  )
}

// ———— 三指标判读（裸墙是对照组，不参与风格排名）————
const entries = Object.entries(report).filter(([n]) => n !== '裸墙')
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

