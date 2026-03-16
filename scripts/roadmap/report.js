const { computeRoadmapProgress } = require("./engine");

const args = new Set(process.argv.slice(2));

const result = computeRoadmapProgress();

if (args.has("--json")) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const pad = (value, width) => `${value}`.padEnd(width, " ");
const formatPercent = (value) => `${value}%`.padStart(4, " ");

if (args.has("--debug")) {
  console.log("CorePOS Roadmap Progress");
  console.log(`Generated: ${result.generatedAt}`);
  console.log("");
  for (const phase of result.phases) {
    console.log(`${phase.name} — ${phase.percent}% (${phase.statusHint})`);
    for (const item of phase.items) {
      console.log(`  - ${item.label}: ${item.status} (${item.note}) [weight ${item.weight}]`);
      for (const signal of item.matchedSignals) {
        console.log(`      [x] ${signal.label} — ${signal.evidence}`);
      }
      for (const signal of item.unmatchedSignals) {
        console.log(`      [ ] ${signal.label} — ${signal.evidence}`);
      }
    }
    console.log("");
  }

  console.log(`Source LOC: ${result.loc.lineCount.toLocaleString()} lines across ${result.loc.fileCount} files`);
  console.log(`Overall completion: ${result.overallPercent}%`);
  process.exit(0);
}

console.log("CorePOS Roadmap Progress");
console.log("");
console.log(`${pad("Phase", 44)} ${pad("Complete", 9)} Status`);
console.log(`${"-".repeat(44)} ${"-".repeat(9)} ${"-".repeat(20)}`);

for (const phase of result.phases) {
  console.log(`${pad(phase.name, 44)} ${pad(formatPercent(phase.percent), 9)} ${phase.statusHint}`);
}

console.log("");
console.log(`Source LOC: ${result.loc.lineCount.toLocaleString()} lines across ${result.loc.fileCount} files`);
console.log(`Overall completion: ${result.overallPercent}%`);
console.log("Use `npm run roadmap:json` or `npm run roadmap -- --debug` for item-level evidence.");
