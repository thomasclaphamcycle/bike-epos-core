export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

const toErrorMessage = (status: number, payload: unknown) => {
  if (payload && typeof payload === "object") {
    const maybeError = (payload as { error?: unknown }).error;
    if (typeof maybeError === "string") {
      return maybeError;
    }
    if (maybeError && typeof maybeError === "object") {
      const maybeMessage = (maybeError as { message?: unknown }).message;
      if (typeof maybeMessage === "string") {
        return maybeMessage;
      }
    }
  }

  if (status === 401) {
    return "Please log in to continue.";
  }
  if (status === 403) {
    return "You are not authorized for this action.";
  }
  if (status === 404) {
    return "Requested resource was not found.";
  }

  return `Request failed (${status})`;
};

export const apiRequest = async <T>(
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  const headers = new Headers(init.headers ?? {});
  const hasBody = init.body !== undefined && init.body !== null;
  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });

  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw new ApiError(toErrorMessage(response.status, payload), response.status, payload);
  }

  return payload as T;
};

export const apiGet = <T>(path: string) => apiRequest<T>(path);

export const apiPost = <T>(path: string, body?: unknown) =>
  apiRequest<T>(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export const apiPatch = <T>(path: string, body?: unknown) =>
  apiRequest<T>(path, {
    method: "PATCH",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export const apiPut = <T>(path: string, body?: unknown) =>
  apiRequest<T>(path, {
    method: "PUT",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export const apiDelete = <T>(path: string, body?: unknown) =>
  apiRequest<T>(path, {
    method: "DELETE",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export const apiGetBlob = async (path: string): Promise<Blob> => {
  const response = await fetch(path, {
    credentials: "include",
  });

  if (!response.ok) {
    const text = await response.text();
    let payload: unknown = null;

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    throw new ApiError(toErrorMessage(response.status, payload), response.status, payload);
  }

  return response.blob();
};
