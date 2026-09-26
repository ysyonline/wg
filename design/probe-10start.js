// probe-10start.js —— 单局确定性复现（jitter off），看均衡流死在哪天、为什么
// 跑法: node probe-10start.js
const { createEngine, TUNING } = require('./engine-v2.js')
const E = createEngine({ jitter: false })

const ORDER = ['sha', 'hui', 'huang']
const maxDigTier = (s) => ORDER[s.workshopLv - 1]

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
function crewTo(s, reserve) {
  const want = E.crewNeeded(s) + reserve
  if (s.sol < want) E.recruit(s, want - s.sol)
}
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
function granaryLever(s) {
  if (s.morale < 40 && s.grain >= 80) E.openGranary(s)
}
const canTower = (s) => s.wood >= TUNING.TOWER.COST_WOOD && s.iron >= TUNING.TOWER.COST_IRON
const canBallista = (s) => s.wood >= TUNING.BALLISTA.COST_WOOD && s.iron >= TUNING.BALLISTA.COST_IRON

// 均衡流（与 simulate-v2 同步）
function 均衡流(s) {
  const d = s.day
  const parts = s.workshopLv < 2
    ? { farm: 0.4, wood: 0.3, stone: 0.3, digTier: 'sha' }
    : d < 55
      ? { farm: 0.4, wood: 0.25, stone: 0.05, iron: 0.15, digTier: 'hui' }
      : { farm: 0.25, wood: 0.2, stone: 0, iron: 0.15, digTier: 'hui' }
  E.dayTick(s, alloc(s, parts))
  if (s.workshopLv < 2) {
    E.upgradeWorkshop(s)
    if ([30, 45, 60, 90].some((t) => d > t - 5 && d <= t)) crewTo(s, 1)
    smartRepair(s)
    granaryLever(s)
    return
  }
  if (s.workshopLv < 3 && d >= 55 && s.earth.hui >= 20) E.upgradeWorkshop(s)
  const wantT = d >= 60 ? 4 : d >= 45 ? 3 : 2
  const wantB = d >= 45 ? 2 : 1
  if (s.ballistas < wantB && canBallista(s)) E.buildBallista(s)
  else if (s.towers < wantT && canTower(s)) E.buildTower(s)
  if (s.towers >= 2 && s.fields.length < 5) E.buildField(s, s.fields.length % 2 ? 'ma' : 'su')
  if ([30, 45, 60, 90].some((t) => d > t - 5 && d <= t)) crewTo(s, 1)
  smartRepair(s)
  granaryLever(s)
}

const s = E.newState()
let lastLogLen = 0
for (let d = 1; d <= TUNING.TIME.DAYS; d++) {
  均衡流(s)
  const r = E.battle(s, d)
  // 关键节点打印：每 10 天 + 敌情日 + 有事件的天
  const isKey = d % 10 === 0 || r !== null || s.log.length > lastLogLen + 2
  if (isKey) {
    console.log(`— D${d} 粮${Math.round(s.grain)} 木${Math.round(s.wood)} 石${Math.round(s.stone)} 铁${Math.round(s.iron)} 土[砂${Math.floor(s.earth.sha)}/灰${Math.floor(s.earth.hui)}/黄${Math.floor(s.earth.huang)}] 民${s.civ} 兵${s.sol} 墙${Math.round(s.wallHP)}/${E.wallCap(s)}(${s.wallTier}) 民心${Math.round(s.morale)} 坊${s.workshopLv} 田${s.fields.length} 塔${s.towers} 弩${s.ballistas}`)
    for (let i = lastLogLen; i < s.log.length; i++) console.log('   ' + s.log[i])
  }
  lastLogLen = s.log.length
  if (r === 'lose') { console.log(`💀 第 ${d} 天城破`); break }
  if (s.civ <= 0) { console.log(`💀 第 ${d} 天人跑光`); break }
}
console.log('END day=' + s.day)
