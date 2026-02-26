export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

export function successResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

export function jsonResult(label: string, data: unknown) {
  return {
    content: [
      { type: "text" as const, text: `${label}:\n${JSON.stringify(data, null, 2)}` },
    ],
  };
}
