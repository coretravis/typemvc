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
