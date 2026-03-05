import { fetchDashboard } from "../../lib/api";
import type { DashboardStats, JobRecord } from "../../lib/types";

const POLL_INTERVAL = 5000;
let lastUpdated = Date.now();

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "--";
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function formatCost(cost: number | undefined): string {
  if (cost === undefined) return "--";
  return `$${cost.toFixed(2)}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusDot(status: string): string {
  return `<span class="status-dot status-dot--${status}"></span>`;
}

function modelCell(job: JobRecord): string {
  const model = job.modelUsed?.replace("claude-", "").replace("-4-6", "") ?? "--";
  const badge = job.escalated ? ` <span class="badge-escalated">esc</span>` : "";
  return `${model}${badge}`;
}

function updateStats(stats: DashboardStats): void {
  const el = (id: string) => document.getElementById(id);

  el("stat-total")!.textContent = String(stats.totalJobs);
  const rate = stats.totalJobs > 0
    ? ((stats.successCount / stats.totalJobs) * 100).toFixed(1)
    : "0";
  el("stat-success-rate")!.textContent = `${rate}%`;
  el("stat-success-count")!.textContent = `${stats.successCount} of ${stats.totalJobs}`;
  el("stat-failure")!.textContent = String(stats.failureCount);
  el("stat-no-changes")!.textContent = String(stats.noChangesCount);

  el("cost-total")!.textContent = formatCost(stats.totalCostUsd);
  el("cost-avg")!.textContent = formatCost(stats.avgCostUsd);
  const escText = stats.escalationCount > 0
    ? `${stats.escalationCount} escalation${stats.escalationCount > 1 ? "s" : ""}`
    : "No escalations";
  el("cost-escalations")!.textContent = escText;
}

function updateJobTable(jobs: JobRecord[]): void {
  const tbody = document.getElementById("job-table-body")!;

  if (jobs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-secondary" style="text-align:center;padding:2rem;">No jobs yet</td></tr>`;
    return;
  }

  tbody.innerHTML = jobs.map((job) => `
    <tr>
      <td>${job.workItemId}</td>
      <td>${statusDot(job.status)} ${job.status}</td>
      <td>${modelCell(job)}</td>
      <td>${formatCost(job.costUsd)}</td>
      <td>${job.prId ? `#${job.prId}` : "--"}</td>
      <td>${formatDuration(job.durationMs)}</td>
      <td>${job.startedAt ? timeAgo(job.startedAt) : "--"}</td>
    </tr>
  `).join("");
}

function updateTimestamp(): void {
  const el = document.getElementById("last-updated");
  if (!el) return;
  const seconds = Math.floor((Date.now() - lastUpdated) / 1000);
  el.textContent = `Updated ${seconds}s ago`;
}

async function poll(): Promise<void> {
  try {
    const stats = await fetchDashboard();
    updateStats(stats);
    updateJobTable(stats.recentJobs);
    lastUpdated = Date.now();
    document.getElementById("poll-indicator")?.classList.remove("poll-error");
  } catch (err) {
    console.error("Dashboard poll failed:", err);
    document.getElementById("poll-indicator")?.classList.add("poll-error");
  }
}

poll();
setInterval(poll, POLL_INTERVAL);
setInterval(updateTimestamp, 1000);
