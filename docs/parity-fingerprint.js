/**
 * Page fingerprint: what a user can actually see and do on this screen.
 *
 * Paste into the console (or inject) on each app, then walk the routes.
 *
 * Reads accessible names, not just visible text. An earlier version read
 * `<label>` and `<button>` textContent only, which systematically
 * under-detected OUR app and invented gaps: our filters are labelled with
 * `aria-label` and our row actions are icon-only, so a screen with search,
 * date filters, view, edit and delete fingerprinted as having none of them.
 *
 * It also reads the things a list screen is mostly MADE of — status tags, the
 * stat tiles across the top, and the field labels inside cards — because a
 * screen can have every button and still be missing half of what it tells you.
 */
window.__fp = () => {
  const main = document.querySelector('main') ?? document.body
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
  const uniq = (a) => [...new Set(a.filter(Boolean))]
  const ok = (s) => s && s.length <= 46

  /** The name a screen reader would give this control. */
  const accName = (el) => {
    const aria = el.getAttribute('aria-label')
    if (aria) return clean(aria)
    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const t = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => clean(n.textContent))
        .join(' ')
      if (t) return t
    }
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
      if (lab) return clean(lab.textContent)
    }
    const wrap = el.closest('label')
    if (wrap) return clean(wrap.textContent)
    const title = el.getAttribute('title')
    if (title) return clean(title)
    const ph = el.getAttribute('placeholder')
    if (ph) return clean(ph)
    return clean(el.textContent)
  }

  const controls = [...main.querySelectorAll('input,select,textarea')]
  const buttons = [...main.querySelectorAll('button,[role=button],a[href]')]

  /**
   * Status tags. Both apps render these as small rounded spans; matching on
   * the shape rather than a class name keeps this working across two different
   * design systems.
   */
  const tagish = (el) => {
    if (el.closest('button,a')) return false
    const s = getComputedStyle(el)
    const r = parseFloat(s.borderRadius) || 0
    const fs = parseFloat(s.fontSize) || 16
    const txt = clean(el.textContent)
    if (!txt || txt.length > 28 || txt.includes(' ') === false && txt.length < 2) return false
    if (el.children.length > 1) return false
    const rounded = r >= 8 || s.borderRadius.includes('9999')
    const tinted = s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)'
    return rounded && tinted && fs <= 14
  }
  const tags = uniq([...main.querySelectorAll('span,div')].filter(tagish).map((e) => clean(e.textContent)))

  /**
   * Stat tiles: a short caption with a number under or over it. Captured by
   * the caption, since the number is data.
   */
  const stats = uniq(
    [...main.querySelectorAll('div,section,article')]
      .filter((el) => {
        if (el.children.length < 2 || el.children.length > 4) return false
        const txt = clean(el.textContent)
        return /^[A-Za-z][A-Za-z /&'-]{2,28}[\s₹]*[\d,.₹%]+$/.test(txt)
      })
      .map((el) => clean(el.textContent).replace(/[\s₹]*[\d,.₹%]+$/, '').trim())
      .filter(ok),
  )

  /** Field captions inside cards — <dt>, and the small label above a value. */
  const cardFields = uniq([...main.querySelectorAll('dt')].map((e) => clean(e.textContent)).filter(ok))

  return {
    tabs: uniq([...main.querySelectorAll('[role=tab]')].map((e) => clean(e.textContent)).filter(ok)),
    steps: uniq(main.innerText.match(/Step \d[^\n]{0,44}/g) || []),
    fields: uniq([...controls.map(accName), ...cardFields].filter(ok)),
    cols: uniq([...main.querySelectorAll('th')].map((e) => clean(e.textContent)).filter(ok)),
    actions: uniq(buttons.map(accName).filter(ok)),
    tags,
    stats,
    opts: uniq([...main.querySelectorAll('option')].map((e) => clean(e.textContent)).filter(ok)).slice(0, 30),
  }
}
