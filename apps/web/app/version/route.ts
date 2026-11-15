// The running build, so open pages can tell when ANANDA was updated ("Reload to get the latest version").
const ID = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_BUILD_ID ?? String(Date.now());

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ id: ID }, { headers: { 'cache-control': 'no-store' } });
}
