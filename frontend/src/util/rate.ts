// Note(yoochan.kim): Trailing-edge throttle: runs at most once per `ms`, and always delivers the
// final call so a drag that ends between ticks still sends its last value.
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let last = 0;
  let timer: number | undefined;
  let pending: A | null = null;

  const run = (args: A) => {
    last = Date.now();
    fn(...args);
  };

  return (...args: A) => {
    const now = Date.now();
    const remaining = ms - (now - last);
    if (remaining <= 0) {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      run(args);
    } else {
      pending = args;
      if (timer === undefined) {
        timer = window.setTimeout(() => {
          timer = undefined;
          if (pending) {
            const next = pending;
            pending = null;
            run(next);
          }
        }, remaining);
      }
    }
  };
}
