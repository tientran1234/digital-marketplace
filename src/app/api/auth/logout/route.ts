import { logout } from "@/server/auth";
export const runtime = "nodejs";
export async function POST() {
  await logout();
  return new Response(null, { status: 204 });
}
