import { useEffect, useState } from "react";
import { getSystemVersion } from "../api/system";

const DEFAULT_VERSION_LABEL = "v...";
const VERSION_ERROR_LABEL = "v?";

let cachedVersionLabel: string | null = null;

export const useRuntimeVersionLabel = () => {
  const [versionLabel, setVersionLabel] = useState(cachedVersionLabel ?? DEFAULT_VERSION_LABEL);

  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      try {
        const payload = await getSystemVersion();
        cachedVersionLabel = payload.app.label;
        if (!isCancelled) {
          setVersionLabel(payload.app.label);
        }
      } catch {
        if (!cachedVersionLabel && !isCancelled) {
          setVersionLabel(VERSION_ERROR_LABEL);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, []);

  return versionLabel;
};
