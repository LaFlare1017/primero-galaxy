import { NextResponse, type NextRequest } from "next/server";

/**
 * Serve the Delegate surface and nothing else.
 *
 * The repo is one Next app with four products in it, and a deployment that
 * hosts the workshop simulator does not want to publish the galaxy, FinBench
 * and the landing page alongside it — not because they are secret, but because
 * a URL that answers 200 is a claim somebody then has to keep true, and the
 * delegate deployment is the one that gets pasted into a run-of-show.
 *
 * It is a gate rather than a second app: the delegate pages import the same
 * layout, the same globals and the same components as the rest, and a rewrite
 * that served some routes and not others would be one more thing to keep in
 * step with the tree.
 *
 * Off unless `DELEGATE_ONLY=1` is in the environment, which is what keeps
 * local development, CI and the Playwright suite (which drives /galaxy against
 * its own production build, on a port each worker takes from the OS) reading
 * the whole app. Set it in the Vercel project's environment and nothing else
 * changes.
 */
const DELEGATE_ONLY = process.env.DELEGATE_ONLY === "1";

/** The participant view, the facilitator grid, and the API behind both. */
const DELEGATE = ["/delegate", "/api/delegate"];

/** What Next serves regardless of product: chunks, icons, the share image. */
const PLATFORM = [
  "/_next/",
  "/icon",
  "/apple-icon",
  "/favicon",
  "/manifest",
  "/robots",
  "/sitemap",
  "/og",
  "/opengraph-image",
];

export function middleware(request: NextRequest) {
  if (!DELEGATE_ONLY) return NextResponse.next();

  const { pathname } = request.nextUrl;
  const serves = (prefixes: string[]) =>
    prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(prefix));

  if (serves(DELEGATE) || serves(PLATFORM)) return NextResponse.next();

  // The root is the one path that should not 404: it is what somebody types
  // after reading a run-of-show, and the participant view is what they meant.
  if (pathname === "/") return NextResponse.redirect(new URL("/delegate", request.url));

  return new NextResponse("Not found — this deployment serves Delegate only.\n", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export const config = {
  // Everything the app serves, minus the two paths Next answers from the CDN
  // and never routes through here.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
