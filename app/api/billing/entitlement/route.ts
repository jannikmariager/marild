import { NextRequest, NextResponse } from "next/server";

const ALLOWED_HEADERS = "Authorization, Content-Type, Supabase-Access-Token";
const ALLOWED_METHODS = "GET,OPTIONS";
const MAX_AGE = "600";

function applyCors(request: NextRequest, response: NextResponse) {
  const origin = request.headers.get("origin") ?? "*";
  response.headers.set("Access-Control-Allow-Origin", origin || "*");
  if (origin) {
    response.headers.set("Vary", "Origin");
  }
  response.headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  response.headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  response.headers.set("Access-Control-Max-Age", MAX_AGE);
  return response;
}

export const dynamic = "force-dynamic";

export async function OPTIONS(request: NextRequest) {
  return applyCors(request, new NextResponse(null, { status: 204 }));
}

export async function GET(request: NextRequest) {
  // Optional: require a bearer token; for now, just accept any/non-empty token to keep the app unblocked.
  const authHeader = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!authHeader) {
    return applyCors(
      request,
      NextResponse.json(
        { active: false, plan: null, status: "unauthenticated", error: "Missing Authorization header" },
        { status: 401 },
      ),
    );
  }

  // Minimal stub response; adjust when real billing is reconnected.
  return applyCors(
    request,
    NextResponse.json({
      active: true,
      plan: "pro",
      status: "active",
    }),
  );
}
