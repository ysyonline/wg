// 临时冒烟脚本（跑完即删）：用最小 DOM stub 在 Node 里真跑一遍 demo 的脚本，
// 目的是抓运行时错误（undefined 变量 / null 引用），语法检查抓不到这些。
const fs = require('fs')
const root = 'D:/code/wg'
const read = (p) => fs.readFileSync(root + '/' + p, 'utf8')

const html = read('demo/index.html')
const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1]).join('\n')
const tun = read('design/TUNING.js')
const eng = read('design/engine.js')

const ctxStub = new Proxy({ createLinearGradient: () => ({ addColorStop() {} }) }, {
  get: (t, k) => (k in t ? t[k] : () => {}),
  set: () => true,
})

function mkEl(id) {
  const el = {
    id, _html: '', textContent: '', className: '', disabled: false, value: '',
    style: {}, onclick: null, scrollTop: 0, scrollHeight: 0, dataset: {},
    width: 960, height: 300,
    classList: { add() {}, remove() {}, contains: () => false },
    getContext: () => ctxStub,
    set innerHTML(v) { this._html = String(v) },
    get innerHTML() { return this._html },
    querySelectorAll(sel) {
      this._cache = this._cache || {}
      const out = []
      if (sel === 'input') {
        const re = /<input[^>]*data-k="([^"]*)"[^>]*value="([^"]*)"/g
        let m
        while ((m = re.exec(this._html))) {
          const k = m[1]
          out.push((this._cache['i' + k] = this._cache['i' + k] || { dataset: { k }, value: m[2], oninput: null }))
        }
      } else {
        const re = /<button[^>]*data-a="([^"]*)"/g
        let m
        while ((m = re.exec(this._html))) {
          const k = m[1]
          out.push((this._cache['b' + k] = this._cache['b' + k] || { dataset: { a: k }, onclick: null }))
        }
      }
      return out
    },
  }
  return el
}

const els = {}
global.document = { getElementById: (id) => (els[id] = els[id] || mkEl(id)) }
// demo 用 window.__NO_ANIM__ 跳过动画；把 window 指向 globalThis，
// 这样 engine.js 挂的 Engine 仍然是可访问的全局对象。
global.window = globalThis
globalThis.__NO_ANIM__ = true

try {
  new Function(tun + '\n' + eng + '\n' + inline)()
} catch (e) {
  console.error('❌ 初始化就抛错：', e.message, '\n', e.stack.split('\n').slice(0, 4).join('\n'))
  process.exit(1)
}

const end = els['end']
const build = els['buildBtns']
const btns = () => build.querySelectorAll('button')
const click = (key) => {
  const b = btns().find((x) => x.dataset.a === key)
  if (!b) return console.log('  (按钮不存在: ' + key + ')')
  if (b.disabled) return console.log('  (按钮禁用: ' + key + ')')
  b.onclick && b.onclick()
}

console.log('— 初始渲染 OK —')
for (let t = 1; t <= 6; t++) {
  // 每回合排几个指令：开田 → 箭塔 → 招人 → 修墙
  click('fsu'); click('tower'); click('set1'); click('fix10')
  console.log(`\n=== 第 ${t} 回合：点了 开田/箭塔/招人/修墙 ===`)
  if (end.disabled) { console.log('  结束回合按钮已禁用（游戏已结束）'); break }
  end.onclick()
  const log = els['log'].innerHTML.replace(/<[^>]+>/g, '\n').split('\n').filter(Boolean)
  console.log(log.slice(-6).map((l) => '  ' + l).join('\n'))
  console.log('  HUD:', els['res'].innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
  console.log('  威胁:', els['threat'].innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}
console.log('\n结局面板:', els['ovTitle'].textContent, '|', els['ovWhy'].textContent)
console.log('统计:', els['ovTable'].innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
console.log('\n✅ 冒烟完成：无运行时异常')
