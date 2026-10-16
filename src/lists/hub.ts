type Listener = (seq: number) => void;

const channels = new Map<string, Set<Listener>>();
const MAX_LISTENERS = 100;

/** In-process fan-out for one list. Polling still works across processes. */
export function subscribeList(shareTokenHash: string, listener: Listener): (() => void) | null {
  let listeners = channels.get(shareTokenHash);
  if (!listeners) {
    listeners = new Set();
    channels.set(shareTokenHash, listeners);
  }
  if (listeners.size >= MAX_LISTENERS) {
    return null;
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners && listeners.size === 0) {
      channels.delete(shareTokenHash);
    }
  };
}

export function publishList(shareTokenHash: string, seq: number): void {
  const listeners = channels.get(shareTokenHash);
  if (!listeners) {
    return;
  }
  for (const listener of listeners) {
    listener(seq);
  }
}
