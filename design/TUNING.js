// TUNING.js —— 长城守城 · 全游戏唯一数字来源 v0.5-paper（模拟校准版）
// 纪律：
//   1) demo 与模拟脚本只从这里读数，代码里不允许出现第二个数字；
//   2) 每个数字必须带 rationale，未经 playtest / 模拟验证的一律标 [PLACEHOLDER]；
//   3) 改手感只改这里，改完跑 `node simulate.js` 验证数学，再刷新 demo 看手感。

const TUNING = {
  VERSION: '0.7-paper',

  // —— 时间结构 ——
  TURN_DAYS: 10,        // 一回合=10天：6回合一局，目标单局≤15分钟（中度策略节奏）
  TOTAL_TURNS: 6,

  // —— 初始资源 [PLACEHOLDER·待模拟] ——
  START: {
    GRAIN: 300,   // 够约3回合口粮（30人×2/回合），余量给开局第一个决策留余地
    WOOD: 300,    // 够 1箭塔+1田+半座民居：开局就得做取舍
    STONE: 150,
    IRON: 40,
    FIELDS: 2,
    POP: 30,
  },

  // —— 人口与粮食闭环 ——
  POP: {
    EAT_PER_TURN: 2,       // 每人每回合吃2粮 [PLACEHOLDER]：让粮是硬约束但不至于开局就饿
    GRAIN_PER_SETTLER: 20, // 招1居民=20粮：农业流的生命线——种田盈余→人口→更多工人
    // 民居/房屋系统模拟v0.1未启用（纸面版把住房成本折叠进招人粮价），demo阶段再开
    HOUSE_COST_WOOD: 60,
    POP_PER_HOUSE: 5,
  },

  // —— 生产 [PLACEHOLDER] ——
  FIELD: {
    COST_WOOD: 40,          // 开田造价 ≈ 一回合伐木结余：扩张节奏约1田/回合
    WORK_CAP: 4,            // 每田至多4人，超编无效：逼玩家开新田而不是往一块田堆人
    YIELD_SU_GRAIN: 120,    // 粟田满员每回合产粮：主粮，喂人口循环
    YIELD_MA_GRAIN: 40,     // 麻田产粮少
    YIELD_MA_IRON: 12,      // 麻田产铁（经济作物换军费）：铁是弩炮瓶颈，农业流的自救口
  },
  WORKER: {
    WOOD: 8,    // 伐木工每人每回合 [PLACEHOLDER]
    STONE: 5,   // 采石工
    IRON: 5,    // 采矿工 [校准v0.1] 3→5：铁瓶颈太死会卡住军备流上限，摸不到弩炮
  },

  // —— 城防 [PLACEHOLDER·核心待模拟验证] ——
  WALL: {
    HP: 600,                // 城墙耐久：是血条也是盾（按 WALL_DEF_SHARE 折算防御）
    REPAIR_HP_PER_STONE: 8, // 1石修8耐久：修城是持续税，采矿人力不能全挪去种田
  },
  TOWER:    { COST_WOOD: 60, COST_IRON: 10, DEF: 100 }, // 箭塔：便宜量大的基础防御
  BALLISTA: { COST_WOOD: 40, COST_IRON: 30, DEF: 260 }, // 弩炮：吃铁的高级防御
  WALL_DEF_SHARE: 0.25,   // 耐久→防御力的折算系数

  // —— 敌情 [PLACEHOLDER·第一优先验证对象] ——
  RAID: {
    TURNS: [2, 3, 4],
    RIDERS: [25, 40, 60],         // 游骑规模逐次升级
    ATK_PER_RIDER: 10,            // 袭扰性强：单骑威胁高但总量小
    GRAIN_STEAL_PER_RIDER: 2,     // 防不住就抢粮：逼农业流也要关心墙
    BURN_FIELDS: 1,               // [v0.5] 防不住再烧1块田（下回合停产）：惩罚打在生产引擎上而非库存——"修墙护田"从此有看得见的回报，开田时机变成风险决策
    WALL_DMG_SHARE: 0.2,          // 攻防差值→城墙损伤的转化率
  },
  ASSAULT: {
    TURN: 6,
    RIDERS: 430,          // 总攻atk≈1720 [校准v0.4] 380→430：让缺口逼近“墙血+修墙”的兜底上限，防御不足的风格开始真死
    ATK_PER_RIDER: 4,     // 总攻是消耗战：单骑威胁低靠数量堆
    WALL_DMG_SHARE: 1.0,  // [校准v0.3] 0.4→1.0：防御差多少、墙就掉多少血——600血墙最多扛600缺口，裸墙必死
  },

  // —— 民意 [v0.7 新系统·PLACEHOLDER] ——
  // 设计意图：民意是人口飞轮的手刹。招人滚雪球曾是模拟里的隐性最强引擎且无代价——
  // 民意让"无限招人"变成风险决策：口粮压力→民意下滑→飞轮倒转（逃亡/劫粮）→暴动反噬城防。
  // 三阶段（用户规格）：①产值降低 ②治安恶化 ③农民起义。唯一主动回复=开仓放粮（粮的第4个出口）。
  MORALE: {
    START: 70,              // [PLACEHOLDER] 开局留双向余量：离阶段一(50)有5回合纯衰减余量，离满分留放粮空间
    MAX: 100,
    DECAY_PER_TURN: 4,      // [PLACEHOLDER] 乱世人心惶惶的被动衰减：纯衰减6回合到不了阶段一(70-4*6=46)——被动压力只做背景，推人下坡靠事件
    WELL_FED_SURPLUS: 10,   // 回合结束人均盈余粮≥10 → 仓廪实而知礼节
    WELL_FED_GAIN: 3,       // [PLACEHOLDER] 丰年+3：农业流天然回血，但回不过衰减+事件，放粮仍是刚需
    STARVE_HIT: 25,         // [PLACEHOLDER] 断粮(grain<0)-25：饿肚子是民变第一因，重锤但一回合可恢复
    BREACH_HIT: 10,         // [PLACEHOLDER] 袭扰破防(gap>0)-10：敌人打到家门口，人心浮动
    BURN_HIT: 8,            // [PLACEHOLDER] 每烧1田-8：烧的是全家口粮来源，比单纯破墙更伤人心
    GRANARY_COST_GRAIN: 30, // 开仓放粮价格：≈15人一回合口粮——放粮和招人直接抢粮，这就是核心决策
    GRANARY_GAIN: 10,       // [PLACEHOLDER] 放粮+10，每回合限1次：净+6/回合(10-4衰减)，3回合拉回30点，救火够用但不瞬回
    STAGE1_MORALE: 50,      // 阶段一阈值：产值降低线
    STAGE1_OUTPUT: 0.8,     // [PLACEHOLDER] 全产出×0.8：疼但可逆——警示期，给玩家1-2回合反应窗口
    STAGE2_MORALE: 30,      // 阶段二阈值：治安恶化线
    DESERT_PCT: 0.05,       // [PLACEHOLDER] 每回合逃亡5%人口：直接砍飞轮，人口雪球反向滚动
    BANDIT_PER_POP: 1.5,    // [PLACEHOLDER] 每人被劫1.5粮：库存税，和游骑抢粮同源不同手
    UPRISING_MORALE: 15,    // 阶段三阈值：起义线
    REBEL_ATK_PER_POP: 8,   // [PLACEHOLDER] 起义军每人8攻：对比游骑10攻——自家人没有马但熟悉地形。40人=320攻≈第3波游骑
    REBEL_WALL_DMG_SHARE: 0.5, // [PLACEHOLDER] 起义破防→墙损转化0.5：比总攻(1.0)仁慈——内乱是消耗战不是攻城战
    REBEL_BURN_FIELDS: 1,   // 起义破防烧1田：和外敌同一惩罚语言，学一次就懂
    REBEL_POP_LOSS_PCT: 0.1, // [PLACEHOLDER] 起义必损10%人口(无论成败)：死人不会回来，起义永远真疼
    AFTER_UPRISING_MORALE: 25, // 起义后民意重置到25：怨气随流血释放，给绝境玩家一条爬回来的路（但也可能连环起义）
  },

  // —— 油料 [v0.6 新系统·PLACEHOLDER] ——
  // 设计意图：油是 fun hypothesis 的资源化身——安全时囤油（写剧本），危险时点火（花光积累）。
  // 与铁的分工：铁=常驻防御（弩炮），油=主动技（火攻）+总攻一次性爆发（倾泻）。
  // 简化声明：油坊被动产油、不吃麻田产出也不占人手（避免第三层转换链），demo 阶段先这样，v0.7 再议。
  OIL: {
    PRESS_COST_WOOD: 80,  // [校准v0.6] 60→80：油坊=1.3座箭塔，定位是"基建投资"而非廉价玩具——首轮模拟油把均衡流抬到100%存活、分歧归零FAIL
    PRESS_COST_STONE: 30, // [校准v0.6] 20→30：和修墙抢石更狠，建油坊的当回合墙必然吃亏
    PRESS_MAX: 1,         // demo 限 1 座：油供给有硬上限，杜绝囤积通胀
    OIL_PER_TURN: 8,      // [校准v0.6] 10→8：压火攻保田的经济复利
    FIRE_COST: 16,        // [校准v0.6] 20→16：跟随产油降速，维持"2回合攒一次火攻"的决策节奏
    FIRE_ATK_MULT: 0.65,  // [PLACEHOLDER] 火攻后袭扰敌攻×0.65：疼但不免死，保留资源焦虑
    FIRE_NO_BURN: true,   // 火攻免疫烧田：保引擎不保库存，与 v0.5 烧田同一设计逻辑
    ASSAULT_PER10: 50,    // [校准v0.6] 100→70→50：两轮模拟校准。70时均衡流仍92%存活（分歧7.6pp FAIL）；50让"建油坊"回到投资有回报但不免死的区间。再改必须重跑模拟
    ASSAULT_CAP: 30,      // [PLACEHOLDER] 倾泻上限30油=210防：防油坊沦为必建，改动须重跑模拟复验
  },
}

// 浏览器与 Node 双端共用：demo <script> 直接引入，模拟脚本 require
if (typeof module !== 'undefined') module.exports = TUNING
