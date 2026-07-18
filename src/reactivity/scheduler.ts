export interface Schedulable {
  readonly disposed: boolean;
  run(): void;
}

const pendingEffects = new Set<Schedulable>();
let batchDepth = 0;
let scheduled = false;

export function scheduleEffect(effect: Schedulable): void {
  pendingEffects.add(effect);
  if (batchDepth === 0 && !scheduled) {
    scheduled = true;
    queueMicrotask(flush);
  }
}

export function flush(): void {
  scheduled = false;
  const toRun = [...pendingEffects];
  pendingEffects.clear();
  for (const effect of toRun) {
    if (!effect.disposed) {
      effect.run();
    }
  }
}

/**
 * Runs pending effects until none remain, including effects that a running effect
 * schedules. {@link flush} runs a single generation and an effect scheduled during
 * it queues a fresh microtask, so a cascade where one effect wakes another needs
 * this to settle synchronously. It is what a synchronous test drains with.
 */
export function drain(): void {
  let generations = 0;
  while (pendingEffects.size > 0) {
    flush();
    generations += 1;
    if (generations > 100000) {
      throw new Error(
        '[TypeMVC] Reactive effects did not settle: an effect keeps scheduling another. ' +
          'Check for two effects that each write a signal the other reads, forming a cycle.',
      );
    }
  }
}

/**
 * Groups multiple signal writes so dependent effects run once at the end instead
 * of after each write. Nested `batch` calls flush only when the outermost one
 * completes.
 *
 * @param fn - A function performing one or more signal updates.
 */
export function batch(fn: () => void): void {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0 && pendingEffects.size > 0 && !scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  }
}
