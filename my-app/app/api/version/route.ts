export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ application: "portal", revision: process.env.APP_REVISION ?? "local", releaseProbe: "portal-delivery-v1" });
}
