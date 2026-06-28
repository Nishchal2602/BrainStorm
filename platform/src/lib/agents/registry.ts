import type { Agent } from './agent'

interface Entry {
  agent: Agent
  enabled: boolean
}

/**
 * Holds the registered agents. Adding a future agent is a one-liner
 * (`register(new FooAgent(deps))`); disabling is `disable(id)`.
 */
export class AgentRegistry {
  private readonly entries = new Map<string, Entry>()

  register(agent: Agent, enabled = true): this {
    if (this.entries.has(agent.id)) {
      throw new Error(`Agent already registered: ${agent.id}`)
    }
    this.entries.set(agent.id, { agent, enabled })
    return this
  }

  unregister(id: string): void {
    this.entries.delete(id)
  }

  enable(id: string): void {
    const e = this.entries.get(id)
    if (e) e.enabled = true
  }

  disable(id: string): void {
    const e = this.entries.get(id)
    if (e) e.enabled = false
  }

  get(id: string): Agent | undefined {
    return this.entries.get(id)?.agent
  }

  all(): Agent[] {
    return [...this.entries.values()].map((e) => e.agent)
  }

  enabled(): Agent[] {
    return [...this.entries.values()].filter((e) => e.enabled).map((e) => e.agent)
  }
}
