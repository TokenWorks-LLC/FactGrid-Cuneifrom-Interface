import "server-only";

function declaredLength(response: Response): number | null {
  const value = response.headers.get("content-length");
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function readBoundedResponseBytes(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const length = declaredLength(response);
  if (length !== null && length > maximumBytes) {
    await response.body?.cancel("OAuth response exceeded its byte limit");
    throw new Error("FactGrid OAuth response is too large");
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel("OAuth response exceeded its byte limit");
        throw new Error("FactGrid OAuth response is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readBoundedResponseText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const bytes = await readBoundedResponseBytes(response, maximumBytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error("FactGrid OAuth response is not valid UTF-8", { cause: error });
  }
}

export async function bufferBoundedResponse(
  response: Response,
  maximumBytes: number,
): Promise<Response> {
  const bytes = await readBoundedResponseBytes(response, maximumBytes);
  const body = bytes.byteLength > 0 ? Uint8Array.from(bytes).buffer : null;
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
