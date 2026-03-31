export const getBackendOrigin = () => {
  if (import.meta.env.DEV) {
    return import.meta.env.VITE_API_PROXY_TARGET?.trim() || "http://localhost:3100";
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "";
};

export const toBackendUrl = (path: string) => {
  const origin = getBackendOrigin();
  if (!origin) {
    return path;
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
};
