const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas");
const ChartDataLabels = require("chartjs-plugin-datalabels");
const { computeRoadmapProgress } = require("./engine");

const result = computeRoadmapProgress();
const outputPath = path.resolve(__dirname, "..", "..", "docs", "roadmap-progress.png");

const labels = result.phases.map((phase) => phase.name);
const data = result.phases.map((phase) => phase.percent);

const width = 1400;
const chartHeight = 120 + (labels.length * 48);
const footerHeight = 72;
const totalHeight = chartHeight + footerHeight;

const chartCanvas = new ChartJSNodeCanvas({
  width,
  height: chartHeight,
  backgroundColour: "white",
  chartCallback: (ChartJS) => {
    ChartJS.register(ChartDataLabels);
  },
});

const configuration = {
  type: "bar",
  data: {
    labels,
    datasets: [
      {
        data,
        backgroundColor: data.map((value) => {
          if (value >= 75) {
            return "#ff7a00";
          }
          if (value >= 40) {
            return "#1e88e5";
          }
          return "#94a3b8";
        }),
        borderRadius: 8,
        barPercentage: 0.72,
        categoryPercentage: 0.8,
      },
    ],
  },
  options: {
    responsive: false,
    indexAxis: "y",
    animation: false,
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: "CorePOS Roadmap Progress",
        color: "#0f172a",
        font: { size: 24, weight: "bold" },
        padding: { top: 12, bottom: 20 },
      },
      subtitle: {
        display: true,
        text: "Computed from routes, pages, services, schema models, and smoke/e2e evidence.",
        color: "#475569",
        font: { size: 13 },
        padding: { bottom: 20 },
      },
      datalabels: {
        anchor: "end",
        align: "right",
        color: "#0f172a",
        formatter: (value) => `${value}%`,
        font: { weight: "bold", size: 12 },
        clamp: true,
      },
    },
    scales: {
      x: {
        min: 0,
        max: 100,
        ticks: {
          color: "#475569",
          callback: (value) => `${value}%`,
        },
        grid: {
          color: "#e2e8f0",
        },
        title: {
          display: true,
          text: "Completion",
          color: "#475569",
          font: { size: 13, weight: "bold" },
        },
      },
      y: {
        ticks: {
          color: "#0f172a",
          font: { size: 12 },
        },
        grid: {
          display: false,
        },
      },
    },
    layout: {
      padding: { left: 12, right: 36, bottom: 8 },
    },
  },
};

(async () => {
  const chartBuffer = await chartCanvas.renderToBuffer(configuration);
  const finalCanvas = createCanvas(width, totalHeight);
  const ctx = finalCanvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, totalHeight);
  const image = await loadImage(chartBuffer);
  ctx.drawImage(image, 0, 0);

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(36, chartHeight);
  ctx.lineTo(width - 36, chartHeight);
  ctx.stroke();

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 15px Arial";
  ctx.textAlign = "left";
  ctx.fillText(`Source LOC: ${result.loc.lineCount.toLocaleString()} lines`, 36, chartHeight + 28);

  ctx.textAlign = "right";
  ctx.fillText(`Overall completion: ${result.overallPercent}%`, width - 36, chartHeight + 28);

  ctx.fillStyle = "#475569";
  ctx.font = "13px Arial";
  ctx.textAlign = "center";
  ctx.fillText(
    "Scoring is derived from the shared roadmap engine and canonical definition file.",
    width / 2,
    chartHeight + 54,
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, finalCanvas.toBuffer("image/png"));
  console.log(`Roadmap chart written to ${path.relative(process.cwd(), outputPath)}`);
})();
