import { fetchHealth } from "../../lib/api";

const POLL_INTERVAL = 30000;

async function poll(): Promise<void> {
  try {
    const result = await fetchHealth();
    const container = document.getElementById("health-dots");
    if (!container) return;

    container.innerHTML = Object.entries(result.checks)
      .map(([name, check]) => {
        const cls = check.status === "pass" ? "health-dot--pass" : "health-dot--fail";
        return `<span class="health-dot ${cls}" title="${name}: ${check.message ?? check.status}"></span>`;
      })
      .join("");
  } catch (err) {
    console.error("Health poll failed:", err);
  }
}

poll();
setInterval(poll, POLL_INTERVAL);
