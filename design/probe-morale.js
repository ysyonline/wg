// probe-morale.js 鈥斺€?姘戞剰绯荤粺鍘嬪姏鎺㈤拡锛堝彧璇?TUNING.js锛屼笉鏀瑰姩浠撳簱锛?// 鐩殑锛氶獙璇?v0.7 姘戞剰绯荤粺鏄惁鐪熺殑浼氬"姝ｅ父鍋忔縺杩?鐨勭粡钀ラ鏍煎挰浜?// 璺戞硶: node probe-morale.js   锛堢粨鏋滃啓鍏?probe-out.json锛?const fs = require('fs')
const TUNING = require('./TUNING.js')
const OUT = './probe-out.json'

const RUNS = 1000
const jit = (v, pct = 0.15) => v * (1 - pct + Math.random() * pct * 2)

function newState() {
  return {
    grain: TUNING.START.GRAIN, wood: TUNING.START.WOOD, stone: TUNING.START.STONE,
    iron: TUNING.START.IRON, pop: TUNING.START.POP,
    fields: Array(TUNING.START.FIELDS).fill('su'),
    towers: 0, ballistas: 0, wallHP: TUNING.WALL.HP, margin: 0,
    oil: 0, press: false, fire: false, fires: 0,
    morale: TUNING.MORALE.START, granaries: 0, uprisings: 0,
    starved: false, breached: false, burnedCount: 0,
  }
}

// FIX 寮€鍏?A锛氭柇绮簨浠舵槸鍚︽帴閫氾紙鍘熶欢浠庢湭鎶?starved 缃?true锛孲TARVE_HIT 鏄瑙勫垯锛?let FIX_STARVE = false

function produce(s, alloc) {
  const cap = s.fields.length * TUNING.FIELD.WORK_CAP
  const eff = Math.min(alloc.farm, cap) / cap
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
  if (s.grain < 0) {
    if (FIX_STARVE) s.starved = true
    s.grain = 0 // 绮笉鍙负璐燂細鏂伯鐨勪唬浠锋槸浜嬩欢锛屼笉鏄礋璧勪骇
  }
  if (s.press) s.oil += TUNING.OIL.OIL_PER_TURN
}

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
function openGranary(s, threshold, keepGrain) {
  const M = TUNING.MORALE
  if (s.morale < threshold && s.grain >= keepGrain + M.GRANARY_COST_GRAIN) {
    s.grain -= M.GRANARY_COST_GRAIN
    s.morale = Math.min(M.MAX, s.morale + M.GRANARY_GAIN)
    s.granaries++
  }
}

const defensePower = s =>
  s.towers * TUNING.TOWER.DEF + s.ballistas * TUNING.BALLISTA.DEF + s.wallHP * TUNING.WALL_DEF_SHARE

function enemyPhase(s, t) {
  const R = TUNING.RAID
  const A = TUNING.ASSAULT
  const idx = R.TURNS.indexOf(t)
  if (idx >= 0) {
    const riders = Math.round(jit(R.RIDERS[idx]))
    let atk = riders * R.ATK_PER_RIDER
    const fired = s.fire && s.oil >= TUNING.OIL.FIRE_COST
    if (fired) { s.oil -= TUNING.OIL.FIRE_COST; s.fires++; atk *= TUNING.OIL.FIRE_ATK_MULT }
    const gap = atk - defensePower(s)
    if (gap > 0) {
      s.wallHP -= gap * R.WALL_DMG_SHARE
      s.grain = Math.max(0, s.grain - riders * R.GRAIN_STEAL_PER_RIDER)
      s.breached = true
      if (s.fields.length > 1 && R.BURN_FIELDS > 0 && !fired) {
        const burn = Math.min(R.BURN_FIELDS, s.fields.length - 1)
        s.fields.splice(Math.floor(Math.random() * s.fields.length), burn)
        s.burnedCount += burn
      }
    }
  }
  if (t === A.TURN) {
    const riders = Math.round(jit(A.RIDERS))
    const dump = Math.min(s.oil, TUNING.OIL.ASSAULT_CAP) / 10 * TUNING.OIL.ASSAULT_PER10
    s.oil = 0
    s.margin = defensePower(s) + dump - riders * A.ATK_PER_RIDER
    if (s.margin >= 0) return 'clean'
    s.wallHP -= -s.margin * A.WALL_DMG_SHARE
    return s.wallHP > 0 ? 'barely' : 'lose'
  }
  return null
}

// FIX 寮€鍏?B锛氬師浠跺湪 TOTAL_TURNS 鍥炲悎鐩存帴 return锛屾渶鍚庝竴鍥炲悎涓嶈窇姘戞剰缁撶畻
let FIX_LASTTURN_MORALE = false

function moralePhase(s) {
  const M = TUNING.MORALE
  let m = s.morale
  m -= M.DECAY_PER_TURN
  if (s.grain >= s.pop * M.WELL_FED_SURPLUS) m += M.WELL_FED_GAIN
  if (s.starved) m -= M.STARVE_HIT
  if (s.breached) m -= M.BREACH_HIT
  m -= s.burnedCount * M.BURN_HIT
  s.morale = Math.min(M.MAX, m)
  if (s.morale < M.STAGE2_MORALE) {
    s.pop -= Math.ceil(s.pop * M.DESERT_PCT)
    s.grain = Math.max(0, s.grain - Math.round(s.pop * M.BANDIT_PER_POP))
  }
  if (s.morale < M.UPRISING_MORALE) {
    s.uprisings++
    const rebelAtk = s.pop * M.REBEL_ATK_PER_POP
    const gap = rebelAtk - defensePower(s)
    s.pop -= Math.ceil(s.pop * M.REBEL_POP_LOSS_PCT)
    if (gap > 0) {
      s.wallHP -= gap * M.REBEL_WALL_DMG_SHARE
      if (s.fields.length > 1 && M.REBEL_BURN_FIELDS > 0) {
        const burn = Math.min(M.REBEL_BURN_FIELDS, s.fields.length - 1)
        s.fields.splice(Math.floor(Math.random() * s.fields.length), burn)
      }
    }
    s.morale = M.AFTER_UPRISING_MORALE
  }
  s.starved = s.breached = false
  s.burnedCount = 0
  return s.wallHP <= 0 ? 'lose' : null
}

// 鈥斺€斺€斺€?澶嶇敤鍘熺瓥鐣?+ 鏂板绗洓椋庢牸锛氬帇姒ㄦ祦 鈥斺€斺€斺€?// 鍘嬫Θ娴?= 鐪熶汉鏈€甯歌鐨勮椽蹇冩墦娉曪細鏈夌伯灏辨嫑浜猴紙浜哄彛椋炶疆锛夛紝浠庝笉涓诲姩鏀剧伯锛屽彧鍦ㄥ穿鍒拌捣涔夌嚎鍓嶆墠鏁戠伀
// 杩欐槸绾搁潰涓婂敮涓€鍙兘韪╄繘姘戞剰闃舵浜?涓夌殑"闈炴憜鐑?椋庢牸
const strategies = {
  鍧囪　娴?s, t) {
    produce(s, { farm: Math.round(s.pop * 0.5), wood: Math.round(s.pop * 0.3), stone: Math.round(s.pop * 0.15), iron: Math.round(s.pop * 0.05) })
    if (s.fields.length < 4 && t <= 3)
      while (s.fields.length < 4 && tryBuild(s, { wood: TUNING.FIELD.COST_WOOD })) s.fields.push('su')
    let builds = 3
    while (builds-- > 0) {
      if (!s.press && tryBuild(s, { wood: TUNING.OIL.PRESS_COST_WOOD, stone: TUNING.OIL.PRESS_COST_STONE })) s.press = true
      else if (s.towers < 5 && tryBuild(s, { wood: TUNING.TOWER.COST_WOOD, iron: TUNING.TOWER.COST_IRON })) s.towers++
      else if (s.ballistas < 2 && tryBuild(s, { wood: TUNING.BALLISTA.COST_WOOD, iron: TUNING.BALLISTA.COST_IRON })) s.ballistas++
      else break
    }
    s.fire = s.press && s.oil >= TUNING.OIL.FIRE_COST
    openGranary(s, 45, 200)
    buySettlers(s, 200)
    repair(s)
  },
  鍐滀笟娴?s, t) {
    if (t <= 3) {
      produce(s, { farm: Math.round(s.pop * 0.7), wood: Math.round(s.pop * 0.25), stone: 0, iron: 0 })
      while (s.fields.length < 6 && tryBuild(s, { wood: TUNING.FIELD.COST_WOOD })) s.fields.push(s.fields.length % 2 === 0 ? 'ma' : 'su')
      if (t >= 2 && !s.press && tryBuild(s, { wood: TUNING.OIL.PRESS_COST_WOOD, stone: TUNING.OIL.PRESS_COST_STONE })) s.press = true
    } else {
      produce(s, { farm: Math.round(s.pop * 0.4), wood: Math.round(s.pop * 0.4), stone: Math.round(s.pop * 0.1), iron: Math.round(s.pop * 0.1) })
      let builds = 3
      while (builds-- > 0) {
        if (!s.press && tryBuild(s, { wood: TUNING.OIL.PRESS_COST_WOOD, stone: TUNING.OIL.PRESS_COST_STONE })) s.press = true
        else if (s.towers < 6 && tryBuild(s, { wood: TUNING.TOWER.COST_WOOD, iron: TUNING.TOWER.COST_IRON })) s.towers++
        else if (s.ballistas < 3 && tryBuild(s, { wood: TUNING.BALLISTA.COST_WOOD, iron: TUNING.BALLISTA.COST_IRON })) s.ballistas++
        else break
      }
    }
    s.fire = s.press && s.oil >= TUNING.OIL.FIRE_COST
    openGranary(s, 45, 150)
    buySettlers(s, 150)
    repair(s)
  },
  鍐涘娴?s, t) {
    produce(s, { farm: Math.min(Math.round(s.pop * 0.4), s.fields.length * TUNING.FIELD.WORK_CAP), wood: Math.round(s.pop * 0.4), stone: Math.round(s.pop * 0.1), iron: Math.round(s.pop * 0.1) })
    let builds = 3
    while (builds-- > 0) {
      if (s.towers < 8 && tryBuild(s, { wood: TUNING.TOWER.COST_WOOD, iron: TUNING.TOWER.COST_IRON })) s.towers++
      else if (s.ballistas < 3 && tryBuild(s, { wood: TUNING.BALLISTA.COST_WOOD, iron: TUNING.BALLISTA.COST_IRON })) s.ballistas++
      else if (s.fields.length < 3 && tryBuild(s, { wood: TUNING.FIELD.COST_WOOD })) s.fields.push('su')
      else break
    }
    buySettlers(s, 100)
    openGranary(s, 30, 100)
    s.fire = false
    repair(s)
  },
}

// [鎺㈤拡鏂板] 鍘嬫Θ娴佸伐鍘傦細鎶娿€屾嫑浜烘椂淇濈暀澶氬皯绮€嶅弬鏁板寲锛岀敤浜庡畾浣嶈捣涔夌嚎韪╁湪鍝竴妗?function makeSqueezer(keepPop, threshold) {
  return function (s, t) {
    if (t <= 3) {
      produce(s, { farm: Math.round(s.pop * 0.75), wood: Math.round(s.pop * 0.25), stone: 0, iron: 0 })
      while (s.fields.length < 6 && tryBuild(s, { wood: TUNING.FIELD.COST_WOOD })) s.fields.push('su')
    } else {
      produce(s, { farm: Math.round(s.pop * 0.5), wood: Math.round(s.pop * 0.3), stone: Math.round(s.pop * 0.1), iron: Math.round(s.pop * 0.1) })
      let builds = 3
      while (builds-- > 0) {
        if (s.towers < 5 && tryBuild(s, { wood: TUNING.TOWER.COST_WOOD, iron: TUNING.TOWER.COST_IRON })) s.towers++
        else if (s.ballistas < 2 && tryBuild(s, { wood: TUNING.BALLISTA.COST_WOOD, iron: TUNING.BALLISTA.COST_IRON })) s.ballistas++
        else break
      }
    }
    buySettlers(s, keepPop)
    repair(s)
    openGranary(s, threshold, 0)
  }
}

function run(name) {
  const s = newState()
  for (let t = 1; t <= TUNING.TOTAL_TURNS; t++) {
    strategies[name](s, t)
    const r = enemyPhase(s, t)
    if (t === TUNING.ASSAULT.TURN) {
      if (FIX_LASTTURN_MORALE) { const m = moralePhase(s); if (m) return { result: m, s } }
      return { result: r, s }
    }
    const m = moralePhase(s)
    if (m) return { result: m, s }
    if (s.wallHP <= 0) return { result: 'lose', s }
  }
  return { result: 'lose', s }
}

function sweep(label) {
  const rep = {}
  for (const name of Object.keys(strategies)) {
    let clean = 0, barely = 0, lose = 0, moraleSum = 0, granaries = 0, uprisings = 0
    let minMorale = 100, popSum = 0, stage2Hit = 0
    for (let i = 0; i < RUNS; i++) {
      const { result, s } = run(name)
      if (result === 'clean') clean++
      else if (result === 'barely') barely++
      else lose++
      moraleSum += s.morale
      if (s.morale < minMorale) minMorale = s.morale
      granaries += s.granaries
      uprisings += s.uprisings
      popSum += s.pop
    }
    rep[name] = {
      瀛樻椿: +(((clean + barely) / RUNS) * 100).toFixed(1),
      姝ｉ潰鎵涗綇: +((clean / RUNS) * 100).toFixed(1),
      鍩庣牬: +((lose / RUNS) * 100).toFixed(1),
      鏈熸湯姘戞剰: +(moraleSum / RUNS).toFixed(0),
      缁堝眬鏈€浣庢皯鎰? minMorale,
      鏀剧伯娆? +(granaries / RUNS).toFixed(2),
      璧蜂箟鐜? +((uprisings / RUNS) * 100).toFixed(1),
      鏈熸湯浜哄彛: +(popSum / RUNS).toFixed(0),
    }
  }
  return { label, rep }
}

const scenarios = [
  { name: 'A 鐜扮姸锛堜粨搴撳師鏍凤級', starve: false, last: false },
  { name: 'B 鍙帴鏂伯浜嬩欢 STARVE_HIT', starve: true, last: false },
  { name: 'C 鏂伯 + 鎬绘敾鍥炲悎涔熺畻姘戞剰', starve: true, last: true },
]

const BASE_STRATEGIES = Object.assign({}, strategies)

const out = []
for (const sc of scenarios) {
  FIX_STARVE = sc.starve
  FIX_LASTTURN_MORALE = sc.last

  // 鍦烘櫙A 鍚屾椂璺戙€岀暀绮笅闄愭搴︺€嶏細瀹氫綅璧蜂箟绾垮埌搴曡俯鍦ㄥ摢涓€妗?  if (sc.name.startsWith('A')) {
    for (const keep of [0, 50, 100, 150, 200, 300]) {
      for (const k of Object.keys(strategies)) delete strategies[k]
      Object.assign(strategies, BASE_STRATEGIES)
      strategies['鍘嬫Θ娴?] = makeSqueezer(keep, 18)
      const r = sweep(sc.name)
      out.push({ grad: `鐣欑伯涓嬮檺=${keep}`, rep: r.rep })
    }
  }
  for (const k of Object.keys(strategies)) delete strategies[k]
  Object.assign(strategies, BASE_STRATEGIES)
  out.push(sweep(sc.name))
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8')
console.log('done')
