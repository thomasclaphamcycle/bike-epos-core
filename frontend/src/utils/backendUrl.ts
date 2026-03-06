export const getBackendOrigin = () => {
  if (import.meta.env.DEV) {
    return "http://localhost:3000";
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
