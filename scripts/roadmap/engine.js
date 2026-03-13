const fs = require("fs");
const path = require("path");
const roadmap = require("./definition");

const repoRoot = path.resolve(__dirname, "..", "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const schemaPath = path.join(repoRoot, "prisma", "schema.prisma");

const readCache = new Map();

const readText = (relativePath) => {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!readCache.has(absolutePath)) {
    const value = fs.existsSync(absolutePath)
      ? fs.readFileSync(absolutePath, "utf8")
      : null;
    readCache.set(absolutePath, value);
  }
  return readCache.get(absolutePath);
};

const exists = (relativePath) => fs.existsSync(path.join(repoRoot, relativePath));

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const schemaText = readText(path.relative(repoRoot, schemaPath)) || "";

const evaluateSignal = (signal) => {
  if (signal.type === "fileExists") {
    return {
      matched: exists(signal.path),
      evidence: signal.path,
      label: signal.label,
    };
  }

  if (signal.type === "text") {
    const source = readText(signal.path) || "";
    return {
      matched: source.includes(signal.match),
      evidence: signal.path,
      label: signal.label,
      detail: signal.match,
    };
  }

  if (signal.type === "packageScript") {
    return {
      matched: Boolean(packageJson.scripts?.[signal.script]),
      evidence: "package.json",
      label: signal.label,
      detail: signal.script,
    };
  }

  if (signal.type === "schemaModel") {
    return {
      matched: schemaText.includes(`model ${signal.model} `),
      evidence: "prisma/schema.prisma",
      label: signal.label,
      detail: signal.model,
    };
  }

  throw new Error(`Unsupported roadmap signal type: ${signal.type}`);
};

const scoreItem = (item) => {
  const signalResults = item.signals.map(evaluateSignal);
  const matchedSignals = signalResults.filter((signal) => signal.matched);
  const unmatchedSignals = signalResults.filter((signal) => !signal.matched);
  const matchedCount = matchedSignals.length;

  let score = 0;
  let status = "not_started";
  if (matchedCount >= item.completeAt) {
    score = 1;
    status = "complete";
  } else if (matchedCount >= item.partialAt) {
    score = 0.5;
    status = "partial";
  }

  return {
    id: item.id,
    label: item.label,
    weight: item.weight,
    partialAt: item.partialAt,
    completeAt: item.completeAt,
    matchedCount,
    totalSignals: item.signals.length,
    score,
    status,
    matchedSignals,
    unmatchedSignals,
    note: `${matchedCount}/${item.signals.length} signals matched`,
  };
};

const getPhaseStatusHint = (percent) => {
  if (percent >= 85) {
    return "Broadly implemented";
  }
  if (percent >= 65) {
    return "Advanced";
  }
  if (percent >= 35) {
    return "Partial";
  }
  if (percent > 0) {
    return "Groundwork only";
  }
  return "Not started";
};

const computeSourceLoc = () => {
  const extensions = new Set(roadmap.loc.extensions);
  const excluded = new Set(roadmap.loc.excludeDirectories);
  let fileCount = 0;
  let lineCount = 0;

  const walk = (absoluteDir) => {
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(absoluteDir, entry.name);
      const relativePath = path.relative(repoRoot, absolutePath);

      if (entry.isDirectory()) {
        if (excluded.has(entry.name) || excluded.has(relativePath)) {
          continue;
        }
        walk(absolutePath);
        continue;
      }

      if (!extensions.has(path.extname(entry.name))) {
        continue;
      }

      const contents = fs.readFileSync(absolutePath, "utf8");
      const nonEmptyLines = contents
        .split(/\r?\n/u)
        .filter((line) => line.trim().length > 0).length;

      fileCount += 1;
      lineCount += nonEmptyLines;
    }
  };

  for (const root of roadmap.loc.roots) {
    const absoluteRoot = path.join(repoRoot, root);
    if (fs.existsSync(absoluteRoot)) {
      walk(absoluteRoot);
    }
  }

  return {
    fileCount,
    lineCount,
    roots: roadmap.loc.roots,
    extensions: roadmap.loc.extensions,
  };
};

const computeRoadmapProgress = () => {
  const phaseResults = roadmap.phases.map((phase) => {
    const items = phase.items.map(scoreItem);
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    const earnedWeight = items.reduce((sum, item) => sum + (item.weight * item.score), 0);
    const percent = Math.round((earnedWeight / totalWeight) * 100);

    return {
      id: phase.id,
      name: phase.name,
      percent,
      statusHint: getPhaseStatusHint(percent),
      totalWeight,
      earnedWeight,
      items,
    };
  });

  const totalWeight = phaseResults.reduce((sum, phase) => sum + phase.totalWeight, 0);
  const earnedWeight = phaseResults.reduce((sum, phase) => sum + phase.earnedWeight, 0);
  const overallPercent = Math.round((earnedWeight / totalWeight) * 100);
  const loc = computeSourceLoc();

  return {
    generatedAt: new Date().toISOString(),
    roadmapVersion: roadmap.version,
    sourceDoc: roadmap.sourceDoc,
    scoringModel: {
      itemScores: {
        absent: 0,
        partial: 0.5,
        complete: 1,
      },
      aggregation: "Weighted average of item scores per phase, then weighted average across all phases.",
      explainability: "Each item defines explicit evidence signals and thresholds for partial/complete scoring.",
    },
    loc,
    overallPercent,
    phases: phaseResults,
  };
};

module.exports = {
  computeRoadmapProgress,
};
