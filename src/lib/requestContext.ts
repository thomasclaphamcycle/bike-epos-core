import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  requestId: string;
  method: string;
  route: string;
};

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(context: RequestContext, fn: () => T): T =>
  requestContextStorage.run(context, fn);

export const getRequestContext = (): RequestContext | null =>
  requestContextStorage.getStore() ?? null;
