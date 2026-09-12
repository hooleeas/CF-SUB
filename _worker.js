/**
 * 项目名称: CF-SUB
 * 核心特性: KV可视化后台、USER/PASS鉴权、主页防探测保护、NOADS过滤、多端自适应
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // 唯一的系统环境变量钥匙，必须在CF后台设置
    const TOKEN = env.TOKEN || 'admin';

    // 初始化默认配置 (KV未设置时的兜底数据)
    let config = {
      GUEST: '',
      USER: 'admin',
      PASS: '123456',
      SUBNAME: 'CF-SUB',
      SUBAPI: 'SUBAPI.cmliussss.net',
      SUBCONFIG: 'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_Full_MultiMode.ini',
      NOADS: '加入TG群, 关注YouTube频道, http://',
      LINKS: env.LINK || '' // 兜底读取环境变量中的旧节点
    };

    // 从 KV 中读取用户动态配置 (完美兼容旧版数据格式)
    if (env.KV) {
      try {
        // 原版项目通常将数据存在以 TOKEN 命名的键值中
        const kvStr = await env.KV.get(TOKEN);
        if (kvStr) {
          const kvConf = JSON.parse(kvStr);
          config.GUEST = kvConf.GUEST !== undefined ? kvConf.GUEST : config.GUEST;
          config.USER = kvConf.USER !== undefined ? kvConf.USER : config.USER;
          config.PASS = kvConf.PASS !== undefined ? kvConf.PASS : config.PASS;
          
          // 兼容原版旧格式的小驼峰命名 (subName, subApi等)
          config.SUBNAME = kvConf.SUBNAME || kvConf.subName || config.SUBNAME;
          config.SUBAPI = kvConf.SUBAPI || kvConf.subApi || config.SUBAPI;
          config.SUBCONFIG = kvConf.SUBCONFIG || kvConf.subConfig || config.SUBCONFIG;
          config.NOADS = kvConf.NOADS !== undefined ? kvConf.NOADS : (kvConf.noAds !== undefined ? kvConf.noAds : config.NOADS);
          
          // 读取节点列表
          config.LINKS = kvConf.LINKS !== undefined ? kvConf.LINKS : config.LINKS;
        }
      } catch (e) {
        console.error("KV读取错误:", e);
      }
    }

    // 判断请求类型：如果是订阅客户端或转换后端的抓取请求，则放行；否则拦截为浏览器访问
    const isSubRequest = checkIsSubRequest(request, url);

    // 路由 1: 访问管理员 TOKEN 路径
    if (path === `/${TOKEN}`) {
      // 浏览器访问 -> 弹出系统登录框 -> 加载可视化后台
      if (!isSubRequest) {
        const auth = request.headers.get('Authorization');
        const expectedAuth = 'Basic ' + btoa(`${config.USER}:${config.PASS}`);
        
        // 浏览器 Basic Auth 鉴权
        if (auth !== expectedAuth) {
          return new Response('Unauthorized', {
            status: 401,
            headers: { 'WWW-Authenticate': 'Basic realm="CF-SUB Admin System"' }
          });
        }

        // 处理后台提交保存配置的 POST 请求
        if (request.method === 'POST') {
          try {
            const formData = await request.formData();
            const newConf = {
              GUEST: formData.get('GUEST') || '',
              USER: formData.get('USER') || 'admin',
              PASS: formData.get('PASS') || '123456',
              SUBNAME: formData.get('SUBNAME') || 'CF-SUB',
              SUBAPI: formData.get('SUBAPI') || 'SUBAPI.cmliussss.net',
              SUBCONFIG: formData.get('SUBCONFIG') || 'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_Full_MultiMode.ini',
              NOADS: formData.get('NOADS') || '',
              LINKS: formData.get('LINKS') || ''
            };
            if (env.KV) {
              // 统一存入以 TOKEN 为键名的空间中
              await env.KV.put(TOKEN, JSON.stringify(newConf));
              return new Response('Success', { status: 200 });
            } else {
              return new Response('未绑定KV空间，无法保存！', { status: 500 });
            }
          } catch (e) {
            return new Response(e.message, { status: 500 });
          }
        }

        // 返回可视化网页后台 HTML
        return new Response(getAdminHTML(config, TOKEN, url.origin), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      } 
      // 客户端订阅请求 -> 走转换下发逻辑
      else {
        return await handleSubscription(request, url, config, TOKEN);
      }
    } 
    // 路由 2: 访问访客 GUEST 路径 (必须在后台开启且不为空)
    else if (config.GUEST && path === `/${config.GUEST}`) {
      return await handleSubscription(request, url, config, TOKEN);
    } 
    // 路由 3: 根目录、错误路径或探测请求 -> 返回防探测主页
    else {
      return new Response(getFakeHTML(), {
        status: 200, // 保持200状态码，让扫描器认为是正常页面
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
  }
};

/**
 * 核心方法: 检查是否为订阅拉取请求
 */
function checkIsSubRequest(request, url) {
  const ua = (request.headers.get('User-Agent') || '').toLowerCase();
  const isBrowser = /mozilla|applewebkit|chrome|safari|edge/i.test(ua);
  const hasSubParams = url.searchParams.has('b64') || url.searchParams.has('clash') || url.searchParams.has('sb') || url.searchParams.has('surge') || url.searchParams.has('loon') || url.searchParams.has('v2ray');
  const isSubClient = /clash|mihomo|sing-box|nekobox|surge|loon|v2ray|shadowrocket/i.test(ua);
  const isSubconverter = /subconverter|go-http-client/i.test(ua);
  
  return hasSubParams || isSubClient || isSubconverter || !isBrowser;
}

/**
 * 核心方法: 识别目标客户端格式
 */
function getTarget(request, url) {
  const ua = (request.headers.get('User-Agent') || '').toLowerCase();
  if (url.searchParams.has('clash') || ua.includes('clash') || ua.includes('mihomo')) return 'clash';
  if (url.searchParams.has('sb') || url.searchParams.has('singbox') || ua.includes('sing-box') || ua.includes('nekobox')) return 'singbox';
  if (url.searchParams.has('surge') || ua.includes('surge')) return 'surge';
  if (url.searchParams.has('loon') || ua.includes('loon')) return 'loon';
  if (url.searchParams.has('v2ray') || ua.includes('v2rayn')) return 'v2ray';
  return 'b64';
}

/**
 * 核心方法: 获取并过滤节点内容 (解析远端订阅 + NOADS广告过滤)
 */
async function getFilteredNodes(linksStr, noadsStr) {
  const lines = linksStr.split(/\r?\n/);
  let nodes = [];
  
  // 1. 汇聚并解析远端订阅链接
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (line.startsWith('http://') || line.startsWith('https://')) {
      try {
        const res = await fetch(line, { headers: { 'User-Agent': 'v2rayN/6.0' } });
        if (res.ok) {
          let text = (await res.text()).trim();
          let decoded = text;
          // 如果远端返回的是 Base64 格式，进行解码
          if (!text.includes('://') && !text.includes('\n')) {
            let b64 = text.replace(/-/g, '+').replace(/_/g, '/');
            try { decoded = decodeURIComponent(escape(atob(b64))); } catch (e) { decoded = text; }
          }
          const subLines = decoded.split(/\r?\n/);
          for (let sl of subLines) {
            if (sl.trim()) nodes.push(sl.trim());
          }
        }
      } catch (e) {
        console.log("获取远端订阅失败:", line);
      }
    } else {
      nodes.push(line);
    }
  }

  // 2. 核心去广告逻辑 (NOADS)
  let noads = noadsStr.split(/,|\n/).map(s => s.trim()).filter(s => s.length > 0);
  let validNodes = [];
  for (let node of nodes) {
    let hasAd = false;
    for (let ad of noads) {
      // 简单安全解码以比对含有 url encoding 的节点名
      let decodedNode = node;
      try { decodedNode = decodeURIComponent(node); } catch(e) {}
      if (decodedNode.includes(ad) || node.includes(ad)) {
        hasAd = true; 
        break;
      }
    }
    if (!hasAd) validNodes.push(node);
  }
  return validNodes;
}

/**
 * 核心方法: 处理订阅分发请求
 */
async function handleSubscription(request, url, config, TOKEN) {
  const target = getTarget(request, url);

  // 如果请求基础 Base64 或兜底目标
  if (target === 'b64' || url.searchParams.has('b64')) {
    const validNodes = await getFilteredNodes(config.LINKS, config.NOADS);
    const b64 = btoa(unescape(encodeURIComponent(validNodes.join('\n'))));
    return new Response(b64, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  // 构建转换请求，巧妙地让转换后端来拉取我们刚刚生成的纯净 Base64 链接
  const subUrl = `${url.origin}/${TOKEN}?b64`;
  const subconverterUrl = `https://${config.SUBAPI}/sub?target=${target}&url=${encodeURIComponent(subUrl)}&insert=false&config=${encodeURIComponent(config.SUBCONFIG)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&name=${encodeURIComponent(config.SUBNAME)}`;

  try {
    const res = await fetch(subconverterUrl, {
      headers: { 'User-Agent': request.headers.get('User-Agent') || 'CF-SUB-Worker' }
    });
    if (!res.ok) throw new Error('转换后端请求失败');
    
    // 直接返回转换后端生成好的配置文件
    return new Response(await res.text(), {
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(config.SUBNAME)}; filename*=utf-8''${encodeURIComponent(config.SUBNAME)}"`
      }
    });
  } catch (e) {
    // 智能容灾回退：如果高级转换后端挂了，直接退回下发 Base64
    const validNodes = await getFilteredNodes(config.LINKS, config.NOADS);
    const b64 = btoa(unescape(encodeURIComponent(validNodes.join('\n'))));
    return new Response(b64, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

/**
 * 视图组件: 渲染网页可视化后台
 */
function getAdminHTML(config, TOKEN, baseUrl) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.SUBNAME} | 管理控制台</title>
  <style>
    :root { --primary: #007bff; --bg: #f4f6f8; --card: #ffffff; --text: #333333; --border: #e0e0e0; }
    @media (prefers-color-scheme: dark) { :root { --primary: #3b82f6; --bg: #121212; --card: #1e1e1e; --text: #e0e0e0; --border: #333333; } }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 20px; }
    .container { max-width: 800px; margin: 0 auto; background: var(--card); padding: 30px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.05); }
    h1 { text-align: center; color: var(--primary); font-size: 24px; margin-bottom: 30px; }
    .form-group { margin-bottom: 20px; }
    label { display: block; font-weight: 600; margin-bottom: 8px; font-size: 14px; }
    input[type="text"], input[type="password"], textarea { width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 6px; box-sizing: border-box; background: var(--bg); color: var(--text); font-family: inherit; }
    textarea { height: 160px; resize: vertical; line-height: 1.5; }
    button { background: var(--primary); color: white; border: none; padding: 14px 20px; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold; width: 100%; transition: background 0.2s; }
    button:hover { filter: brightness(1.1); }
    .links-card { margin-top: 30px; background: var(--bg); padding: 20px; border-radius: 8px; border: 1px solid var(--border); }
    .links-card h3 { margin-top: 0; font-size: 16px; color: var(--primary); }
    .links-card p { font-size: 14px; word-break: break-all; margin: 10px 0; }
    .links-card a { color: var(--primary); text-decoration: none; }
    .toast { text-align: center; margin-top: 15px; font-weight: bold; display: none; }
  </style>
</head>
<body>
  <div class="container">
    <h1>CF-SUB 管理控制台</h1>
    <form id="configForm">
      
      <div style="display:flex; gap:15px; margin-bottom:20px;">
        <div style="flex:1;">
          <label>后台账号 (USER)</label>
          <input type="text" name="USER" value="${config.USER || 'admin'}">
        </div>
        <div style="flex:1;">
          <label>后台密码 (PASS)</label>
          <input type="text" name="PASS" value="${config.PASS || '123456'}">
        </div>
      </div>

      <div class="form-group">
        <label>访客入口 TOKEN (GUEST)</label>
        <input type="text" name="GUEST" value="${config.GUEST || ''}" placeholder="例如: guest123，留空则不开启独立访客入口">
      </div>

      <div class="form-group">
        <label>站点与订阅名称 (SUBNAME)</label>
        <input type="text" name="SUBNAME" value="${config.SUBNAME || 'CF-SUB'}">
      </div>

      <div class="form-group">
        <label>订阅转换后端 (SUBAPI)</label>
        <input type="text" name="SUBAPI" value="${config.SUBAPI || 'SUBAPI.cmliussss.net'}">
      </div>

      <div class="form-group">
        <label>转换分流规则 (SUBCONFIG)</label>
        <input type="text" name="SUBCONFIG" value="${config.SUBCONFIG || 'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_Full_MultiMode.ini'}">
      </div>

      <div class="form-group">
        <label>去广告与屏蔽关键字 (NOADS) - 逗号或换行分隔</label>
        <textarea name="NOADS" placeholder="加入TG群, 关注YouTube频道">${config.NOADS || ''}</textarea>
      </div>

      <div class="form-group">
        <label>汇聚节点与订阅链接 (每行一个，支持直连节点与机场订阅)</label>
        <textarea name="LINKS" placeholder="vmess://...\nvless://...\nhttps://机场订阅链接.com/sub">${config.LINKS || ''}</textarea>
      </div>

      <button type="submit">保存至 KV 数据库</button>
    </form>

    <div id="toast" class="toast"></div>
    
    <div class="links-card">
      <h3>🚀 您的专属订阅链接</h3>
      <p><strong>👑 管理员自适应订阅:</strong> <a href="${baseUrl}/${TOKEN}" target="_blank">${baseUrl}/${TOKEN}</a></p>
      ${config.GUEST ? `<p><strong>🤝 访客自适应订阅:</strong> <a href="${baseUrl}/${config.GUEST}" target="_blank">${baseUrl}/${config.GUEST}</a></p>` : ''}
      <hr style="border:none; border-top:1px dashed var(--border); margin:15px 0;">
      <p><strong>Clash:</strong> ${baseUrl}/${TOKEN}?clash</p>
      <p><strong>Sing-box:</strong> ${baseUrl}/${TOKEN}?sb</p>
      <p><strong>Surge:</strong> ${baseUrl}/${TOKEN}?surge</p>
      <p><strong>Loon:</strong> ${baseUrl}/${TOKEN}?loon</p>
      <p><strong>Base64 (纯净节点):</strong> ${baseUrl}/${TOKEN}?b64</p>
    </div>
  </div>

  <script>
    document.getElementById('configForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter;
      const toast = document.getElementById('toast');
      btn.innerText = '正在保存至云端...';
      try {
        const formData = new FormData(e.target);
        const res = await fetch('', { method: 'POST', body: formData });
        toast.style.display = 'block';
        if (res.ok) {
          toast.innerText = '🎉 设定已成功保存！马上生效。';
          toast.style.color = '#28a745';
          setTimeout(() => location.reload(), 1500);
        } else {
          toast.innerText = '❌ 保存失败: ' + await res.text();
          toast.style.color = '#dc3545';
        }
      } catch(err) {
         toast.style.display = 'block';
         toast.innerText = '❌ 网络请求错误';
         toast.style.color = '#dc3545';
      }
      btn.innerText = '保存至 KV 数据库';
    });
  </script>
</body>
</html>`;
}

/**
 * 视图组件: 渲染防探测主页 (Apple 拼车伪装)
 */
function getFakeHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Apple 订阅拼车服务</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #000; color: #f5f5f7; text-align: center; }
    .hero { padding: 80px 20px; }
    h1 { font-size: 48px; font-weight: 600; letter-spacing: -0.003em; margin-bottom: 20px; }
    p { font-size: 21px; color: #86868b; max-width: 600px; margin: 0 auto 40px; line-height: 1.4; font-weight: 400; }
    .btn { background: #fff; color: #1d1d1f; padding: 14px 28px; border-radius: 980px; text-decoration: none; font-size: 17px; font-weight: 400; display: inline-block; transition: all 0.3s; }
    .btn:hover { background: #f5f5f7; transform: scale(1.02); }
  </style>
</head>
<body>
  <div class="hero">
    <h1>Apple Music & One <br>拼车服务</h1>
    <p>稳定、安全、独享账号体验。加入我们的家庭组，即刻畅享无缝的 Apple 生态体验。席位有限，先到先得。</p>
    <a href="#" class="btn" onclick="alert('席位已满，请留意下期开放通知。'); return false;">了解更多席位</a>
  </div>
</body>
</html>`;
}
