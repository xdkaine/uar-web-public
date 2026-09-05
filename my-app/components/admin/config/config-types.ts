interface ConfigEntry {
  key: string;
  value?: unknown;
  secret?: boolean;
  configured?: boolean;
  source: 'database' | 'environment' | 'default' | null;
  description: string;
  envFallback?: string;
}

export type { ConfigEntry };
