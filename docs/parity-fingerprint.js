// Page fingerprint: what a user can actually see and do on this screen.
// Run in the page after it settles. Deliberately ignores the sidebar/chrome so
// two apps with different shells stay comparable.
(() => {
  const main = document.querySelector('main') ?? document.body
  const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim()
  const uniq = (a) => [...new Set(a.filter(Boolean))]
  const short = (s) => s && s.length <= 42

  const headings = uniq([...main.querySelectorAll('h1,h2,h3,h4')].map(txt).filter(short))
  const tabs = uniq([...main.querySelectorAll('[role=tab]')].map(txt).filter(short))
  const buttons = uniq([...main.querySelectorAll('button')].map(txt).filter(short))
  const labels = uniq([...main.querySelectorAll('label')].map(txt).filter(short))
  const inputs = main.querySelectorAll('input,select,textarea').length
  const placeholders = uniq(
    [...main.querySelectorAll('input,textarea')].map((e) => e.getAttribute('placeholder')).filter(short),
  )
  const columns = uniq([...main.querySelectorAll('th')].map(txt).filter(short))
  const steps = uniq((main.innerText.match(/Step \d[^\n]{0,40}/g) || []))

  return {
    url: location.pathname,
    headings,
    tabs,
    steps,
    labels,
    placeholders,
    columns,
    buttons,
    counts: { inputs, buttons: buttons.length, labels: labels.length },
  }
})()
