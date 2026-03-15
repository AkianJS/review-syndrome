import type { DashboardStats, HealthCheckResult } from "./types";

const API_URL = import.meta.env.PUBLIC_API_URL || "http://localhost:7071";
const API_KEY = import.meta.env.PUBLIC_API_KEY || "";

function headers(): HeadersInit {
  const h: HeadersInit = { "Content-Type": "application/json" };
  if (API_KEY) h["x-api-key"] = API_KEY;
  return h;
}

export async function fetchDashboard(): Promise<DashboardStats> {
  const res = await fetch(`${API_URL}/api/dashboard`, { headers: headers() });
  if (!res.ok) throw new Error(`Dashboard API error: ${res.status}`);
  return res.json();
}

export async function fetchHealth(): Promise<HealthCheckResult> {
  const res = await fetch(`${API_URL}/api/health-check`, { headers: headers() });
  if (!res.ok) throw new Error(`Health API error: ${res.status}`);
  return res.json();
}
