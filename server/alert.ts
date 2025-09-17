import { Telegraf } from "telegraf";
import axios from "axios";

const bot = new Telegraf("7887692704:AAE9g8oEGMB-REyHu7ZITvzrVLOG10f11Mc");

bot.use((ctx, next) => {
  console.log(ctx.message);
  return next();
});

const ids = [1520778961];

const CHECK_INTERVAL = 30_000; // 30s
const AUTO_RESUME_DELAY = 60 * 60 * 1000; // 1 hour

const ENDPOINTS = [
  "http://localhost:4000/health",
  "http://localhost:4000",
  "http://localhost:4001/api/v1/status",
];

let monitoring = true;
let alerting = false;
let stopTimestamp: number | null = null;

async function checkEndpoints() {
  if (!monitoring) return;

  try {
    for (const url of ENDPOINTS) {
      const res = await axios.get(url, { timeout: 6000 });

      if (res.status !== 200) {
        await sendAlert(`${url} returned status ${res.status}`);
      } else if (url.includes("/health") && res.data?.status !== "healthy") {
        await sendAlert(`${url} unhealthy: ${JSON.stringify(res.data)}`);
      } else if (url.includes("/status") && !res.data?.is_running) {
        await sendAlert(`${url} matching engine is not running`);
      }
    }
  } catch (err: any) {
    await sendAlert(`Something is down. Endpoint check failed: ${err.message}`);
  }
}

async function sendAlert(message: string) {
  if (!alerting) {
    alerting = true;
    const interval = setInterval(async () => {
      if (!alerting) {
        clearInterval(interval);
        return;
      }
      await bot.telegram.sendMessage(ids[0], message);
    }, 15_000); // send every 15s until stopped
  }
}

setInterval(async () => {
  if (stopTimestamp && Date.now() - stopTimestamp >= AUTO_RESUME_DELAY) {
    try {
      const results = await Promise.all(
        ENDPOINTS.map((url) => axios.get(url, { timeout: 6000 }))
      );

      const allHealthy = results.every(
        (res, i) =>
          res.status === 200 &&
          (!ENDPOINTS[i].includes("/health") || res.data?.status === "healthy")
      );

      if (allHealthy) {
        monitoring = true;
        stopTimestamp = null;
        await bot.telegram.sendMessage(
          ids[0],
          "Monitoring resumed automatically after 1 hour of stop (all endpoints healthy)."
        );
      }
    } catch {
      // If still unhealthy, keep waiting.
    }
  }
}, 60_000);

bot.start((ctx) => ctx.reply("Monitoring bot started"));

bot.command("status", (ctx) =>
  ctx.reply(`Monitoring: ${monitoring ? "ON" : "OFF"} | Alerting: ${alerting}`)
);

bot.command("stop", (ctx) => {
  alerting = false;
  stopTimestamp = Date.now();
  ctx.reply("Alerts stopped");
});

bot.command("resume", (ctx) => {
  monitoring = true;
  stopTimestamp = null;
  ctx.reply("Monitoring resumed");
});

bot.command("pause", (ctx) => {
  monitoring = false;
  ctx.reply("Monitoring paused");
});

bot.command("health", async (ctx) => {
  try {
    const res = await axios.get("http://localhost:4000/health", {
      timeout: 6000,
    });
    const data = res.data;

    const msg = `
Status: ${data.status}
Timestamp: ${data.timestamp}
Uptime: ${data.uptime.toFixed(2)}s

Memory:
- RSS: ${(data.memory.rss / 1024 / 1024).toFixed(2)} MB
- Heap Total: ${(data.memory.heapTotal / 1024 / 1024).toFixed(2)} MB
- Heap Used: ${(data.memory.heapUsed / 1024 / 1024).toFixed(2)} MB
- External: ${(data.memory.external / 1024 / 1024).toFixed(2)} MB
- Array Buffers: ${(data.memory.arrayBuffers / 1024).toFixed(2)} KB

Metrics:
- Total Requests: ${data.metrics.totalRequests}
- Successful Fills: ${data.metrics.successfulFills}
- Failed Fills: ${data.metrics.failedFills}
- Successful Expires: ${data.metrics.successfulExpires}
- Failed Expires: ${data.metrics.failedExpires}
- Avg Response Time: ${data.metrics.averageResponseTime.toFixed(2)} ms
- Last Activity: ${data.metrics.lastActivity}
`;

    await ctx.reply(msg);
  } catch (err: any) {
    await ctx.reply(`Failed to fetch health: ${err.message}`);
  }
});

bot.command("info", async (ctx) => {
  try {
    // Collect data only from the new endpoints
    const [statusRes, pairsRes] = await Promise.all([
      axios.get("http://localhost:4001/api/v1/status", { timeout: 6000 }),
      axios.get("http://localhost:4001/api/v1/pairs", { timeout: 6000 }),
    ]);

    const status = statusRes.data;
    const pairs = pairsRes.data;

    const msg = `
=== Status ===
Running: ${status.is_running ? "Yes" : "No"}
Total Orders: ${status.total_orders}
Total Pairs: ${status.total_pairs}

=== Pairs ===
${pairs.length > 0 ? pairs.join("\n") : "No pairs"}
`;

    await ctx.reply(msg);
  } catch (err: any) {
    await ctx.reply(`Failed to fetch info: ${err.message}`);
  }
});

setInterval(checkEndpoints, CHECK_INTERVAL);

bot.telegram.setMyCommands([
  { command: "status", description: "Show monitoring status" },
  { command: "stop", description: "Stop alerts" },
  { command: "resume", description: "Resume monitoring" },
  { command: "pause", description: "Pause monitoring" },
  { command: "health", description: "Show /health endpoint data" },
  { command: "info", description: "Show status + pairs info" },
]);

bot.launch();
