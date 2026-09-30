// waifu-auth 本地服务器
// 用法: npx tsx server.ts (或双击 start.bat)
// 监听: http://localhost:3456/api/
// 注意: 修改 api-src/*.ts 后需先运行 node build.mjs 重新编译

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// 加载 .env
try {
  const env = readFileSync(resolve(__dirname, '.env'), 'utf-8');
  env.split('\n').forEach(line => {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  });
} catch { /* no .env file */ }

// 动态导入编译后的 handler（api/*.js 由 build.mjs 生成）
async function loadHandler(name: string) {
  const mod = await import(`./api/${name}.js`);
  return mod.default;
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const reqUrl = req.url || '/';

  // /admin → 管理后台页面 (Basic Auth 保护)
  if (reqUrl === '/admin' || reqUrl === '/admin/') {
    const pagePassword = process.env.ADMIN_PAGE_PASSWORD || '';
    if (pagePassword) {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Basic ')) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Admin Panel"', 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('需要认证');
        return;
      }
      try {
        const encoded = auth.slice(6);
        const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
        const [, password] = decoded.split(':');
        if (password !== pagePassword) {
          res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Admin Panel"', 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('认证失败');
          return;
        }
      } catch {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Admin Panel"', 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('认证失败');
        return;
      }
    }
    try {
      const html = readFileSync(resolve(__dirname, 'public/admin.html'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('admin.html not found');
    }
    return;
  }

  // 路由: /api/sms-send → sms-send; /api/admin-users/4 → admin-users
  const routePath = reqUrl.replace('/api/', '').replace(/\?.*$/, '');
  const route = routePath.split('/')[0];
  if (!route) { res.writeHead(404); res.end('Not found'); return; }

  try {
    const handler = await loadHandler(route);

    const bodyStr = await new Promise<string>((resolve) => {
      let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b));
    });

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k] = v;
      else if (Array.isArray(v)) headers[k] = v.join(', ');
    }

    const urlObj = new URL(req.url!, `http://${req.headers.host}`);
    const query = Object.fromEntries(urlObj.searchParams.entries());

    let parsedBody: any = bodyStr;
    if (bodyStr && headers['content-type']?.includes('application/json')) {
      try { parsedBody = JSON.parse(bodyStr); } catch { /* keep as string */ }
    }

    const vercelReq: any = { method: req.method, headers, query, body: parsedBody || null, url: req.url };

    let statusCode = 200;
    let responseData: any = null;
    let responseSent = false;

    const vercelRes: any = {
      status(code: number) { statusCode = code; return vercelRes; },
      json(data: any) { responseData = data; responseSent = true; return vercelRes; },
      send(data: any) { responseData = data; responseSent = true; return vercelRes; },
      end() { responseSent = true; return vercelRes; },
      setHeader(k: string, v: string) { res.setHeader(k, v); },
    };

    await handler(vercelReq, vercelRes);

    if (!responseSent) { res.writeHead(204); res.end(); return; }
    if (statusCode === 204) { res.writeHead(204); res.end(); return; }

    const body = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(body);
  } catch (e: any) {
    console.error(`[${req.method} ${req.url}]`, e.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 500, message: `Internal error: ${e.message}` }));
  }
});

const PORT = parseInt(process.env.PORT || '3456');
server.listen(PORT, () => {
  console.log(`waifu-auth API:  http://localhost:${PORT}/api/`);
  console.log(`管理后台:        http://localhost:${PORT}/admin`);
  console.log(`DATABASE_URL: ${process.env.DATABASE_URL ? '✓' : '✗ NOT SET'}`);
});
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n端口 ${PORT} 已被占用，先关掉旧进程: npx kill-port ${PORT}\n`);
  } else {
    console.error('服务器启动失败:', e.message);
  }
  process.exit(1);
});
