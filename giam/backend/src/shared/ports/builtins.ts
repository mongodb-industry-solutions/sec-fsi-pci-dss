/**
 * Registers the implementations GIAM ships with.
 *
 * Called once at boot, and again by tests that need a clean registry. Nothing here reads an
 * environment variable to decide WHICH implementation to use: it registers all of them by name, and
 * a realm or resource server record names the one it wants. That is the difference between a port and
 * a switch statement with extra steps.
 *
 * A port with no entry here is declared and not yet delivered, and PORT_DELIVERY records which phase
 * owns it. It is absent rather than faked: resolving it refuses and says what is missing.
 */
export function registerBuiltinPorts(): void {
  // Implementations register with the phase that delivers them.
}
