import { Telegraf } from "telegraf";
import axios from "axios";

export const bot = new Telegraf(
  "7887692704:AAE9g8oEGMB-REyHu7ZITvzrVLOG10f11Mc"
);

const ids = [1520778961];

const CHECK_INTERVAL = 30_000; // 30s
const AUTO_RESUME_DELAY = 60 * 60 * 1000; // 1 hour

const ENDPOINTS = [
  "http://localhost:4000",
  "http://localhost:4000/health",
  "http://localhost:4001/api/v1/status",
];

let monitoring = true;
let alerting = false;
let stopTimestamp: number | null = null;
let alertInterval: NodeJS.Timeout | null = null; // Store interval reference
let socket_down_count = 0;

async function checkEndpoints() {
  if (!monitoring) return;

  for (const url of ENDPOINTS) {
    try {
      const res = await axios.get(url, { timeout: 6000 });

      if (res.status !== 200) {
        await sendAlert(`${url} returned status ${res.status}`);
      } else if (url.includes("/health") && res.data?.status !== "healthy") {
        await sendAlert(`${url} unhealthy: ${JSON.stringify(res.data)}`);
      } else if (url.includes("/status")) {
        const statusChecks = [
          {
            key: "is_running",
            message: "The matching engine appears to be down.",
          },
          {
            key: "logs_socket_running",
            message: "The logs socket appears to be down.",
          },
          {
            key: "pyth_running",
            message: "The pyth service appears to be down.",
          },
          {
            key: "jup_running",
            message: "The jup service appears to be down.",
          },
        ];

        for (const check of statusChecks) {
          if (check.key === "logs_socket_running") {
            if (!res.data?.logs_socket_running) {
              socket_down_count++;
              if (socket_down_count > 10) {
                await sendAlert(
                  `Endpoint ${url} is not running. ${check.message}`
                );
                break;
              }
            } else {
              socket_down_count = 0;
            }
          } else if (!res.data?.[check.key]) {
            await sendAlert(`Endpoint ${url} is not running. ${check.message}`);
            break;
          }
        }
      }
    } catch (err: any) {
      await sendAlert(
        `Something is down. Endpoint check failed for ${url}. Error Message: ${err.message}`
      );
      console.log(err);
    }
  }
}

async function sendAlert(message: string) {
  // Don't send alerts if monitoring is stopped
  if (!monitoring) return;

  if (!alerting) {
    alerting = true;

    // Send the first alert immediately
    await bot.telegram.sendMessage(ids[0], message);

    // Then send every 1 minute
    alertInterval = setInterval(async () => {
      if (!alerting || !monitoring) {
        stopAlerting();
        return;
      }
      await bot.telegram.sendMessage(ids[0], message);
    }, 60 * 1000);
  }
}

function stopAlerting() {
  alerting = false;
  if (alertInterval) {
    clearInterval(alertInterval);
    alertInterval = null;
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
  monitoring = false;
  stopAlerting();
  stopTimestamp = Date.now();
  ctx.reply("Monitoring and alerts stopped");
});

bot.command("resume", (ctx) => {
  monitoring = true;
  stopAlerting();
  stopTimestamp = null;
  socket_down_count = 0; // Reset counter
  ctx.reply("Monitoring resumed");
});

bot.command("pause", (ctx) => {
  monitoring = false;
  stopAlerting();
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
Logs Socket Running: ${status.logs_socket_running ? "Yes" : "No"}
Pyth Running: ${status.pyth_running ? "Yes" : "No"}
JUP Running: ${status.jup_running ? "Yes" : "No"}
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

bot.command("code", async (ctx) => {
  const loadingMessage = await ctx.reply("Creating code...");

  try {
    const args = ctx.message.text.split(" ").slice(1);
    let maxUses = 1;

    // Check if the first argument is a number.
    if (args.length > 0 && !isNaN(parseInt(args[0]))) {
      maxUses = parseInt(args[0]);
    }

    const url = `https://www.lumenn.xyz/api/create?createdBy=cmfza8ryb0001kw047slwm80j&password=AP40HP1138&maxUses=${maxUses}`;

    const res = await axios.get(url);

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMessage.message_id,
      undefined,
      `Generated code with ${maxUses} use(s):\n${res.data.code}`
    );
  } catch (err: any) {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMessage.message_id,
      undefined,
      `Failed to generate code. Error: ${err.message}`
    );
    console.error(err);
  }
});

setInterval(checkEndpoints, CHECK_INTERVAL);

bot.telegram.setMyCommands([
  { command: "health", description: "Show ts server /health endpoint data" },
  {
    command: "info",
    description: "Show pairs info and matching engine status",
  },
  { command: "code", description: "Create a Invite Code" },
  { command: "status", description: "Show monitoring status" },
  { command: "stop", description: "Stop monitoring and alerts" },
  { command: "resume", description: "Resume monitoring" },
  { command: "pause", description: "Pause monitoring" },
]);

bot.launch();
