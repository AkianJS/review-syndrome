export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": process.env["CORS_ALLOWED_ORIGIN"] || "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key, Authorization",
};

export function corsPreflightResponse(): { status: number; headers: Record<string, string> } {
  return { status: 204, headers: CORS_HEADERS };
}
