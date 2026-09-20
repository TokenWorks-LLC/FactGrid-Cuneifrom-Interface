import { NextResponse } from "next/server";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Cookie",
};

export function privateJson(
  body: unknown,
  init?: { status?: number },
): NextResponse {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: PRIVATE_HEADERS,
  });
}

export function authUnavailable(): NextResponse {
  return privateJson(
    {
      error: {
        code: "auth_unavailable",
        message: "FactGrid sign-in is not configured for this deployment.",
      },
    },
    { status: 503 },
  );
}

export function noStore(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}
