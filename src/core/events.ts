type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

const listeners = new Map<string, Set<EventHandler>>();

export const emit = (eventName: string, payload: unknown) => {
  const handlers = listeners.get(eventName);
  if (!handlers || handlers.size === 0) {
    return;
  }

  for (const handler of [...handlers]) {
    void Promise.resolve()
      .then(() => handler(payload))
      .catch(() => {
        // Event handlers are intentionally isolated from the main app flow.
      });
  }
};

export const on = <T = unknown>(eventName: string, handler: EventHandler<T>) => {
  const set = listeners.get(eventName) ?? new Set<EventHandler>();
  set.add(handler as EventHandler);
  listeners.set(eventName, set);

  return () => {
    const current = listeners.get(eventName);
    if (!current) {
      return;
    }
    current.delete(handler as EventHandler);
    if (current.size === 0) {
      listeners.delete(eventName);
    }
  };
};
