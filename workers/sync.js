async function runAutoSync(env) {
  if (!env.SITE_ORIGIN) throw new Error("SITE_ORIGIN is not configured");
  if (!env.ADMIN_KEY) throw new Error("ADMIN_KEY is not configured");

  const url = new URL("/api/admin/auto-sync", env.SITE_ORIGIN);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": env.ADMIN_KEY,
    },
    body: "{}",
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Auto sync failed with HTTP ${response.status}`);
  return payload;
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runAutoSync(env));
  },

  async fetch(_request, env) {
    return Response.json(await runAutoSync(env));
  },
};
