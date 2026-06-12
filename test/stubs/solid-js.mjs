// Test stub for solid-js: a plain non-reactive signal. Getters in props
// re-evaluate on every read, which is all the tests need.
export function createSignal(initial) {
  let value = initial
  const get = () => value
  const set = (next) => {
    value = typeof next === "function" ? next(value) : next
    return value
  }
  return [get, set]
}
