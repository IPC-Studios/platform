/**
 * Page fingerprint: what a user can actually see and do on this screen.
 *
 * Paste into the console (or inject) on each app, then walk the routes.
 *
 * Reads accessible names, not just visible text. The first version of this
 * read `<label>` textContent and `<button>` textContent, which systematically
 * under-detected OUR app and invented gaps that did not exist: our filters are
 * labelled with `aria-label` and our row actions are icon-only buttons, so a
 * screen with search, date filters, view, edit and delete fingerprinted as
 * having none of them.
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

  return {
    tabs: uniq([...main.querySelectorAll('[role=tab]')].map((e) => clean(e.textContent)).filter(ok)),
    steps: uniq(main.innerText.match(/Step \d[^\n]{0,44}/g) || []),
    // Field names however they are labelled.
    fields: uniq(controls.map(accName).filter(ok)),
    cols: uniq([...main.querySelectorAll('th')].map((e) => clean(e.textContent)).filter(ok)),
    // Actions, including icon-only ones.
    actions: uniq(buttons.map(accName).filter(ok)),
    opts: uniq([...main.querySelectorAll('option')].map((e) => clean(e.textContent)).filter(ok)).slice(0, 30),
  }
}
