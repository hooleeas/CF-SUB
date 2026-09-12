// 部署完成后在网址后面加上这个，获取自建节点和机场聚合节点，/?token=auto或/auto或

let mytoken = 'auto';
let guestToken = ''; //可以随便取，或者uuid生成，https://1024tools.com/uuid
let FileName = 'CF-SUB';
let SUBUpdateTime = 6; //自定义订阅更新时间，单位小时
let total = 99;//TB
let timestamp = 4102329600000;//2099-12-31

//节点链接 + 订阅链接
let MainData = `
https://cfxr.eu.org/getSub
`;

let urls = [];

// ================= 全局默认配置 =================
const defaultSubConverter = "SUBAPI.cmliussss.net"; // 默认后端
const defaultSubConfig = "https://raw.githubusercontent.com/hooleeas/ACL4SSR/refs/heads/master/Clash/config/ACL4SSR_Mini_NoAuto.ini"; // 默认规则
const defaultSubProtocol = "https";
// ================================================

let subConverter = defaultSubConverter; 
let subConfig = defaultSubConfig;
let subProtocol = defaultSubProtocol;
let config_noAds = ''; 

export default {
    async fetch(request, env) {
        const userAgentHeader = request.headers.get('User-Agent');
        const userAgent = userAgentHeader ? userAgentHeader.toLowerCase() : "null";
        const url = new URL(request.url);
        const token = url.searchParams.get('token');
        
        mytoken = env.TOKEN || mytoken;
        let adminUser = env.USER || '';
        let adminPass = env.PASS || '';

        // 从 KV 获取动态设置的变量
        if (env.KV) {
            const kvConfigStr = await env.KV.get('CONFIG.json');
            if (kvConfigStr) {
                try {
                    const kvConfig = JSON.parse(kvConfigStr);
                    FileName = kvConfig.subName || FileName;
                    subConverter = kvConfig.subApi || subConverter;
                    subConfig = kvConfig.subConfig || subConfig;
                    config_noAds = kvConfig.noAds || '';
                    guestToken = kvConfig.guest || guestToken;
                    adminUser = kvConfig.user || adminUser;
                    adminPass = kvConfig.pass || adminPass;
                } catch(e) {
                    console.error('解析 KV 配置失败', e);
                }
            }
        }

        if (subConverter.includes("http://")) {
            subConverter = subConverter.split("//")[1];
            subProtocol = 'http';
        } else {
            subConverter = subConverter.split("//")[1] || subConverter;
        }

        const currentDate = new Date();
        currentDate.setHours(0, 0, 0, 0);
        const timeTemp = Math.ceil(currentDate.getTime() / 1000);
        const fakeToken = await MD5MD5(`${mytoken}${timeTemp}`);
        guestToken = env.GUESTTOKEN || env.GUEST || guestToken;
        if (!guestToken) guestToken = await MD5MD5(mytoken);
        const 访客订阅 = guestToken;
        
        const guestPath = url.pathname === ("/" + 访客订阅) || url.pathname.toLowerCase() === ("/" + 访客订阅.toLowerCase());

        let UD = Math.floor(((timestamp - Date.now()) / timestamp * total * 1099511627776) / 2);
        total = total * 1099511627776;
        let expire = Math.floor(timestamp / 1000);
        SUBUpdateTime = env.SUBUPTIME || SUBUpdateTime;
        const isProxyClientUA = ['clash', 'meta', 'mihomo', 'sing-box', 'singbox', 'surge', 'quantumult', 'loon', 'nekobox', 'v2rayn', 'v2rayng', 'shadowrocket', 'subconverter'].some(keyword => userAgent.includes(keyword));

        // 如果路径既不是管理员，也不是访客，则拦截
        if (!([mytoken, fakeToken, 访客订阅].includes(token) || url.pathname == ("/" + mytoken) || url.pathname.includes("/" + mytoken + "?") || guestPath)) {
            if (env.URL302) return Response.redirect(env.URL302, 302);
            else if (env.URL) return await proxyURL(env.URL, url);
            else return new Response(await nginx(FileName), { // 这里传入了动态的 FileName
                status: 200,
                headers: { 'Content-Type': 'text/html; charset=UTF-8' },
            });
        } else {
            if (env.KV) {
                await 迁移地址列表(env, 'LINK.txt');
                // 浏览器直接访问且不带转换参数时的UI分流逻辑
                if (userAgent.includes('mozilla') && !url.search && !isProxyClientUA) {
                    
                    // 进行后端探针检测 (避免超时导致卡顿，设1.5秒限制)
                    let apiOk = true;
                    let configOk = true;
                    
                    try {
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 1500);
                        const resApi = await fetch(`${subProtocol}://${subConverter}/version`, { signal: controller.signal });
                        apiOk = resApi.ok;
                        clearTimeout(timeout);
                    } catch (e) { apiOk = false; }

                    try {
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), 1500);
                        const resConfig = await fetch(subConfig, { method: 'GET', signal: controller.signal });
                        configOk = resConfig.ok;
                        clearTimeout(timeout);
                    } catch (e) { configOk = false; }

                    if (guestPath) {
                        // 访客访问：展示实际工作的配置
                        const displayApi = apiOk ? subConverter : defaultSubConverter;
                        const displayProtocol = apiOk ? subProtocol : defaultSubProtocol;
                        const displayConfig = configOk ? subConfig : defaultSubConfig;
                        return new Response(renderGuestPage(url, 访客订阅, `${displayProtocol}://${displayApi}`, displayConfig), { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
                    } else {
                        if (isAdminLoginEnabled(adminUser, adminPass)) {
                            const isLoggedIn = await isAdminLoggedIn(request, mytoken, adminUser, adminPass);
                            if (!isLoggedIn) {
                                if (request.method === 'POST') return await handleAdminLogin(request, url, mytoken, adminUser, adminPass);
                                return new Response(renderLoginPage(url), { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' }});
                            }
                        }
                        // 管理员访问
                        return await KV(request, env, 'LINK.txt', 访客订阅, apiOk, configOk, subConverter, subConfig);
                    }
                } else {
                    MainData = await env.KV.get('LINK.txt') || MainData;
                }
            } else {
                MainData = env.LINK || MainData;
                if (env.LINKSUB) urls = await ADD(env.LINKSUB);
            }

            let 重新汇总所有链接 = await ADD(MainData + '\n' + urls.join('\n'));
            let 自建节点 = "";
            let 订阅链接 = "";
            for (let x of 重新汇总所有链接) {
                if (x.toLowerCase().startsWith('http')) 订阅链接 += x + '\n';
                else 自建节点 += x + '\n';
            }
            MainData = 自建节点;
            urls = await ADD(订阅链接);
            const isSubConverterRequest = request.headers.get('subconverter-request') || request.headers.get('subconverter-version') || userAgent.includes('subconverter');
            
            let 订阅格式 = 'base64';
            if (!(userAgent.includes('null') || isSubConverterRequest || userAgent.includes('nekobox') || userAgent.includes(('CF-SUB').toLowerCase()))) {
                if (userAgent.includes('sing-box') || userAgent.includes('singbox') || url.searchParams.has('sb') || url.searchParams.has('singbox')) 订阅格式 = 'singbox';
                else if (userAgent.includes('surge') || url.searchParams.has('surge')) 订阅格式 = 'surge';
                else if (userAgent.includes('quantumult') || url.searchParams.has('quanx')) 订阅格式 = 'quanx';
                else if (userAgent.includes('loon') || url.searchParams.has('loon')) 订阅格式 = 'loon';
                else if (userAgent.includes('clash') || userAgent.includes('meta') || userAgent.includes('mihomo') || url.searchParams.has('clash')) 订阅格式 = 'clash';
            }

            let 订阅转换URL = `${url.origin}/${await MD5MD5(fakeToken)}?token=${fakeToken}`;
            let req_data = MainData;
            let 追加UA = 'v2rayn';
            if (url.searchParams.has('b64') || url.searchParams.has('base64')) 订阅格式 = 'base64';
            else if (url.searchParams.has('clash')) 追加UA = 'clash';
            else if (url.searchParams.has('singbox')) 追加UA = 'singbox';
            else if (url.searchParams.has('surge')) 追加UA = 'surge';
            else if (url.searchParams.has('quanx')) 追加UA = 'Quantumult%20X';
            else if (url.searchParams.has('loon')) 追加UA = 'Loon';

            const 订阅链接数组 = [...new Set(urls)].filter(item => item?.trim?.()); 
            if (订阅链接数组.length > 0) {
                const 请求订阅响应内容 = await getSUB(订阅链接数组, request, 追加UA, userAgentHeader);
                req_data += 请求订阅响应内容[0].join('\n');
                订阅转换URL += "|" + 请求订阅响应内容[1];

                if (订阅格式 == 'base64' && !isSubConverterRequest && 请求订阅响应内容[1].includes('://')) {
                    // 支持 base64 mixed 并加入容灾回退
                    try {
                        const u = buildSubUrl(subConverter, subConfig, 'mixed', 请求订阅响应内容[1], subProtocol);
                        const res = await fetch(u, { headers: { 'User-Agent': 'v2rayN/CF-SUB' } });
                        if (!res.ok) throw new Error();
                        req_data += '\n' + atob(await res.text());
                    } catch (error) {
                        try {
                            const fallbackU = buildSubUrl(defaultSubConverter, defaultSubConfig, 'mixed', 请求订阅响应内容[1], defaultSubProtocol);
                            const res2 = await fetch(fallbackU, { headers: { 'User-Agent': 'v2rayN/CF-SUB' } });
                            if (res2.ok) req_data += '\n' + atob(await res2.text());
                        } catch(e) { console.log('订阅转换 base64 容灾也失败'); }
                    }
                }
            }

            if (env.WARP) 订阅转换URL += "|" + (await ADD(env.WARP)).join("|");
            
            const utf8Encoder = new TextEncoder();
            const text = new TextDecoder().decode(utf8Encoder.encode(req_data));

            // 去广告过滤
            let adKeywords = [];
            let filteredLines = text.split('\n');
            if (config_noAds) {
                adKeywords = config_noAds.split(/,|\r?\n/).map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
                if (adKeywords.length > 0) {
                    filteredLines = filteredLines.filter(line => {
                        const lowerLine = line.toLowerCase();
                        return !adKeywords.some(keyword => lowerLine.includes(keyword));
                    });
                }
            }

            const uniqueLines = new Set(filteredLines);
            const result = [...uniqueLines].join('\n');

            let base64Data;
            try {
                base64Data = btoa(result);
            } catch (e) {
                function encodeBase64(data) {
                    const binary = new TextEncoder().encode(data);
                    let base64 = '';
                    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
                    for (let i = 0; i < binary.length; i += 3) {
                        const byte1 = binary[i]; const byte2 = binary[i + 1] || 0; const byte3 = binary[i + 2] || 0;
                        base64 += chars[byte1 >> 2];
                        base64 += chars[((byte1 & 3) << 4) | (byte2 >> 4)];
                        base64 += chars[((byte2 & 15) << 2) | (byte3 >> 6)];
                        base64 += chars[byte3 & 63];
                    }
                    const padding = 3 - (binary.length % 3 || 3);
                    return base64.slice(0, base64.length - padding) + '=='.slice(0, padding);
                }
                base64Data = encodeBase64(result)
            }

            const responseHeaders = {
                "content-type": "text/plain; charset=utf-8",
                "Profile-Update-Interval": `${SUBUpdateTime}`,
                "Profile-web-page-url": request.url.includes('?') ? request.url.split('?')[0] : request.url,
            };

            if (订阅格式 == 'base64' || token == fakeToken) {
                return new Response(base64Data, { headers: responseHeaders });
            } else {
                // 最终带有容灾机制的订阅请求
                try {
                    const finalUrl = buildSubUrl(subConverter, subConfig, 订阅格式, 订阅转换URL, subProtocol);
                    const res = await fetch(finalUrl, { headers: { 'User-Agent': userAgentHeader } });
                    if (!res.ok) throw new Error();
                    let content = await res.text();
                    if (订阅格式 == 'clash') content = clashFix(content);
                    if (!userAgent.includes('mozilla')) responseHeaders["Content-Disposition"] = `attachment; filename*=utf-8''${encodeURIComponent(FileName)}`;
                    return new Response(content, { headers: responseHeaders });
                } catch (error) {
                    // 后端与规则失效时，强行使用默认配置完成转换保底
                    try {
                        const fallbackUrl = buildSubUrl(defaultSubConverter, defaultSubConfig, 订阅格式, 订阅转换URL, defaultSubProtocol);
                        const resFb = await fetch(fallbackUrl, { headers: { 'User-Agent': userAgentHeader } });
                        if (!resFb.ok) throw new Error();
                        let contentFb = await resFb.text();
                        if (订阅格式 == 'clash') contentFb = clashFix(contentFb);
                        if (!userAgent.includes('mozilla')) responseHeaders["Content-Disposition"] = `attachment; filename*=utf-8''${encodeURIComponent(FileName)}`;
                        return new Response(contentFb, { headers: responseHeaders });
                    } catch (fallbackError) {
                        // 连保底也挂了，直接退化为输出 Base64
                        return new Response(base64Data, { headers: responseHeaders });
                    }
                }
            }
        }
    }
};

function buildSubUrl(api, config, target, urlToConvert, protocol) {
    let base = `${protocol}://${api}/sub?target=${target}&url=${encodeURIComponent(urlToConvert)}&insert=false&config=${encodeURIComponent(config)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false`;
    if (target === 'surge') base += '&ver=4&new_name=true';
    else if (target === 'quanx') base += '&udp=true';
    else if (target === 'clash' || target === 'singbox' || target === 'mixed') base += '&new_name=true';
    return base;
}

async function ADD(envadd) {
    var addtext = envadd.replace(/[ "'|\r\n]+/g, '\n').replace(/\n+/g, '\n');
    if (addtext.charAt(0) == '\n') addtext = addtext.slice(1);
    if (addtext.charAt(addtext.length - 1) == '\n') addtext = addtext.slice(0, addtext.length - 1);
    const add = addtext.split('\n');
    return add;
}

// ================== Apple 拼车业务防探测主页 ==================
async function nginx(titleName) {
    const text = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>${escapeHTML(titleName)}</title> 
    <meta name="description" content="Apple One、iCloud+ 与 Apple Creator Studio 家庭订阅共享，长期稳定，按月续费。">
    <meta name="keywords" content="Apple One, iCloud+, Apple Creator Studio, 家庭订阅, 订阅拼车">
    <style>
        :root {
            --bg: #f5f5f7;
            --text: #1d1d1f;
            --muted: #86868b;
            --coral: #ef684f;
            --coral-hover: #d9543d;
            --yellow: #f5c95b;
            --paper: #ffffff;
            --border: #e5e5ea;
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --bg: #000000;
                --text: #f5f5f7;
                --muted: #86868b;
                --paper: #1c1c1e;
                --border: #333336;
            }
        }

        * { box-sizing: border-box; }

        body {
            margin: 0;
            padding: 0;
            background-color: var(--bg);
            color: var(--text);
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Helvetica Neue", sans-serif;
            -webkit-font-smoothing: antialiased;
            line-height: 1.5;
        }

        .container { max-width: 1080px; margin: 0 auto; padding: 40px 20px; }

        /* Hero Section */
        .hero {
            background: linear-gradient(135deg, #fff7e8 0%, #ffe8dc 50%, #f7d8c9 100%);
            border-radius: 24px;
            padding: 60px 40px;
            margin-bottom: 50px;
            position: relative;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0,0,0,0.02);
        }

        @media (prefers-color-scheme: dark) {
            .hero {
                background: linear-gradient(135deg, #2d2422 0%, #2c2122 50%, #2a2222 100%);
                box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05);
            }
        }

        .kicker { color: var(--coral); font-size: 13px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 16px; display: block; }
        .hero h1 { font-size: clamp(32px, 5vw, 56px); margin: 0 0 16px; line-height: 1.1; letter-spacing: -0.02em; }
        .hero h1 strong { color: var(--coral); }
        .hero p { font-size: clamp(16px, 2.5vw, 18px); color: #5c514c; max-width: 600px; margin: 0; line-height: 1.6; }

        @media (prefers-color-scheme: dark) { .hero p { color: #a19b98; } }

        /* Section Titles */
        .section-title { font-size: 28px; margin: 0 0 24px; letter-spacing: -0.01em; }
        .section-title span { display: block; color: var(--coral); font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px; }

        /* Grid Cards */
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 50px; }
        .card { background: var(--paper); border: 1px solid var(--border); border-radius: 20px; padding: 30px; transition: transform 0.2s ease, box-shadow 0.2s ease; }
        .card.featured { border-color: var(--coral); background: rgba(239, 104, 79, 0.03); transform: translateY(-4px); box-shadow: 0 12px 40px rgba(239, 104, 79, 0.08); }
        .tag { background: var(--yellow); color: #533b13; font-size: 11px; font-weight: 800; padding: 6px 10px; border-radius: 6px; display: inline-block; margin-bottom: 20px; }
        .card h3 { margin: 0 0 12px; font-size: 22px; }
        .card p { color: var(--muted); font-size: 15px; margin: 0 0 20px; line-height: 1.6; min-height: 48px;}
        .card ul { list-style: none; padding: 0; margin: 0; }
        .card li { margin-bottom: 10px; font-size: 15px; display: flex; align-items: center; }
        .card li::before { content: "✓"; color: var(--coral); font-weight: 800; margin-right: 12px; font-size: 16px;}

        /* Table */
        .table-wrapper { background: var(--paper); border: 1px solid var(--border); border-radius: 20px; margin-bottom: 50px; overflow: hidden; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th, td { padding: 18px 20px; text-align: left; border-bottom: 1px solid var(--border); font-size: 15px; word-wrap: break-word; }
        th:nth-child(1), td:nth-child(1) { width: 50%; } 
        th:nth-child(2), td:nth-child(2) { width: 22%; }
        th:nth-child(3), td:nth-child(3) { width: 28%; }
        th { font-weight: 600; color: var(--muted); background: rgba(0,0,0,0.01); }
        @media (prefers-color-scheme: dark) { th { background: rgba(255,255,255,0.02); } }
        tr:last-child td { border-bottom: none; }
        .price { color: var(--coral); font-weight: 700; font-size: 17px; }
        .space { color: var(--muted); font-size: 14px; }

        /* Steps */
        .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 30px; margin-bottom: 60px; }
        .step { padding-top: 20px; border-top: 2px solid var(--yellow); }
        .step b { color: var(--coral); font-size: 12px; display: block; margin-bottom: 10px; letter-spacing: 0.1em;}
        .step h4 { margin: 0 0 10px; font-size: 19px; }
        .step p { margin: 0; color: var(--muted); font-size: 15px; line-height: 1.6;}

        /* Contact Box */
        .contact { background: #1c1c1e; color: #fff; padding: 36px 40px; border-radius: 24px; display: flex; justify-content: space-between; align-items: center; gap: 20px; }
        @media (prefers-color-scheme: dark) { .contact { background: #2c2c2e; } }
        .contact-info h2 { margin: 0 0 8px; font-size: 24px; }
        .contact-info p { margin: 0; color: #a1a1a6; font-size: 15px; }
        .btn { background: var(--coral); color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: 600; font-size: 15px; white-space: nowrap; transition: transform 0.2s ease, background 0.2s ease; display: inline-block; }
        .btn:hover { background: var(--coral-hover); transform: scale(0.98); }
        .footer-note { text-align: center; color: var(--muted); font-size: 13px; margin-top: 24px; }

        /* Mobile Adjustments */
        @media (max-width: 768px) {
            .container { padding: 20px 16px; }
            .hero { padding: 40px 24px; border-radius: 20px; margin-bottom: 40px;}
            .card.featured { transform: none; box-shadow: none; }
            .table-wrapper { border-radius: 16px; margin-bottom: 40px; }
            th, td { padding: 12px 10px; font-size: 13px; line-height: 1.3;}
            .price { font-size: 14px; }
            .space { font-size: 12px; }
            th:nth-child(1), td:nth-child(1) { width: 44%; } 
            th:nth-child(2), td:nth-child(2) { width: 25%; }
            th:nth-child(3), td:nth-child(3) { width: 31%; }
            .contact { flex-direction: column; text-align: center; padding: 30px 20px; }
            .btn { width: 100%; text-align: center; }
        }
    </style>
</head>
<body>
    <div class="container">
      <section class="hero">
        <span class="kicker">Apple subscription sharing</span>
        <h1>把常用的 Apple 服务，<br><strong>用更舒服的方式订阅。</strong></h1>
        <p>Apple One、iCloud+ 与 Apple Creator Studio 家庭订阅共享。长期稳定，按月续费，适合想省心使用 Apple 生态服务的你。</p>
      </section>

      <h2 class="section-title"><span>Choose your service</span>按需选择，不为用不到的功能买单</h2>
      <div class="grid">
        <article class="card featured">
          <span class="tag">热门选择</span>
          <h3>Apple One</h3>
          <p>把音乐、影视、游戏和云空间整合到一个家庭订阅中。</p>
          <ul><li>Apple Music</li><li>Apple TV+</li><li>Apple Arcade</li><li>iCloud+ 空间</li></ul>
        </article>
        <article class="card">
          <span class="tag">云空间</span>
          <h3>iCloud+</h3>
          <p>给照片、文件和设备备份留出更充足的空间，跨设备保持同步。</p>
          <ul><li>独立家庭成员席位</li><li>适合长期稳定使用</li><li>按月续费更灵活</li></ul>
        </article>
        <article class="card">
          <span class="tag">创作工具</span>
          <h3>Apple Creator Studio</h3>
          <p>面向创作者的 Apple 应用套装，适合视频、音乐和内容创作需求。</p>
          <ul><li>家庭订阅共享</li><li>按需加入或续费</li><li>使用问题可咨询</li></ul>
        </article>
      </div>

      <h2 class="section-title"><span>Pricing plans</span>常见套餐与价格</h2>
      <div class="table-wrapper">
          <table>
            <thead>
              <tr><th>订阅组合</th><th>每月定价</th><th>个人 iCloud 空间</th></tr>
            </thead>
            <tbody>
              <tr><td>Apple One</td><td><span class="price">¥6</span></td><td><span class="space">40 GB</span></td></tr>
              <tr><td>iCloud+ (2TB)</td><td><span class="price">¥13</span></td><td><span class="space">400 GB</span></td></tr>
              <tr><td>Apple One + iCloud+ (2TB)</td><td><span class="price">¥19</span></td><td><span class="space">440 GB</span></td></tr>
              <tr><td>Apple Creator Studio + Apple One</td><td><span class="price">¥12</span></td><td><span class="space">33 GB</span></td></tr>
              <tr><td>Apple Creator Studio + One + iCloud+</td><td><span class="price">¥23</span></td><td><span class="space">366 GB</span></td></tr>
              <tr><td>日常全家桶 (One + iCloud+ + Fitness)</td><td><span class="price">¥22</span></td><td><span class="space">440 GB</span></td></tr>
              <tr><td>创作者全家桶 (One + iCloud+ + Creator + Fitness)</td><td><span class="price">¥26</span></td><td><span class="space">366 GB</span></td></tr>
            </tbody>
          </table>
      </div>

      <h2 class="section-title"><span>Simple process</span>三步开始使用</h2>
      <div class="steps">
        <div class="step"><b>01 / 咨询</b><h4>告诉我你的需求</h4><p>说明想订阅的服务、地区和设备情况，我会帮你确认合适的方案。</p></div>
        <div class="step"><b>02 / 确认</b><h4>确认席位与周期</h4><p>沟通价格、续费周期和注意事项，信息透明后再决定是否加入。</p></div>
        <div class="step"><b>03 / 加入</b><h4>邀请加入家庭组</h4><p>完成订阅后按指引加入家庭组，随后即可开始使用对应服务。</p></div>
      </div>

      <section class="contact">
        <div class="contact-info">
          <h2>想了解当前可用席位？</h2>
          <p>订阅状态和价格可能随平台规则变化，联系邮箱: hooleeasia@gmail.com</p>
        </div>
        <a class="btn" href="mailto:hooleeasia@gmail.com">联系我咨询</a>
      </section>
      
      <p class="footer-note">家庭订阅共享需遵循 Apple 服务条款。页面信息仅用于服务介绍，具体以咨询时的最新情况为准。</p>
    </div>
</body>
</html>
    `;
    return text;
}

function base64Decode(str) {
    const bytes = new Uint8Array(atob(str).split('').map(c => c.charCodeAt(0)));
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
}

async function MD5MD5(text) {
    const encoder = new TextEncoder();
    const firstPass = await crypto.subtle.digest('MD5', encoder.encode(text));
    const firstHex = Array.from(new Uint8Array(firstPass)).map(b => b.toString(16).padStart(2, '0')).join('');
    const secondPass = await crypto.subtle.digest('MD5', encoder.encode(firstHex.slice(7, 27)));
    return Array.from(new Uint8Array(secondPass)).map(b => b.toString(16).padStart(2, '0')).join('').toLowerCase();
}

function clashFix(content) {
    if (content.includes('wireguard') && !content.includes('remote-dns-resolve')) {
        let lines = content.includes('\r\n') ? content.split('\r\n') : content.split('\n');
        let result = "";
        for (let line of lines) {
            if (line.includes('type: wireguard')) {
                result += line.replace(new RegExp(`, mtu: 1280, udp: true`, 'g'), `, mtu: 1280, remote-dns-resolve: true, udp: true`) + '\n';
            } else result += line + '\n';
        }
        return result;
    }
    return content;
}

async function proxyURL(proxyURL, url) {
    const URLs = await ADD(proxyURL);
    const fullURL = URLs[Math.floor(Math.random() * URLs.length)];
    let parsedURL = new URL(fullURL);
    let URLPathname = parsedURL.pathname;
    if (URLPathname.charAt(URLPathname.length - 1) == '/') URLPathname = URLPathname.slice(0, -1);
    URLPathname += url.pathname;
    let newURL = `${parsedURL.protocol.slice(0, -1) || 'https'}://${parsedURL.hostname}${URLPathname}${parsedURL.search}`;
    let response = await fetch(newURL);
    let newResponse = new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
    newResponse.headers.set('X-New-URL', newURL);
    return newResponse;
}

async function getSUB(api, request, 追加UA, userAgentHeader) {
    if (!api || api.length === 0) return [];
    else api = [...new Set(api)]; 
    let newapi = ""; let 订阅转换URLs = ""; let 异常订阅 = "";
    const controller = new AbortController(); 
    const timeout = setTimeout(() => { controller.abort(); }, 2000);

    try {
        const responses = await Promise.allSettled(api.map(apiUrl => getUrl(request, apiUrl, 追加UA, userAgentHeader).then(response => response.ok ? response.text() : Promise.reject(response))));
        const modifiedResponses = responses.map((response, index) => {
            if (response.status === 'rejected') {
                return { status: (response.reason && response.reason.name === 'AbortError') ? '超时' : '请求失败', value: null, apiUrl: api[index] };
            }
            return { status: response.status, value: response.value, apiUrl: api[index] };
        });

        for (const response of modifiedResponses) {
            if (response.status === 'fulfilled') {
                const content = await response.value || 'null'; 
                if (content.includes('proxies:') || (content.includes('outbounds"') && content.includes('inbounds"'))) {
                    订阅转换URLs += "|" + response.apiUrl; 
                } else if (content.includes('://')) {
                    newapi += content + '\n'; 
                } else if (isValidBase64(content)) {
                    newapi += base64Decode(content) + '\n'; 
                } else {
                    const 异常订阅LINK = `trojan://CMLiussss@127.0.0.1:8888?security=tls&allowInsecure=1&type=tcp&headerType=none#%E5%BC%82%E5%B8%B8%E8%AE%A2%E9%98%85%20${response.apiUrl.split('://')[1].split('/')[0]}`;
                    异常订阅 += `${异常订阅LINK}\n`;
                }
            }
        }
    } catch (error) { } finally { clearTimeout(timeout); }
    return [await ADD(newapi + 异常订阅), 订阅转换URLs];
}

async function getUrl(request, targetUrl, 追加UA, userAgentHeader) {
    const newHeaders = new Headers(request.headers);
    newHeaders.set("User-Agent", `${atob('djJyYXlOLzYuNDU=')} cmliu/CF-SUB ${追加UA}(${userAgentHeader})`);
    return fetch(new Request(targetUrl, {
        method: request.method, headers: newHeaders, body: request.method === "GET" ? null : request.body,
        redirect: "follow", cf: { insecureSkipVerify: true, allowUntrusted: true, validateCertificate: false }
    }));
}

function isValidBase64(str) { return /^[A-Za-z0-9+/=]+$/.test(str.replace(/\s/g, '')); }

async function 迁移地址列表(env, txt = 'ADD.txt') {
    const 旧数据 = await env.KV.get(`/${txt}`); const 新数据 = await env.KV.get(txt);
    if (旧数据 && !新数据) { await env.KV.put(txt, 旧数据); await env.KV.delete(`/${txt}`); return true; }
    return false;
}

function getCookie(request, name) {
    const cookie = request.headers.get('Cookie') || '';
    const cookies = cookie.split(';').map(item => item.trim());
    for (const item of cookies) {
        const index = item.indexOf('=');
        if (index === -1) continue;
        if (item.slice(0, index) === name) return decodeURIComponent(item.slice(index + 1));
    }
    return '';
}

function escapeHTML(text = '') {
    return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function getAdminSessionValue(user, pass, token) {
    if (!user || !pass) return '';
    return await MD5MD5(`${user}:${pass}:${token}:admin-login`);
}

function isAdminLoginEnabled(user, pass) { return !!(user && pass); }

async function isAdminLoggedIn(request, token, user, pass) {
    const session = await getAdminSessionValue(user, pass, token);
    return session ? getCookie(request, 'CF_SUB_ADMIN') === session : false;
}

function buildAdminCookie(value, url) {
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    return `CF_SUB_ADMIN=${encodeURIComponent(value)}; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

async function handleAdminLogin(request, url, token, user, pass) {
    let inputUser = '', inputPass = '';
    try {
        const form = await request.formData();
        inputUser = String(form.get('username') || '');
        inputPass = String(form.get('password') || '');
    } catch (e) { return new Response(renderLoginPage(url, '登录请求格式不正确'), { status: 400, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } }); }

    if (inputUser === user && inputPass === pass) {
        const session = await getAdminSessionValue(user, pass, token);
        return new Response('', { status: 302, headers: { 'Location': url.pathname, 'Set-Cookie': buildAdminCookie(session, url), 'Cache-Control': 'no-store' } });
    }
    return new Response(renderLoginPage(url, '用户名或密码错误'), { status: 401, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } });
}

function getToolStyles() {
    return `
        * { box-sizing: border-box; }
        body { margin: 0; background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); color: #202124; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.5; min-height: 100vh; }
        .page { width: 100%; max-width: 760px; margin: 0 auto; padding: 18px 14px 28px; }
        .header { margin-bottom: 14px; }
        .title { margin: 0; font-size: 28px; font-weight: 700; line-height: 1.2; color: #1a1a1a; }
        .subtitle { margin-top: 8px; color: #666; font-size: 13px; }
        .panel { background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.5); border-radius: 20px; padding: 16px; margin-top: 12px; box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.1); }
        .section-title { margin: 0 0 10px; font-size: 15px; font-weight: 700; }
        .section-note { margin: 4px 0 10px; color: #888; font-size: 12px; }
        .link-list { display: grid; gap: 10px; }
        .link-item { border: 1px solid rgba(229, 229, 223, 0.6); border-radius: 12px; padding: 12px; background: rgba(255, 255, 255, 0.5); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
        .link-label { font-weight: 600; margin-bottom: 8px; color: #1a1a1a; }
        .link-url { display: block; width: 100%; word-wrap: break-word; overflow-wrap: break-word; word-break: break-all; white-space: normal; padding: 10px 10px; border: 1px solid rgba(229, 229, 223, 0.8); border-radius: 8px; background: rgba(250, 250, 250, 0.7); color: #1f4b99; text-decoration: none; transition: all 0.3s ease; }
        .link-url:hover { background: rgba(31, 75, 153, 0.05); border-color: #1f4b99; }
        .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
        button { min-height: 36px; padding: 8px 16px; border: 1px solid rgba(34, 34, 34, 0.2); border-radius: 10px; background: rgba(34, 34, 34, 0.8); color: #fff; font-size: 14px; cursor: pointer; font-weight: 500; transition: all 0.3s ease; }
        button:hover { background: rgba(34, 34, 34, 0.9); box-shadow: 0 4px 12px rgba(34, 34, 34, 0.15); }
        button.secondary { background: rgba(255, 255, 255, 0.8); color: #222; border-color: rgba(200, 200, 192, 0.5); }
        button.secondary:hover { background: rgba(255, 255, 255, 0.95); }
        button.hidden-btn { background: rgba(34, 34, 34, 0.6); }
        button:disabled { opacity: 0.65; cursor: default; }
        .field { margin-top: 12px; }
        label { display: block; margin-bottom: 6px; font-weight: 600; color: #1a1a1a; }
        input, textarea { width: 100%; border: 1px solid rgba(207, 207, 200, 0.6); border-radius: 10px; background: rgba(255, 255, 255, 0.8); color: #202124; font-size: 14px; padding: 10px; transition: border-color 0.2s; word-wrap: break-word; word-break: break-all; white-space: pre-wrap; }
        input:focus, textarea:focus { outline: none; border-color: #3b82f6; background: #fff; }
        input { height: 42px; white-space: normal; }
        textarea { min-height: 200px; line-height: 1.5; resize: vertical; }
        .error { color: #b00020; margin-top: 10px; }
        .muted { color: #666; font-size: 13px; margin-left: 8px; }
        .toast { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); display: none; min-width: 190px; max-width: calc(100vw - 40px); padding: 12px 18px; text-align: center; color: #fff; background: rgba(0, 0, 0, 0.82); border-radius: 12px; z-index: 9999; }
        .status-indicator { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 8px; font-weight: 600; width: 100%; word-break: break-all;}
        .status-ok { background: rgba(76, 175, 80, 0.15); color: #2e7d32; border: 1px solid rgba(76, 175, 80, 0.2); }
        .status-error { background: rgba(244, 67, 54, 0.1); color: #c62828; border: 1px solid rgba(244, 67, 54, 0.2); }
        #current-qrcode { display: none; margin-top: 12px; padding: 12px; border: 1px solid rgba(229, 229, 223, 0.6); border-radius: 12px; background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(10px); width: fit-content; max-width: 100%; }
        .hidden { display: none; }
    `;
}

function getSubscriptionLinks(url, token, isGuest = false) {
    const base = `https://${url.hostname}/${token}`;
    return [
        ['自适应订阅地址', base],
        ['Base64订阅地址', `${base}?b64`],
        ['Clash订阅地址', `${base}?clash`],
        ['Sing-box订阅地址', `${base}?sb`],
        ['Surge订阅地址', `${base}?surge`],
        ['Loon订阅地址', `${base}?loon`],
    ];
}

function renderLinkList(links) {
    return `<div class="link-list">
        ${links.map(([label, value, displayValue]) => `
            <div class="link-item">
                <div class="link-label">${escapeHTML(label)}</div>
                <a class="link-url" href="${escapeHTML(value)}" target="_blank">${escapeHTML(displayValue || value)}</a>
                <div class="actions">
                    <button type="button" class="copy-btn" onclick="copySubscription(this)" data-url="${escapeHTML(value)}">复制</button>
                    <button type="button" class="secondary hide-btn hidden" onclick="hideQrcode(this)">隐藏二维码</button>
                </div>
            </div>`).join('')}
    </div>`;
}

function renderToolScripts(includeEditor = false) {
    return `<script>
        let toastTimer;
        function showToast(message) {
            const toast = document.getElementById('copyNotice'); toast.textContent = message; toast.style.display = 'block';
            clearTimeout(toastTimer); toastTimer = setTimeout(function () { toast.style.display = 'none'; }, 1500);
        }
        function copySubscription(button) {
            navigator.clipboard.writeText(button.dataset.url).then(function () {
                showToast('已复制到剪贴板'); showQrcode(button); button.classList.add('hidden');
                const hideBtn = button.closest('.actions').querySelector('.hide-btn'); if (hideBtn) hideBtn.classList.remove('hidden');
            }).catch(function (err) { showToast('复制失败，请手动复制'); });
        }
        function showQrcode(button) {
            const qrcodeDiv = document.getElementById('current-qrcode');
            button.closest('.link-item').appendChild(qrcodeDiv);
            qrcodeDiv.innerHTML = ''; qrcodeDiv.style.display = 'block';
            new QRCode(qrcodeDiv, { text: button.dataset.url, width: 220, height: 220, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.Q });
        }
        function hideQrcode(button) {
            const qrcodeDiv = document.getElementById('current-qrcode');
            qrcodeDiv.style.display = 'none'; qrcodeDiv.innerHTML = ''; button.classList.add('hidden');
            const copyBtn = button.closest('.actions').querySelector('.copy-btn'); if (copyBtn) copyBtn.classList.remove('hidden');
        }
        ${includeEditor ? `
        function saveConfig(button) {
            const statusElem = document.getElementById('configSaveStatus');
            button.disabled = true; button.textContent = '保存中...';
            fetch(window.location.href, {
                method: 'POST',
                body: JSON.stringify({ type: 'config', settings: {
                    guest: document.getElementById('config-guest').value,
                    user: document.getElementById('config-user').value,
                    pass: document.getElementById('config-pass').value,
                    subName: document.getElementById('config-subname').value,
                    subApi: document.getElementById('config-subapi').value,
                    subConfig: document.getElementById('config-subconfig').value,
                    noAds: document.getElementById('config-noads').value
                }}),
                headers: { 'Content-Type': 'application/json' }
            }).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                statusElem.textContent = '已保存 ' + new Date().toLocaleString(); statusElem.style.color = '#2e7d32';
                setTimeout(() => location.reload(), 800); 
            }).catch(function (err) { statusElem.textContent = '保存失败: ' + err.message; statusElem.style.color = '#b00020'; })
            .finally(function () { button.disabled = false; button.textContent = '保存全局设置'; });
        }
        function saveContent(button) {
            const textarea = document.getElementById('content'); const statusElem = document.getElementById('saveStatus');
            if (!textarea) return;
            textarea.value = textarea.value.replace(/：/g, ':');
            button.disabled = true; button.textContent = '保存中...';
            fetch(window.location.href, {
                method: 'POST', body: JSON.stringify({ type: 'content', content: textarea.value || '' }),
                headers: { 'Content-Type': 'application/json' }
            }).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                statusElem.textContent = '已保存 ' + new Date().toLocaleString(); statusElem.style.color = '#2e7d32';
            }).catch(function (err) { statusElem.textContent = '保存失败: ' + err.message; statusElem.style.color = '#b00020'; })
            .finally(function () { button.disabled = false; button.textContent = '保存节点订阅'; });
        }
        ` : ''}
    </script>`;
}

function renderLoginPage(url, error = '') {
    return `<!DOCTYPE html><html><head><title>${escapeHTML(FileName)} 管理员登录</title><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${getToolStyles()}.login-btn { display: block; width: 100%; max-width: 280px; min-height: 44px; margin: 28px auto 6px; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); border: none; border-radius: 12px; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; } .login-btn:hover { background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%); } .error { text-align: center; margin-top: 15px; }</style></head><body><main class="page"><header class="header"><h1 class="title">${escapeHTML(FileName)}订阅管理</h1><div class="subtitle">管理员登录</div></header><section class="panel"><form method="POST" action="${escapeHTML(url.pathname)}"><div class="field"><label>用户名</label><input name="username" type="text" required autofocus></div><div class="field"><label>密码</label><input name="password" type="password" required></div><button type="submit" class="login-btn">登录</button>${error ? `<div class="error">${escapeHTML(error)}</div>` : ''}</form></section></main></body></html>`;
}

function renderGuestPage(url, guest, displayApiUrl, displayConfig) {
    return `<!DOCTYPE html><html><head><title>${escapeHTML(FileName)} 访客订阅</title><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${getToolStyles()}</style><script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js"></script></head><body><div id="copyNotice" class="toast"></div><main class="page"><header class="header"><h1 class="title">${escapeHTML(FileName)} 访客订阅</h1><div class="subtitle">复制订阅链接或生成二维码</div></header><section class="panel"><h2 class="section-title">订阅链接</h2>${renderLinkList(getSubscriptionLinks(url, guest, true))}</section><section class="panel"><h2 class="section-title">当前提供服务的真实转换配置</h2><div class="section-note">已剥离失效设置，所展示即为实际输出数据的接口链路</div><div class="status-indicator status-ok">✅ SUBAPI 正常连通</div><div class="status-indicator status-ok">✅ SUBCONFIG 规则链路有效</div><div class="link-list"><div class="link-item"><div class="link-label">正在使用的 SUBAPI 后端</div><a class="link-url" href="${escapeHTML(displayApiUrl)}" target="_blank">${escapeHTML(displayApiUrl)}</a></div><div class="link-item"><div class="link-label">正在使用的 SUBCONFIG 规则</div><a class="link-url" href="${escapeHTML(displayConfig)}" target="_blank">${escapeHTML(displayConfig)}</a></div></div></section><div id="current-qrcode"></div></main>${renderToolScripts(false)}</body></html>`;
}

function renderAdminPage(url, content, hasKV, guest, settings, apiOk, configOk, currentApi, currentConfig) {
    return `<!DOCTYPE html><html><head><title>${escapeHTML(settings.subName)}</title><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${getToolStyles()}</style><script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js"></script></head><body><div id="copyNotice" class="toast"></div><main class="page"><header class="header"><h1 class="title">${escapeHTML(settings.subName)}</h1><div class="subtitle">汇聚订阅控制台</div></header>

    <section class="panel">
        <h2 class="section-title">全局设置 (绑定KV空间后生效)</h2>
        <div class="field"><label for="config-guest">访客订阅入口 (GUEST)</label><input id="config-guest" type="text" value="${escapeHTML(settings.guest || '')}" placeholder="留空则按内置算法自动生成"></div>
        <div class="field"><label for="config-user">后台登录账号 (USER)</label><input id="config-user" type="text" value="${escapeHTML(settings.user || '')}" placeholder="例如：admin"></div>
        <div class="field"><label for="config-pass">后台登录密码 (PASS)</label><input id="config-pass" type="text" value="${escapeHTML(settings.pass || '')}" placeholder="例如：123456"></div>
        <div class="field"><label for="config-subname">站点/订阅名称 (SUBNAME)</label><input id="config-subname" type="text" value="${escapeHTML(settings.subName)}" placeholder="例如：CF-SUB"></div>
        
        <div class="field">
            <label for="config-subapi">订阅转换后端 (SUBAPI)</label>
            <input id="config-subapi" type="text" value="${escapeHTML(settings.subApi)}" placeholder="例如：SUBAPI.cmliussss.net">
            <div class="status-indicator ${apiOk ? 'status-ok' : 'status-error'}" style="margin-top: 8px;">
                ${apiOk ? `✅ SUBAPI 正常连通 (${escapeHTML(currentApi)})` : `❌ 配置的后端无法连通 (${escapeHTML(currentApi)})，现已启用容灾回退 (${escapeHTML(defaultSubConverter)})`}
            </div>
        </div>
        
        <div class="field">
            <label for="config-subconfig">转换规则 (SUBCONFIG)</label>
            <textarea id="config-subconfig" style="min-height:80px">${escapeHTML(settings.subConfig)}</textarea>
            <div class="status-indicator ${configOk ? 'status-ok' : 'status-error'}" style="margin-top: 8px;">
                ${configOk ? `✅ SUBCONFIG 规则链路有效` : `❌ 配置的规则无法读取，现已启用容灾回退 (默认规则)`}
            </div>
        </div>
        
        <div class="field"><label for="config-noads">去广告关键字 (NOADS) <span class="muted" style="font-weight: normal;">逗号或换行分隔</span></label><textarea id="config-noads" style="min-height: 80px;" placeholder="剩余流量,官网,套餐">${escapeHTML(settings.noAds)}</textarea></div>
        ${hasKV ? `<div class="actions" style="margin-top:16px;"><button type="button" onclick="saveConfig(this)">保存全局设置并重载</button><span id="configSaveStatus" class="muted"></span></div>` : '<p class="muted">请绑定变量名称为 KV 的 KV 命名空间</p>'}
    </section>

    <section class="panel"><h2 class="section-title">汇聚订阅节点编辑</h2>${hasKV ? `<textarea id="content" placeholder="在此输入单节点链接或订阅地址...">${escapeHTML(content)}</textarea><div class="actions"><button type="button" onclick="saveContent(this)">保存节点订阅</button><span id="saveStatus" class="muted"></span></div>` : '<p class="muted">请绑定变量名称为 KV 的 KV 命名空间</p>'}</section>
    <section class="panel"><h2 class="section-title">管理员订阅链接</h2>${renderLinkList(getSubscriptionLinks(url, mytoken, false))}</section>
    <section class="panel"><h2 class="section-title">访客订阅链接</h2>${renderLinkList(getSubscriptionLinks(url, guest, true))}</section>
    <div id="current-qrcode"></div></main>${renderToolScripts(true)}</body></html>`;
}

async function KV(request, env, txt, guest, apiOk, configOk, currentApi, currentConfig) {
    let settings = { subName: 'CF-SUB', subApi: '', subConfig: '', noAds: '', guest: '', user: '', pass: '' };
    let hasKV = !!env.KV;
    
    if (hasKV) {
        try { 
            const kvConfigStr = await env.KV.get('CONFIG.json'); 
            if (kvConfigStr) settings = { ...settings, ...JSON.parse(kvConfigStr) }; 
        } catch (e) {}
    }

    try {
        if (request.method === "POST") {
            if (!hasKV) return new Response("未绑定KV空间", { status: 400 });
            
            // 拦截非 JSON 格式的恶意/误导表单提交（如二次登录覆盖）
            const contentType = request.headers.get('content-type') || '';
            if (contentType.includes('application/x-www-form-urlencoded')) {
                return Response.redirect(request.url, 302);
            }

            const text = await request.text();
            try {
                const data = JSON.parse(text);
                if (data.type === 'config') { 
                    await env.KV.put('CONFIG.json', JSON.stringify(data.settings)); 
                    return new Response("设置保存成功"); 
                } 
                else if (data.type === 'content') { 
                    await env.KV.put(txt, data.content || ''); 
                    return new Response("订阅保存成功"); 
                }
            } catch (jsonErr) { 
                // 仅用于向下兼容的旧版存储方式，现已被 JSON 格式取代
                return new Response("不支持的数据格式", { status: 400 }); 
            }
        }
        
        let content = '';
        if (hasKV) try { content = await env.KV.get(txt) || ''; } catch (error) { content = '读取数据时发生错误'; }
        
        return new Response(
            renderAdminPage(new URL(request.url), content, hasKV, guest, settings, apiOk, configOk, currentApi, currentConfig), 
            { headers: { "Content-Type": "text/html;charset=utf-8" } }
        );
    } catch (error) { 
        return new Response("服务器错误: " + error.message, { status: 500 }); 
    }
}
