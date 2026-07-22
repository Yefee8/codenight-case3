import { gatewayError, proxyGateway, requestIdFor } from "@/lib/server/gateway";

export const dynamic = "force-dynamic";

interface ProxyContext {
  params: Promise<{ path: string[] }>;
}

async function handler(request: Request, context: ProxyContext) {
  const { path } = await context.params;
  if (!Array.isArray(path) || !path.length) {
    return gatewayError(404, "NOT_FOUND", "Kaynak bulunamadı.", requestIdFor(request));
  }

  const pathname = path.map((segment) => encodeURIComponent(segment)).join("/");
  const search = new URL(request.url).search;
  return proxyGateway(request, `/api/v1/${pathname}${search}`);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
