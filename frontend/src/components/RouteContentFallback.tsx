import { useEffect, useState } from "react";

const FALLBACK_DELAY_MS = 140;

export const RouteContentFallback = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setVisible(true);
    }, FALLBACK_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <div
      className={visible ? "app-route-fallback app-route-fallback--visible" : "app-route-fallback"}
      aria-live="polite"
      aria-busy="true"
    >
      <div className="app-route-fallback__line app-route-fallback__line--title" />
      <div className="app-route-fallback__line app-route-fallback__line--meta" />
      <div className="app-route-fallback__card-grid">
        <div className="app-route-fallback__card" />
        <div className="app-route-fallback__card" />
        <div className="app-route-fallback__card" />
      </div>
    </div>
  );
};
