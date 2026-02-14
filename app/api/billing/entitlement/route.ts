import { NextRequest, NextResponse } from "next/server";
import { getEntitlementForUserId, getUserIdFromRequest } from "@/app/api/_lib/entitlement";

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
  try {
    const userId = await getUserIdFromRequest(request);
    const entitlement = await getEntitlementForUserId(userId);

    return applyCors(
      request,
      NextResponse.json({
        active: entitlement.active,
        plan: entitlement.plan,
        status: entitlement.status,
      }),
    );
  } catch (respOrErr: any) {
    if (respOrErr instanceof NextResponse) {
      return applyCors(request, respOrErr);
    }

    // If the helper threw a NextResponse.json(...) it will be a Response.
    if (respOrErr && typeof respOrErr === "object" && "status" in respOrErr) {
      return applyCors(request, respOrErr as NextResponse);
    }

    return applyCors(
      request,
      NextResponse.json({ active: false, plan: null, status: "unauthenticated", error: "entitlement unavailable" }, { status: 500 }),
    );
  }
}
