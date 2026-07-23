const scriptTag = /<\/?script\b[^>]*>/gi;

export function stripScriptTags(value: string) {
  return value.replace(scriptTag, "").trim();
}
