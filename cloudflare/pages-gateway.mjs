// Pages exposes a short URL; the existing Worker retains the writing workflow and rate limiter.
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
function error(message, status) {
  return new Response(JSON.stringify({error: message}), {status, headers: {...headers, 'Content-Type': 'application/json; charset=utf-8'}});
}
export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/api/')) {
      if (!env.LITERARY_API) return error('写作后台未配置。', 503);
      try {
        // Preserve URL, Origin, body, and signal so the backend enforces its normal checks.
        return await env.LITERARY_API.fetch(request);
      } catch {
        return error('写作后台暂时不可用，请稍后重试。', 503);
      }
    }
    if (!['GET', 'HEAD'].includes(request.method)) return error('请求方法不支持。', 405);
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
};
