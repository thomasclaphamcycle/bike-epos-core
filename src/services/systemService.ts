import * as fs from "node:fs";
import * as path from "node:path";

type PackageJsonShape = {
  version?: string;
};

const packageJsonPath = path.join(process.cwd(), "package.json");

const readPackageVersion = () => {
  const raw = fs.readFileSync(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as PackageJsonShape;
  return parsed.version || "0.0.0";
};

export const getRuntimeVersionInfo = () => {
  const version = readPackageVersion();

  return {
    app: {
      version,
      label: `v${version}`,
    },
  };
};
