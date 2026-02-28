import appInsights, { KnownSeverityLevel } from "applicationinsights";

let client: appInsights.TelemetryClient | undefined;

function getClient(): appInsights.TelemetryClient | undefined {
  if (client) return client;
  const connectionString = process.env["APPLICATIONINSIGHTS_CONNECTION_STRING"];
  if (!connectionString) return undefined;

  appInsights.setup(connectionString).setAutoCollectRequests(false).start();
  client = appInsights.defaultClient;
  return client;
}

export interface LogProperties {
  workItemId?: number;
  projectName?: string;
  step?: string;
  durationMs?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface Logger {
  info(message: string, properties?: LogProperties): void;
  warn(message: string, properties?: LogProperties): void;
  error(message: string, error?: Error, properties?: LogProperties): void;
  trackMetric(name: string, value: number, properties?: LogProperties): void;
  trackEvent(name: string, properties?: LogProperties): void;
}

function sanitizeProperties(
  props?: LogProperties
): Record<string, string> {
  if (!props) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) {
      result[key] = String(value);
    }
  }
  return result;
}

export function createLogger(context?: string): Logger {
  const prefix = context ? `[${context}]` : "";

  return {
    info(message: string, properties?: LogProperties): void {
      const line = `${prefix} ${message}`;
      console.log(JSON.stringify({ level: "info", message: line, ...properties }));

      const ai = getClient();
      if (ai) {
        ai.trackTrace({
          message: line,
          severity: KnownSeverityLevel.Information,
          properties: sanitizeProperties(properties),
        });
      }
    },

    warn(message: string, properties?: LogProperties): void {
      const line = `${prefix} ${message}`;
      console.warn(JSON.stringify({ level: "warn", message: line, ...properties }));

      const ai = getClient();
      if (ai) {
        ai.trackTrace({
          message: line,
          severity: KnownSeverityLevel.Warning,
          properties: sanitizeProperties(properties),
        });
      }
    },

    error(message: string, error?: Error, properties?: LogProperties): void {
      const line = `${prefix} ${message}`;
      console.error(
        JSON.stringify({
          level: "error",
          message: line,
          error: error?.message,
          stack: error?.stack,
          ...properties,
        })
      );

      const ai = getClient();
      if (ai) {
        ai.trackException({
          exception: error ?? new Error(message),
          severity: KnownSeverityLevel.Error,
          properties: sanitizeProperties(properties),
        });
      }
    },

    trackMetric(name: string, value: number, properties?: LogProperties): void {
      console.log(JSON.stringify({ level: "metric", name, value, ...properties }));

      const ai = getClient();
      if (ai) {
        ai.trackMetric({
          name,
          value,
          properties: sanitizeProperties(properties),
        });
      }
    },

    trackEvent(name: string, properties?: LogProperties): void {
      console.log(JSON.stringify({ level: "event", name, ...properties }));

      const ai = getClient();
      if (ai) {
        ai.trackEvent({
          name,
          properties: sanitizeProperties(properties),
        });
      }
    },
  };
}
