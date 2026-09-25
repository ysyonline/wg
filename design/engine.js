// engine.js —— 长城守城 · 规则引擎（demo 与 simulate 的唯一规则来源）v0.7.1-starve-fix
//
// 为什么要有这个文件：simulate.js（数学验证）与 demo（手感验证）如果各自实现一遍结算，
// 两边迟早分叉，模拟就白跑了。规则只允许在这里改一次，两边都调同一份。
//
// 用法：
//   Node   : const { createEngine } = require('./engine.js'); const E = createEngine({ jitter: true })
//   浏览器 : <script src="TUNING.js"></script><script src="engine.js"></script>
//            const E = Engine.createEngine({ jitter: false })
//
// jitter 开关的 rationale：
//   true  —— 模拟用。±15% 敌情 / ±10% 产出，模拟的是"现实噪声下的分布"，跑 1000 次看存活率。
//   false —— demo 用。确定性数值，让玩家能学到「40 骑 = 400 攻」这条因果；
//            手感验证阶段要的是可学习的世界，不是骰子。噪声留到难度选项里再加。
//
// 事件播报走 s.log（每回合 produce 时清空），demo 读它渲染事件区；simulate 忽略它。

;(function (global) {
  const T = typeof TUNING !== 'undefined' ? TUNING : require('./TUNING.js')

  function createEngine(opts) {
    const jitter = !opts || opts.jitter !== false
    // pct 默认 0.15（=±15%）：模拟里的现实噪声幅度，调用方多数不传，别把默认值弄丢
    const jit = (v, pct = 0.15) => (jitter ? v * (1 - pct + Math.random() * pct * 2) : v)
    const r1 = (v) => Math.round(v)

    // ———— 状态 ————
    function newState() {
      return {
        grain: T.START.GRAIN,
        wood: T.START.WOOD,
        stone: T.START.STONE,
        iron: T.START.IRON,
        pop: T.START.POP,
        fields: Array(T.START.FIELDS).fill('su'), // 'su' 粟 | 'ma' 麻
        towers: 0,
        ballistas: 0,
        wallHP: T.WALL.HP,
        margin: 0, // 总攻时的防御富余（负=缺口）
        oil: 0, // [v0.6] 油料库存
        press: false, // 油坊（限1座）
        fire: false, // 本回合是否发动火攻（敌情前决定）
        fires: 0, // 统计：火攻次数
        // [v0.7] 民意系统
        morale: T.MORALE.START,
        granaries: 0, // 统计：开仓放粮次数
        uprisings: 0, // 统计：农民起义次数
        starved: false, // 本回合是否断粮（事件标记，民意阶段结算后清空）
        starvedTurns: 0, // 统计：累计断粮回合数（没被清空）
        breached: false, // 本回合袭扰是否破防
        burnedCount: 0, // 本回合被烧田数
        // demo 用
        log: [],
      }
    }

    // ———— 防御力 ————
    const defensePower = (s) =>
      s.towers * T.TOWER.DEF + s.ballistas * T.BALLISTA.DEF + s.wallHP * T.WALL_DEF_SHARE

    // ———— 生产结算 ————
    // 顺序：田产 → 工产 → 油坊 → 口粮（口粮在最后，断粮判定要在扣完之后）
    function produce(s, alloc) {
      s.log.length = 0
      const cap = s.fields.length * T.FIELD.WORK_CAP
      const eff = cap > 0 ? Math.min(alloc.farm, cap) / cap : 0 // 人不够则田闲，人多则浪费
      let g = 0, i = 0
      for (const f of s.fields) {
        if (f === 'su') g += T.FIELD.YIELD_SU_GRAIN * eff * jit(1, 0.1)
        else {
          g += T.FIELD.YIELD_MA_GRAIN * eff * jit(1, 0.1)
          i += T.FIELD.YIELD_MA_IRON * eff * jit(1, 0.1)
        }
      }
      const w = alloc.wood * T.WORKER.WOOD
      const st = alloc.stone * T.WORKER.STONE
      const ir = alloc.iron * T.WORKER.IRON + i
      const eat = s.pop * T.POP.EAT_PER_TURN
      s.grain += g
      s.wood += w
      s.stone += st
      s.iron += ir
      if (s.press) s.oil += T.OIL.OIL_PER_TURN
      s.grain -= eat

      // 日志文案带单位：没有单位的数字玩家读不懂（"石 +20" 是石料还是粮食？）
      s.log.push(
        `收成：粮 +${r1(g)} 斛　木材 +${r1(w)} 根　石料 +${r1(st)} 块　铁 +${r1(ir)} 斤　口粮 -${r1(eat)} 斛` +
          (eff < 1 ? `（耕作效率 ${Math.round(eff * 100)}%，人不够田在闲）` : '')
      )
      if (s.press) s.log.push(`油坊产油 +${T.OIL.OIL_PER_TURN} 桶`)

      // [v0.7.1 修复] 断粮惩罚此前从未接线：simulate.js 里 s.starved 声明了却没人置 true，
      // 于是 MORALE.STARVE_HIT(-25) 是纸面数值。这里补上：粮扣成负数即断粮，库存归零并打标记。
      if (s.grain < 0) {
        s.starved = true
        s.starvedTurns++
        s.grain = 0
        s.log.push('⚠ 粮仓见底，城中开始挨饿')
      }
    }

    // ———— 通用动作 ————
    function tryBuild(s, cost) {
      for (const k of Object.keys(cost)) if (s[k] < cost[k]) return false
      for (const k of Object.keys(cost)) s[k] -= cost[k]
      return true
    }
    function buySettlers(s, keepGrain, max) {
      const limit = max == null ? 10 : max
      let n = 0
      while (s.grain - T.POP.GRAIN_PER_SETTLER >= keepGrain && n < limit) {
        s.grain -= T.POP.GRAIN_PER_SETTLER
        s.pop++
        n++
      }
      return n
    }
    // stoneBudget 给 demo 用（玩家选修多少石）；模拟里不传 = 有多少石修多少
    function repair(s, stoneBudget) {
      const missing = T.WALL.HP - s.wallHP
      if (missing <= 0) return 0
      const budget = stoneBudget == null ? s.stone : Math.min(s.stone, stoneBudget)
      const stones = Math.min(budget, Math.ceil(missing / T.WALL.REPAIR_HP_PER_STONE))
      s.stone -= stones
      // 取整会让修复量越过缺口（缺口10 / 8 = 2石 = 16点），必须 clamp，否则墙会显示 606/600
      s.wallHP = Math.min(T.WALL.HP, s.wallHP + stones * T.WALL.REPAIR_HP_PER_STONE)
      return stones
    }
    // [v0.7] 开仓放粮：民意唯一主动回复手段——粮的第4个出口（招人/修墙/护城之外还要买人心）
    // threshold 传 Infinity = 玩家手动强制放粮（demo 按钮）；模拟传风格的心理阈值
    function openGranary(s, threshold, keepGrain) {
      const M = T.MORALE
      if (s.morale < threshold && s.grain >= keepGrain + M.GRANARY_COST_GRAIN) {
        s.grain -= M.GRANARY_COST_GRAIN
        s.morale = Math.min(M.MAX, s.morale + M.GRANARY_GAIN)
        s.granaries++
        s.log.push(`开仓放粮：-${M.GRANARY_COST_GRAIN} 斛粮 → 民心 +${M.GRANARY_GAIN}`)
        return true
      }
      return false
    }

    // ———— 敌情 ————
    function enemyPhase(s, t) {
      const R = T.RAID
      const A = T.ASSAULT
      const idx = R.TURNS.indexOf(t)
      if (idx >= 0) {
        const riders = Math.round(jit(R.RIDERS[idx]))
        let atk = riders * R.ATK_PER_RIDER
        s.log.push(`敌情：游骑 ${riders} 骑（攻击力 ${r1(atk)} 点）　我方防御力 ${r1(defensePower(s))} 点`)
        // [v0.6] 火攻：敌情前决定，16油换敌攻×0.65且免疫烧田（保引擎不保库存）
        const fired = s.fire && s.oil >= T.OIL.FIRE_COST
        if (fired) {
          s.oil -= T.OIL.FIRE_COST
          s.fires++
          atk *= T.OIL.FIRE_ATK_MULT
          s.log.push(`火攻点燃：-${T.OIL.FIRE_COST} 桶火油 → 敌军攻击力降至 ${r1(atk)} 点，农田免疫焚烧`)
        }
        const gap = atk - defensePower(s)
        if (gap > 0) {
          const dmg = gap * R.WALL_DMG_SHARE
          s.wallHP -= dmg
          const stolen = Math.min(s.grain, riders * R.GRAIN_STEAL_PER_RIDER)
          s.grain -= stolen
          s.breached = true // [v0.7] 破防标记→民意-10
          s.log.push(`⚠ 防线被撕开：城墙 -${r1(dmg)} 耐久，粮被抢 -${r1(stolen)} 斛`)
          // [v0.5] 烧田：惩罚打在生产引擎上——但烧空不赶尽杀绝，至少留1块地让人有翻盘路
          // [v0.6] 火攻成功则田保住——"修墙护田"之外多了"烧油护田"这条主动解
          if (s.fields.length > 1 && R.BURN_FIELDS > 0 && !fired) {
            const burn = Math.min(R.BURN_FIELDS, s.fields.length - 1)
            s.fields.splice(Math.floor(Math.random() * s.fields.length), burn)
            s.burnedCount += burn
            s.log.push(`⚠ ${burn} 块田被焚（下回合起停产）`)
          }
        } else {
          s.log.push(`防线正面挡下，防御力富余 ${r1(-gap)} 点`)
        }
      }
      if (t === A.TURN) {
        const riders = Math.round(jit(A.RIDERS))
        // [v0.6] 火油倾泻：剩余油一次性折算防御，油在终局永远有用（尾部 sink）
        const dumped = Math.min(s.oil, T.OIL.ASSAULT_CAP)
        const dump = (dumped / 10) * T.OIL.ASSAULT_PER10
        s.oil = 0
        if (dumped > 0) s.log.push(`总攻倾泻：${r1(dumped)} 桶火油 → 防御力 +${r1(dump)} 点`)
        s.margin = defensePower(s) + dump - riders * A.ATK_PER_RIDER
        s.log.push(
          `总攻：${riders} 骑（攻击力 ${r1(riders * A.ATK_PER_RIDER)} 点）　我方防御力 ${r1(defensePower(s) + dump)} 点　富余 ${r1(s.margin)} 点`
        )
        if (s.margin >= 0) return 'clean' // 防线正面扛住
        s.wallHP -= -s.margin * A.WALL_DMG_SHARE // 被撕开口子，看血条够不够厚
        return s.wallHP > 0 ? 'barely' : 'lose'
      }
      return null
    }

    // ———— 民意结算 [v0.7]（每回合末，敌情之后）————
    // 顺序设计：衰减/丰年/事件惩罚 → 阶段二治安（逃亡+劫粮）→ 阶段三起义 → 清事件标记
    function moralePhase(s) {
      const M = T.MORALE
      let m = s.morale
      m -= M.DECAY_PER_TURN // 乱世被动衰减：背景压力
      if (s.grain >= s.pop * M.WELL_FED_SURPLUS) m += M.WELL_FED_GAIN // 仓廪实
      if (s.starved) m -= M.STARVE_HIT // 断粮：民变第一因
      if (s.breached) m -= M.BREACH_HIT // 破防：人心浮动
      m -= s.burnedCount * M.BURN_HIT // 烧田：口粮来源被端
      s.morale = Math.min(M.MAX, m)

      const parts = [`民意 ${r1(s.morale)}（衰减 -${M.DECAY_PER_TURN}`]
      if (s.grain >= s.pop * M.WELL_FED_SURPLUS) parts.push(`丰年 +${M.WELL_FED_GAIN}`)
      if (s.starved) parts.push(`断粮 -${M.STARVE_HIT}`)
      if (s.breached) parts.push(`破防 -${M.BREACH_HIT}`)
      if (s.burnedCount) parts.push(`烧田 -${s.burnedCount * M.BURN_HIT}`)
      s.log.push(parts.join('　') + '）')

      // 阶段二：治安恶化——飞轮倒转（人口逃亡）+ 库存税（流民劫粮）
      if (s.morale < M.STAGE2_MORALE) {
        const gone = Math.ceil(s.pop * M.DESERT_PCT)
        s.pop -= gone
        const loot = Math.min(s.grain, Math.round(s.pop * M.BANDIT_PER_POP))
        s.grain -= loot
        s.log.push(`⚠ 治安恶化（民意 <${M.STAGE2_MORALE}）：${gone} 人逃亡，流民劫粮 -${r1(loot)}`)
      }
      // 阶段三：农民起义——自家人口变成第4波敌情，打自家防御
      if (s.morale < M.UPRISING_MORALE) {
        s.uprisings++
        const rebelAtk = s.pop * M.REBEL_ATK_PER_POP
        const gap = rebelAtk - defensePower(s)
        const dead = Math.ceil(s.pop * M.REBEL_POP_LOSS_PCT)
        s.pop -= dead // 起义必损人，无论成败
        s.log.push(`💀 农民起义（民意 <${M.UPRISING_MORALE}）：${s.pop + dead} 人造反，攻 ${r1(rebelAtk)}`)
        if (gap > 0) {
          const dmg = gap * M.REBEL_WALL_DMG_SHARE
          s.wallHP -= dmg
          s.log.push(`⚠ 起义军冲击城墙 -${r1(dmg)}`)
          if (s.fields.length > 1 && M.REBEL_BURN_FIELDS > 0) {
            const burn = Math.min(M.REBEL_BURN_FIELDS, s.fields.length - 1)
            s.fields.splice(Math.floor(Math.random() * s.fields.length), burn)
            s.log.push(`⚠ 起义中 ${burn} 块田被焚`)
          }
        }
        s.morale = M.AFTER_UPRISING_MORALE // 怨气随流血释放：留爬回来的路，也可能连环起义
        s.log.push(`起义平息，民意重置为 ${M.AFTER_UPRISING_MORALE}，死伤 ${dead} 人`)
      }
      s.starved = s.breached = false
      s.burnedCount = 0
      return s.wallHP <= 0 ? 'lose' : null // 被自家起义军砸塌城墙也算输
    }

    return {
      TUNING: T,
      jitter,
      jit,
      newState,
      defensePower,
      produce,
      tryBuild,
      buySettlers,
      repair,
      openGranary,
      enemyPhase,
      moralePhase,
    }
  }

  const API = { createEngine, TUNING: T }
  if (typeof module !== 'undefined' && module.exports) module.exports = API
  else global.Engine = API
})(typeof window !== 'undefined' ? window : globalThis)
