import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Phase 13B — recursion guard for the automation engine.
 *
 * Automation actions call the normal conversation/messaging services
 * (assign, resolve, tag, send), and those services fire automation
 * hooks. Without a guard, a rule like "on assign → assign" would loop
 * forever. While the engine executes a rule's actions, this context is
 * active and every hook checks it and skips — automation-caused events
 * never trigger more automation.
 */
const storage = new AsyncLocalStorage<boolean>();

export function inAutomation(): boolean {
  return storage.getStore() === true;
}

export async function runInAutomation<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run(true, fn);
}
