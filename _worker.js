// 部署完成后在网址后面加上这个，获取自建节点和机场聚合节点，/?token=auto或/auto或

let mytoken = 'auto';
let guestToken = ''; //可以随便取，或者uuid生成，https://1024tools.com/uuid
let FileName = 'CF-Workers-SUB';
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
            else return new Response(await nginx(), {
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
                        // 访客访问：展示实际工作的配置（如果自定义失效，向访客展示默认的有效配置）
                        const displayApi = apiOk ? subConverter : defaultSubConverter;
                        const displayProtocol = apiOk ? subProtocol : defaultSubProtocol;
                        const displayConfig = configOk ? subConfig : defaultSubConfig;
                        return new Response(renderGuestPage(url, 访客订阅, `${displayProtocol}://${displayApi}`, displayConfig), { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
                    } else {
                        if (isAdminLoginEnabled(env)) {
                            const isLoggedIn = await isAdminLoggedIn(request, env, mytoken);
                            if (!isLoggedIn) {
                                if (request.method === 'POST') return await handleAdminLogin(request, env, url, mytoken);
                                return new Response(renderLoginPage(url), { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' }});
                            }
                        }
                        // 管理员访问：传入检测状态展示
                        return await KV(request, env, 'LINK.txt', 访客订阅, apiOk, configOk);
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
            if (!(userAgent.includes('null') || isSubConverterRequest || userAgent.includes('nekobox') || userAgent.includes(('CF-Workers-SUB').toLowerCase()))) {
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
                        const res = await fetch(u, { headers: { 'User-Agent': 'v2rayN/CF-Workers-SUB' } });
                        if (!res.ok) throw new Error();
                        req_data += '\n' + atob(await res.text());
                    } catch (error) {
                        try {
                            const fallbackU = buildSubUrl(defaultSubConverter, defaultSubConfig, 'mixed', 请求订阅响应内容[1], defaultSubProtocol);
                            const res2 = await fetch(fallbackU, { headers: { 'User-Agent': 'v2rayN/CF-Workers-SUB' } });
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

async function nginx() {
    return `<!DOCTYPE html><html><head><title>Welcome to nginx!</title><style>body { width: 35em; margin: 0 auto; font-family: Tahoma, Verdana, Arial, sans-serif; }</style></head><body><h1>Welcome to nginx!</h1><p>If you see this page, the nginx web server is successfully installed and working. Further configuration is required.</p></body></html>`;
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
    newHeaders.set("User-Agent", `${atob('djJyYXlOLzYuNDU=')} cmliu/CF-Workers-SUB ${追加UA}(${userAgentHeader})`);
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

async function getAdminSessionValue(env, token) {
    if (!isAdminLoginEnabled(env)) return '';
    return await MD5MD5(`${env.USER}:${env.PASS}:${token}:admin-login`);
}

function isAdminLoginEnabled(env) { return !!(env.USER && env.PASS); }

async function isAdminLoggedIn(request, env, token) {
    const session = await getAdminSessionValue(env, token);
    return session ? getCookie(request, 'CF_SUB_ADMIN') === session : false;
}

function buildAdminCookie(value, url) {
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    return `CF_SUB_ADMIN=${encodeURIComponent(value)}; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

async function handleAdminLogin(request, env, url, token) {
    let username = '', password = '';
    try {
        const form = await request.formData();
        username = String(form.get('username') || '');
        password = String(form.get('password') || '');
    } catch (e) { return new Response(renderLoginPage(url, '登录请求格式不正确'), { status: 400, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } }); }

    if (username === env.USER && password === env.PASS) {
        const session = await getAdminSessionValue(env, token);
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
        /* 【重要修复】优化长链接强制换行与完整显示 */
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
        /* 【重要修复】针对所有输入区域开启长文本完美换行 */
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
    const base = isGuest ? `https://${url.hostname}/sub?token=${token}` : `https://${url.hostname}/${token}`;
    const subBase = isGuest ? base : `${base}?sub`;
    return [
        ['自适应订阅地址', subBase],
        ['Base64订阅地址', isGuest ? `${base}&b64` : `${base}?b64`],
        ['Clash订阅地址', isGuest ? `${base}&clash` : `${base}?clash`],
        ['Sing-box订阅地址', isGuest ? `${base}&sb` : `${base}?sb`],
        ['Surge订阅地址', isGuest ? `${base}&surge` : `${base}?surge`],
        ['Loon订阅地址', isGuest ? `${base}&loon` : `${base}?loon`],
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
    return `<!DOCTYPE html><html><head><title>${escapeHTML(FileName)} 访客订阅</title><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${getToolStyles()}</style><script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js"></script></head><body><div id="copyNotice" class="toast"></div><main class="page"><header class="header"><h1 class="title">${escapeHTML(FileName)} 访客订阅</h1><div class="subtitle">复制订阅链接或生成二维码</div></header><section class="panel"><h2 class="section-title">订阅链接</h2>${renderLinkList(getSubscriptionLinks(url, guest, true))}</section><section class="panel"><h2 class="section-title">当前提供服务的真实转换配置</h2><div class="section-note">已剥离失效设置，所展示即为实际输出数据的接口链路</div><div class="link-list"><div class="link-item"><div class="link-label">正在使用的 SUBAPI 后端</div><a class="link-url" href="${escapeHTML(displayApiUrl)}" target="_blank">${escapeHTML(displayApiUrl)}</a></div><div class="link-item"><div class="link-label">正在使用的 SUBCONFIG 规则</div><a class="link-url" href="${escapeHTML(displayConfig)}" target="_blank">${escapeHTML(displayConfig)}</a></div></div></section><div id="current-qrcode"></div></main>${renderToolScripts(false)}</body></html>`;
}

function renderAdminPage(url, content, hasKV, guest, settings, apiOk, configOk) {
    return `<!DOCTYPE html><html><head><title>${escapeHTML(settings.subName)}</title><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${getToolStyles()}</style><script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js"></script></head><body><div id="copyNotice" class="toast"></div><main class="page"><header class="header"><h1 class="title">${escapeHTML(settings.subName)}</h1><div class="subtitle">汇聚订阅控制台</div></header>

    <section class="panel">
        <h2 class="section-title">订阅转换引擎检测状态</h2>
        <div class="status-indicator ${apiOk ? 'status-ok' : 'status-error'}">
            ${apiOk ? `✅ SUBAPI 正常连通 (${escapeHTML(settings.subApi)})` : `❌ 自定义 SUBAPI 无法连通，现已启用容灾回退 (${escapeHTML(defaultSubConverter)})`}
        </div>
        <div class="status-indicator ${configOk ? 'status-ok' : 'status-error'}">
            ${configOk ? `✅ SUBCONFIG 规则链路有效` : `❌ 自定义规则无法读取，现已启用容灾回退 (默认规则)`}
        </div>
    </section>

    <section class="panel">
        <h2 class="section-title">全局设置 (绑定KV空间后生效)</h2>
        <div class="field"><label for="config-subname">站点/订阅名称 (SUBNAME)</label><input id="config-subname" type="text" value="${escapeHTML(settings.subName)}"></div>
        <div class="field"><label for="config-subapi">订阅转换后端 (SUBAPI)</label><input id="config-subapi" type="text" value="${escapeHTML(settings.subApi)}" placeholder="例如：SUBAPI.cmliussss.net"></div>
        <div class="field"><label for="config-subconfig">转换规则 (SUBCONFIG)</label><textarea id="config-subconfig" style="min-height:80px">${escapeHTML(settings.subConfig)}</textarea></div>
        <div class="field"><label for="config-noads">去广告关键字 (NOADS) <span class="muted" style="font-weight: normal;">逗号或换行分隔</span></label><textarea id="config-noads" style="min-height: 80px;" placeholder="剩余流量,官网,套餐">${escapeHTML(settings.noAds)}</textarea></div>
        ${hasKV ? `<div class="actions"><button type="button" onclick="saveConfig(this)">保存并重新检测</button><span id="configSaveStatus" class="muted"></span></div>` : '<p class="muted">请绑定变量名称为 KV 的 KV 命名空间</p>'}
    </section>

    <section class="panel"><h2 class="section-title">汇聚订阅节点编辑</h2>${hasKV ? `<textarea id="content" placeholder="在此输入单节点链接或订阅地址...">${escapeHTML(content)}</textarea><div class="actions"><button type="button" onclick="saveContent(this)">保存节点订阅</button><span id="saveStatus" class="muted"></span></div>` : '<p class="muted">请绑定变量名称为 KV 的 KV 命名空间</p>'}</section>
    <section class="panel"><h2 class="section-title">管理员订阅链接</h2>${renderLinkList(getSubscriptionLinks(url, mytoken, false))}</section>
    <section class="panel"><h2 class="section-title">访客订阅链接</h2>${renderLinkList(getSubscriptionLinks(url, guest, true))}</section>
    <div id="current-qrcode"></div></main>${renderToolScripts(true)}</body></html>`;
}

async function KV(request, env, txt, guest, apiOk, configOk) {
    let settings = { subName: 'CF-Workers-SUB', subApi: defaultSubConverter, subConfig: defaultSubConfig, noAds: '' };
    let hasKV = !!env.KV;
    if (hasKV) {
        try { const kvConfigStr = await env.KV.get('CONFIG.json'); if (kvConfigStr) settings = { ...settings, ...JSON.parse(kvConfigStr) }; } catch (e) {}
    }
    try {
        if (request.method === "POST") {
            if (!hasKV) return new Response("未绑定KV空间", { status: 400 });
            const text = await request.text();
            try {
                const data = JSON.parse(text);
                if (data.type === 'config') { await env.KV.put('CONFIG.json', JSON.stringify(data.settings)); return new Response("设置保存成功"); } 
                else if (data.type === 'content') { await env.KV.put(txt, data.content || ''); return new Response("订阅保存成功"); }
            } catch (jsonErr) { await env.KV.put(txt, text); return new Response("保存成功"); }
        }
        let content = '';
        if (hasKV) try { content = await env.KV.get(txt) || ''; } catch (error) { content = '读取数据时发生错误'; }
        return new Response(renderAdminPage(new URL(request.url), content, hasKV, guest, settings, apiOk, configOk), { headers: { "Content-Type": "text/html;charset=utf-8" } });
    } catch (error) { return new Response("服务器错误: " + error.message, { status: 500 }); }
}
