import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Public routes that don't require authentication
const PUBLIC_ROUTES = [
  "/",
  "/pricing",
  "/faq",
  "/terms",
  "/privacy",
  "/data-policy",
  "/login",
  "/signup",
  "/maintenance",
  "/admin", // TEMPORARY: for local dev testing
];

// Admin routes that require admin role
const ADMIN_ROUTES = ["/admin"];
const LEGACY_ADMIN_ROUTES = [
  "/admin/users",
  "/admin/subscriptions",
  "/admin/revenue",
  "/admin/ai-tokens",
  "/admin/data-costs",
  "/admin/engine-allocation",
  "/admin/smc-engine",
  "/admin/early-access",
  "/admin/contact-requests",
  "/admin/discord",
  "/admin/crashes",
  "/admin/errors",
  "/admin/push",
  "/admin/content",
  "/admin/settings",
  "/admin/performance",
];

// Check if path starts with any of the given prefixes
function matchesRoute(pathname: string, routes: string[]): boolean {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow static files and API routes
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Allow public routes
  if (matchesRoute(pathname, PUBLIC_ROUTES)) {
    return NextResponse.next();
  }

  // Block legacy admin routes we don't want to expose
  if (matchesRoute(pathname, LEGACY_ADMIN_ROUTES)) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  // For protected routes, check authentication
  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If user is not authenticated, redirect to login
  if (!user) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Check admin routes
  // TEMPORARY: Disabled for local dev
  // if (matchesRoute(pathname, ADMIN_ROUTES)) {
  //   // Fetch user profile to check admin status
  //   const { data: profile } = await supabase
  //     .from("users")
  //     .select("is_admin")
  //     .eq("id", user.id)
  //     .single();

  //   if (!profile?.is_admin) {
  //     // Not an admin, redirect to dashboard
  //     return NextResponse.redirect(new URL("/dashboard", request.url));
  //   }
  // }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
