// Module loader hook: resolves the bare specifiers that OpenCode's runtime
// normally remaps to our local stubs so the plugin can be imported under node.
const STUBS = {
  "@opentui/solid": new URL("./stubs/opentui-solid.mjs", import.meta.url).href,
  "solid-js": new URL("./stubs/solid-js.mjs", import.meta.url).href,
}

export function resolve(specifier, context, nextResolve) {
  const stub = STUBS[specifier]
  if (stub) return { url: stub, shortCircuit: true }
  return nextResolve(specifier, context)
}
