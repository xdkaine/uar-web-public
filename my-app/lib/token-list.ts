export function splitTokens(value: string): string[] {
  return value.split(/[\s,;]+/).map((token) => token.trim()).filter(Boolean);
}

export function mergeTokens(current: string[], input: string): string[] {
  const seen = new Set(current.map((token) => token.toLowerCase()));
  const merged = [...current];
  splitTokens(input).forEach((token) => {
    const key = token.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(token);
  });
  return merged;
}
