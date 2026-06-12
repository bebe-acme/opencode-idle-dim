// Test stub for @opentui/solid (the real one only exists inside OpenCode's
// runtime, which remaps the bare import). Preserves property getters so tests
// can re-evaluate reactive props after state changes.
export function createElement(type) {
  return { type, props: {} }
}

export function spread(node, props) {
  Object.defineProperties(node.props, Object.getOwnPropertyDescriptors(props ?? {}))
  return node
}
