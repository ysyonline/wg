// engine-v2.js —— 长城守城 · 规则引擎 v2（demo 与 simulate-v2 的唯一规则来源）
//
// v2 规则骨架（与旧 engine.js 不兼容，旧版冻结不动，见设计总表 v2）：
//   - 90 天时间线，按天结算：白天生产 → 动工建造 → （若敌情日）战斗；
//   - 分层战斗：箭塔/弩炮先削人（受 40% 上限 + 驻守率约束）→ 剩余的骑砸墙；
//   - 墙耐久由土质决定，修墙用土（效率=档位），升墙重夯用土+石；
//   - 兵：平民征召，驻守武器才生效，贴墙肉搏会损兵；
//   - 断粮 = 每天逃亡 2% 平民；墙塌 = 城破。
//
// 用法：
//   Node   : const { createEngine } = require('./engine-v2.js'); const E = createEngine({ jitter: true })
//   浏览器 : <script src="TUNING-v2.js"></script><script src="engine-v2.js"></script>
//            const E = EngineV2.createEngine({ jitter: false })
//
// jitter：true=模拟用（±15% 敌骑 / ±10% 产出）；false=demo 用（确定性世界）。

;(function (global) {
  const T = typeof TUNING_V2 !== 'undefined' ? TUNING_V2 : require('./TUNING-v2.js')

  function createEngine(opts) {
    const jitter = !opts || opts.jitter !== false
    const jit = (v, pct = 0.15) => (jitter ? v * (1 - pct + Math.random() * pct * 2) : v)
    const r1 = (v) => Math.round(v)

    // ———— 状态 ————
    function newState() {
      return {
        day: 0,
        grain: T.START.GRAIN,
        wood: T.START.WOOD,
        stone: T.START.STONE,
        iron: T.START.IRON,
        earth: T.START.EARTH,
        civ: T.START.CIV, // 平民（生产）
        sol: T.START.SOL, // 兵（驻守/肉搏）
        fields: Array(T.START.FIELDS).fill('su'), // 'su' 粟 | 'ma' 麻
        towers: 0,
        ballistas: 0,
        wallTier: T.WALL.START_TIER,
        wallHP: T.WALL.START_HP,
        // 统计
        starveDays: 0,   // 断粮天数
        breaches: 0,     // 敌人摸到墙根的次数
        trimsTotal: 0,   // 累计削骑数
        solLost: 0,      // 累计损兵
        // demo 用
        log: [],
      }
    }

    const pop = (s) => s.civ + s.sol
    const wallCap = (s) => T.WALL.TIERS[s.wallTier].cap
    const hpPerEarth = (s) => T.WALL.TIERS[s.wallTier].hpPerEarth
    // 驻守需求/驻守率：兵不够 → 所有武器按同一比例打折（3塔6兵满编，只有3兵=半效率）
    const crewNeeded = (s) => s.towers * T.ARMY.TOWER_CREW + s.ballistas * T.ARMY.BALLISTA_CREW
    const crewRatio = (s) => {
      const need = crewNeeded(s)
      return need > 0 ? Math.min(1, s.sol / need) : 0
    }
    const trimPower = (s) => s.towers * T.TOWER.TRIM + s.ballistas * T.BALLISTA.TRIM

    // ———— 人口效率权重 [沿用 v0.9，v2 只看平民数] ————
    function popWeight(civ) {
      const P = T.POP_EFF
      if (civ <= P.SMALL) return P.SMALL_W
      if (civ <= P.BASE) return 1.0
      return Math.min(P.MAX_W, 1.0 + (civ - P.BASE) * P.SLOPE)
    }

    // ———— 一天的生产结算 ————
    // alloc 全部是平民岗位：farm 种田 / wood 伐木 / stone 采石 / iron 采矿 / earth 挖土
    function dayTick(s, alloc) {
      s.log.length = 0
      s.day++
      s.breached = false
      s.starved = false

      // 田产（物理上限 4 人/块，不吃 POP_EFF）
      const cap = s.fields.length * T.PROD.FIELD_CAP
      const eff = cap > 0 ? Math.min(alloc.farm, cap) / cap : 0
      let g = 0, ir = 0
      for (const f of s.fields) {
        if (f === 'su') g += T.PROD.FIELD_SU_GRAIN * eff * jit(1, 0.1)
        else {
          g += T.PROD.FIELD_MA_GRAIN * eff * jit(1, 0.1)
          ir += T.PROD.FIELD_MA_IRON * eff * jit(1, 0.1)
        }
      }
      // 工产（吃 POP_EFF 权重：人越多每人产出越低，口粮照吃满额）
      const pw = popWeight(s.civ)
      const w = alloc.wood * T.PROD.WOOD_PER * pw * jit(1, 0.1)
      const st = alloc.stone * T.PROD.STONE_PER * pw * jit(1, 0.1)
      const mi = alloc.iron * T.PROD.IRON_PER * pw * jit(1, 0.1)
      const e = alloc.earth * T.PROD.EARTH_PER * pw * jit(1, 0.1)
      s.grain += g
      s.wood += w
      s.stone += st
      s.iron += ir + mi
      s.earth += e

      // 口粮：平民 0.2 / 兵 0.3
      const eat = s.civ * T.PROD.EAT_CIV + s.sol * T.PROD.EAT_SOL
      s.grain -= eat

      s.log.push(
        `第${s.day}天：粮 +${r1(g)}-${r1(eat)} 斛　木 +${r1(w)}　石 +${r1(st)}　铁 +${r1(ir + mi)} 斤　土 +${r1(e)} 方` +
          (eff < 1 ? `（耕作效率 ${Math.round(eff * 100)}%）` : '') +
          (pw > 1.001 ? `（超编损耗 ${Math.round((pw - 1) * 100)}%）` : '')
      )

      // 断粮：库存归零 + 每天逃亡 2% 平民（兵有军纪不逃）
      if (s.grain < 0) {
        s.grain = 0
        s.starved = true
        s.starveDays++
        const gone = Math.max(1, Math.ceil(s.civ * T.STARVE.DESERT_PCT))
        s.civ = Math.max(0, s.civ - gone)
        s.log.push(`⚠ 断粮：${gone} 人逃亡`)
      }
    }

    // ———— 通用扣费 ————
    function tryPay(s, cost) {
      for (const k of Object.keys(cost)) if (s[k] < cost[k]) return false
      for (const k of Object.keys(cost)) s[k] -= cost[k]
      return true
    }

    // ———— 建造（demo 阶段无工期：点了当天生效）————
    function buildField(s, type) {
      if (!tryPay(s, { wood: T.PROD.FIELD_COST_WOOD })) return false
      s.fields.push(type || 'su')
      s.log.push(`开了一块${type === 'ma' ? '麻' : '粟'}田（共 ${s.fields.length} 块）`)
      return true
    }
    function buildTower(s) {
      if (!tryPay(s, { wood: T.TOWER.COST_WOOD, iron: T.TOWER.COST_IRON })) return false
      s.towers++
      s.log.push(`建箭塔 ×1（共 ${s.towers} 座，需兵 ${crewNeeded(s)}）`)
      return true
    }
    function buildBallista(s) {
      if (!tryPay(s, { wood: T.BALLISTA.COST_WOOD, iron: T.BALLISTA.COST_IRON })) return false
      s.ballistas++
      s.log.push(`建弩炮 ×1（共 ${s.ballistas} 座，需兵 ${crewNeeded(s)}）`)
      return true
    }
    // 升墙重夯：扣土+石，耐久按新旧上限比例折算（不白干也不免费）
    function upgradeWall(s) {
      const order = ['sha', 'hui', 'huang']
      const idx = order.indexOf(s.wallTier)
      if (idx >= order.length - 1) return false
      const next = order[idx + 1]
      const cost = T.WALL.UPGRADE[next]
      if (!tryPay(s, { earth: cost.earth, stone: cost.stone })) return false
      const oldCap = wallCap(s), newCap = T.WALL.TIERS[next].cap
      s.wallHP = Math.min(newCap, Math.round((s.wallHP / oldCap) * newCap))
      s.wallTier = next
      s.log.push(`城墙重夯为${T.WALL.TIERS[next].name}（耐久 ${r1(s.wallHP)}/${newCap}）`)
      return true
    }
    // 修墙：土 → 耐久，效率=当前档（灰 12 / 黄 20 / 砂 6）
    function repair(s, earthBudget) {
      const missing = wallCap(s) - s.wallHP
      if (missing <= 0 || s.earth <= 0) return 0
      const budget = earthBudget == null ? s.earth : Math.min(s.earth, earthBudget)
      const earths = Math.min(budget, Math.ceil(missing / hpPerEarth(s)))
      s.earth -= earths
      s.wallHP = Math.min(wallCap(s), s.wallHP + earths * hpPerEarth(s))
      return earths
    }

    // ———— 征兵 / 退伍 ————
    function recruit(s, n) {
      const k = Math.min(n, s.civ)
      s.civ -= k
      s.sol += k
      if (k > 0) s.log.push(`征兵 ${k} 人（兵 ${s.sol}，平民 ${s.civ}）`)
      return k
    }
    function disband(s, n) {
      const k = Math.min(n, s.sol)
      s.sol -= k
      s.civ += k
      return k
    }
    // 招流民：粮换平民。keepGrain = 招完后想保住的口粮底线（策略的心理安全线）
    function buySettlers(s, keepGrain, max) {
      const limit = max == null ? 5 : max // 每天至多招 5 人：时间线变长后，单日无上限会瞬间吞光粮
      let n = 0
      while (s.grain - T.PROD.GRAIN_PER_SETTLER >= keepGrain && n < limit) {
        s.grain -= T.PROD.GRAIN_PER_SETTLER
        s.civ++
        n++
      }
      return n
    }

    // ———— 战斗（分层）————
    // 流程：削（受 40% 上限 + 驻守率）→ 剩余骑砸墙 → 摸到墙根则惩罚 + 损兵
    function battle(s, day) {
      const EN = T.ENEMY
      const isAssault = day === EN.ASSAULT.day
      let riders, siegePer
      if (isAssault) {
        riders = Math.round(jit(EN.ASSAULT.riders))
        siegePer = EN.ASSAULT.SIEGE_PER_RIDER
      } else {
        const raid = EN.RAIDS.find((r) => r.day === day)
        if (!raid) return null
        riders = Math.round(jit(raid.riders))
        siegePer = EN.RAID_SIEGE_PER_RIDER
      }

      // 1) 远程削弱：上限 40% + 驻守率打折
      const cap = Math.floor(riders * EN.TRIM_CAP)
      const raw = trimPower(s) * crewRatio(s)
      const trim = Math.min(cap, Math.floor(raw))
      const remaining = riders - trim
      s.trimsTotal += trim

      s.log.push(
        `${isAssault ? '总攻' : '敌情'}：${riders} 骑压境 → 远程削去 ${trim} 骑（驻守率 ${Math.round(crewRatio(s) * 100)}%）→ ${remaining} 骑冲到城下`
      )

      // 2) 剩余骑砸墙
      const siege = remaining * siegePer
      s.wallHP -= siege
      let result
      if (s.wallHP <= 0) {
        s.wallHP = 0
        result = 'lose'
        s.log.push(`💀 城墙轰然倒塌（攻城力 ${r1(siege)}）`)
        return result
      }
      if (remaining > 0) {
        // 3) 摸到墙根：破防惩罚（总攻不抢粮不烧田——倾国之战只看墙）+ 贴墙损兵
        s.breaches++
        s.breached = true
        if (!isAssault) {
          const stolen = Math.min(s.grain, remaining * T.RAID_PENALTY.GRAIN_STEAL_PER_RIDER)
          s.grain -= stolen
          if (s.fields.length > 1 && T.RAID_PENALTY.BURN_FIELDS > 0) {
            const burn = Math.min(T.RAID_PENALTY.BURN_FIELDS, s.fields.length - 1)
            s.fields.splice(Math.floor(Math.random() * s.fields.length), burn)
            s.log.push(`⚠ 破防：粮被抢 -${r1(stolen)} 斛，${burn} 块田被焚`)
          } else {
            s.log.push(`⚠ 破防：粮被抢 -${r1(stolen)} 斛`)
          }
        }
        const loss = Math.max(remaining > 0 ? 1 : 0, Math.ceil(remaining * T.ARMY.LOSS_SHARE))
        const dead = Math.min(s.sol, loss)
        s.sol -= dead
        s.solLost += dead
        s.log.push(`⚠ 城下肉搏折兵 ${dead} 人（剩 ${s.sol}），城墙 -${r1(Math.min(siege, s.wallHP + siege))} 耐久`)
      } else {
        s.log.push(`✓ 全数拦截于城外，城墙未损`)
      }
      return isAssault ? (s.breached ? 'barely' : 'clean') : 'held'
    }

    return {
      TUNING: T,
      jitter,
      jit,
      newState,
      pop,
      wallCap,
      hpPerEarth,
      crewNeeded,
      crewRatio,
      trimPower,
      popWeight,
      dayTick,
      buildField,
      buildTower,
      buildBallista,
      upgradeWall,
      repair,
      recruit,
      disband,
      buySettlers,
      battle,
    }
  }

  const API = { createEngine, TUNING: T }
  if (typeof module !== 'undefined' && module.exports) module.exports = API
  else global.EngineV2 = API
})(typeof window !== 'undefined' ? window : globalThis)
