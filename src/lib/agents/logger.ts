/** Minimal injectable logger so agents/orchestrator don't hard-depend on console. */
export interface Logger {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void
}

const PREFIX = '[PM Co-Pilot][agents]'

export const consoleLogger: Logger = {
  debug: (m, d) => (d === undefined ? console.debug(`${PREFIX} ${m}`) : console.debug(`${PREFIX} ${m}`, d)),
  info: (m, d) => (d === undefined ? console.log(`${PREFIX} ${m}`) : console.log(`${PREFIX} ${m}`, d)),
  warn: (m, d) => (d === undefined ? console.warn(`${PREFIX} ${m}`) : console.warn(`${PREFIX} ${m}`, d)),
  error: (m, d) => (d === undefined ? console.error(`${PREFIX} ${m}`) : console.error(`${PREFIX} ${m}`, d)),
}

export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}
