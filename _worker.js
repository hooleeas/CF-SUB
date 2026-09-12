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
let subConverter = "SUBAPI.cmliussss.net"; //在线订阅转换后端，目前使用CM的订阅转换功能。支持自建psub 可自行搭建https://github.com/bulianglin/psub
let subConfig = "https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_MultiCountry.ini"; //订阅配置文件
let subProtocol = 'https';
let config_noAds = ''; // 去广告关键字缓存

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
        
        // 判定当前访问路径是否为访客专属路径
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
                headers: {
                    'Content-Type': 'text/html; charset=UTF-8',
                },
            });
        } else {
            if (env.KV) {
                await 迁移地址列表(env, 'LINK.txt');
                // 浏览器直接访问且不带转换参数时的UI分流逻辑
                if (userAgent.includes('mozilla') && !url.search && !isProxyClientUA) {
                    if (guestPath) {
                        // 访客访问：只渲染安全、去除了编辑功能的纯净展示页
                        return new Response(renderGuestPage(url, 访客订阅), { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
                    } else {
                        if (isAdminLoginEnabled(env)) {
                            const isLoggedIn = await isAdminLoggedIn(request, env, mytoken);
                            if (!isLoggedIn) {
                                if (request.method === 'POST') return await handleAdminLogin(request, env, url, mytoken);
                                return new Response(renderLoginPage(url), {
                                    headers: {
                                        'Content-Type': 'text/html;charset=utf-8',
                                        'Cache-Control': 'no-store',
                                    },
                                });
                            }
                        }
                        // 管理员访问：渲染拥有完整管理权限的KV编辑面板
                        return await KV(request, env, 'LINK.txt', 访客订阅);
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
                if (x.toLowerCase().startsWith('http')) {
                    订阅链接 += x + '\n';
                } else {
                    自建节点 += x + '\n';
                }
            }
            MainData = 自建节点;
            urls = await ADD(订阅链接);
            const isSubConverterRequest = request.headers.get('subconverter-request') || request.headers.get('subconverter-version') || userAgent.includes('subconverter');
            let 订阅格式 = 'base64';
            if (!(userAgent.includes('null') || isSubConverterRequest || userAgent.includes('nekobox') || userAgent.includes(('CF-Workers-SUB').toLowerCase()))) {
                if (userAgent.includes('sing-box') || userAgent.includes('singbox') || url.searchParams.has('sb') || url.searchParams.has('singbox')) {
                    订阅格式 = 'singbox';
                } else if (userAgent.includes('surge') || url.searchParams.has('surge')) {
                    订阅格式 = 'surge';
                } else if (userAgent.includes('quantumult') || url.searchParams.has('quanx')) {
                    订阅格式 = 'quanx';
                } else if (userAgent.includes('loon') || url.searchParams.has('loon')) {
                    订阅格式 = 'loon';
                } else if (userAgent.includes('clash') || userAgent.includes('meta') || userAgent.includes('mihomo') || url.searchParams.has('clash')) {
                    订阅格式 = 'clash';
                }
            }

            let subConverterUrl;
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
                console.log(请求订阅响应内容);
                req_data += 请求订阅响应内容[0].join('\n');
                订阅转换URL += "|" + 请求订阅响应内容[1];
                if (订阅格式 == 'base64' && !isSubConverterRequest && 请求订阅响应内容[1].includes('://')) {
                    subConverterUrl = `${subProtocol}://${subConverter}/sub?target=mixed&url=${encodeURIComponent(请求订阅响应内容[1])}&insert=false&config=${encodeURIComponent(subConfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&new_name=true`;
                    try {
                        const subConverterResponse = await fetch(subConverterUrl, { headers: { 'User-Agent': 'v2rayN/CF-Workers-SUB  (https://github.com/cmliu/CF-Workers-SUB)' } });
                        if (subConverterResponse.ok) {
                            const subConverterContent = await subConverterResponse.text();
                            req_data += '\n' + atob(subConverterContent);
                        }
                    } catch (error) {
                        console.log('订阅转换请回base64失败，检查订阅转换后端是否正常运行');
                    }
                }
            }

            if (env.WARP) 订阅转换URL += "|" + (await ADD(env.WARP)).join("|");
            
            const utf8Encoder = new TextEncoder();
            const encodedData = utf8Encoder.encode(req_data);
            const utf8Decoder = new TextDecoder();
            const text = utf8Decoder.decode(encodedData);

            // ================= 支持 NOADS 变量的纯净过滤逻辑 =================
            let adKeywords = [];
            let filteredLines = text.split('\n');

            if (config_noAds) {
                adKeywords = config_noAds.split(/,|\r?\n/)
                    .map(k => k.trim().toLowerCase())
                    .filter(k => k.length > 0);
                
                if (adKeywords.length > 0) {
                    filteredLines = filteredLines.filter(line => {
                        const lowerLine = line.toLowerCase();
                        return !adKeywords.some(keyword => lowerLine.includes(keyword));
                    });
                }
            }

            const uniqueLines = new Set(filteredLines);
            const result = [...uniqueLines].join('\n');
            // ===================================================================

            let base64Data;
            try {
                base64Data = btoa(result);
            } catch (e) {
                function encodeBase64(data) {
                    const binary = new TextEncoder().encode(data);
                    let base64 = '';
                    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

                    for (let i = 0; i < binary.length; i += 3) {
                        const byte1 = binary[i];
                        const byte2 = binary[i + 1] || 0;
                        const byte3 = binary[i + 2] || 0;

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
            } else if (订阅格式 == 'clash') {
                subConverterUrl = `${subProtocol}://${subConverter}/sub?target=clash&url=${encodeURIComponent(订阅转换URL)}&insert=false&config=${encodeURIComponent(subConfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&new_name=true`;
            } else if (订阅格式 == 'singbox') {
                subConverterUrl = `${subProtocol}://${subConverter}/sub?target=singbox&url=${encodeURIComponent(订阅转换URL)}&insert=false&config=${encodeURIComponent(subConfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&new_name=true`;
            } else if (订阅格式 == 'surge') {
                subConverterUrl = `${subProtocol}://${subConverter}/sub?target=surge&ver=4&url=${encodeURIComponent(订阅转换URL)}&insert=false&config=${encodeURIComponent(subConfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&new_name=true`;
            } else if (订阅格式 == 'quanx') {
                subConverterUrl = `${subProtocol}://${subConverter}/sub?target=quanx&url=${encodeURIComponent(订阅转换URL)}&insert=false&config=${encodeURIComponent(subConfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false&udp=true`;
            } else if (订阅格式 == 'loon') {
                subConverterUrl = `${subProtocol}://${subConverter}/sub?target=loon&url=${encodeURIComponent(订阅转换URL)}&insert=false&config=${encodeURIComponent(subConfig)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false`;
            }
            
            try {
                const subConverterResponse = await fetch(subConverterUrl, { headers: { 'User-Agent': userAgentHeader } });
                if (!subConverterResponse.ok) return new Response(base64Data, { headers: responseHeaders });
                let subConverterContent = await subConverterResponse.text();
                if (订阅格式 == 'clash') subConverterContent = await clashFix(subConverterContent);
                if (!userAgent.includes('mozilla')) responseHeaders["Content-Disposition"] = `attachment; filename*=utf-8''${encodeURIComponent(FileName)}`;
                return new Response(subConverterContent, { headers: responseHeaders });
            } catch (error) {
                return new Response(base64Data, { headers: responseHeaders });
            }
        }
    }
};

async function ADD(envadd) {
    var addtext = envadd.replace(/[ "'|\r\n]+/g, '\n').replace(/\n+/g, '\n');
    if (addtext.charAt(0) == '\n') addtext = addtext.slice(1);
    if (addtext.charAt(addtext.length - 1) == '\n') addtext = addtext.slice(0, addtext.length - 1);
    const add = addtext.split('\n');
    return add;
}

async function nginx() {
    const text = `
    <!DOCTYPE html>
    <html>
    <head>
    <title>Welcome to nginx!</title>
    <style>
        body {
            width: 35em;
            margin: 0 auto;
            font-family: Tahoma, Verdana, Arial, sans-serif;
        }
    </style>
    </head>
    <body>
    <h1>Welcome to nginx!</h1>
    <p>If you see this page, the nginx web server is successfully installed and
    working. Further configuration is required.</p>
    
    <p>For online documentation and support please refer to
    <a href="http://nginx.org/">nginx.org</a>.<br/>
    Commercial support is available at
    <a href="http://nginx.com/">nginx.com</a>.</p>
    
    <p><em>Thank you for using nginx.</em></p>
    </body>
    </html>
    `
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
    const firstPassArray = Array.from(new Uint8Array(firstPass));
    const firstHex = firstPassArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const secondPass = await crypto.subtle.digest('MD5', encoder.encode(firstHex.slice(7, 27)));
    const secondPassArray = Array.from(new Uint8Array(secondPass));
    const secondHex = secondPassArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return secondHex.toLowerCase();
}

function clashFix(content) {
    if (content.includes('wireguard') && !content.includes('remote-dns-resolve')) {
        let lines;
        if (content.includes('\r\n')) {
            lines = content.split('\r\n');
        } else {
            lines = content.split('\n');
        }

        let result = "";
        for (let line of lines) {
            if (line.includes('type: wireguard')) {
                const 备改内容 = `, mtu: 1280, udp: true`;
                const 正确内容 = `, mtu: 1280, remote-dns-resolve: true, udp: true`;
                result += line.replace(new RegExp(备改内容, 'g'), 正确内容) + '\n';
            } else {
                result += line + '\n';
            }
        }

        content = result;
    }
    return content;
}

async function proxyURL(proxyURL, url) {
    const URLs = await ADD(proxyURL);
    const fullURL = URLs[Math.floor(Math.random() * URLs.length)];

    let parsedURL = new URL(fullURL);
    console.log(parsedURL);
    let URLProtocol = parsedURL.protocol.slice(0, -1) || 'https';
    let URLHostname = parsedURL.hostname;
    let URLPathname = parsedURL.pathname;
    let URLSearch = parsedURL.search;

    if (URLPathname.charAt(URLPathname.length - 1) == '/') {
        URLPathname = URLPathname.slice(0, -1);
    }
    URLPathname += url.pathname;

    let newURL = `${URLProtocol}://${URLHostname}${URLPathname}${URLSearch}`;
    let response = await fetch(newURL);

    let newResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
    });

    newResponse.headers.set('X-New-URL', newURL);
    return newResponse;
}

async function getSUB(api, request, 追加UA, userAgentHeader) {
    if (!api || api.length === 0) {
        return [];
    } else api = [...new Set(api)]; 
    let newapi = "";
    let 订阅转换URLs = "";
    let 异常订阅 = "";
    const controller = new AbortController(); 
    const timeout = setTimeout(() => {
        controller.abort(); 
    }, 2000);

    try {
        const responses = await Promise.allSettled(api.map(apiUrl => getUrl(request, apiUrl, 追加UA, userAgentHeader).then(response => response.ok ? response.text() : Promise.reject(response))));

        const modifiedResponses = responses.map((response, index) => {
            if (response.status === 'rejected') {
                const reason = response.reason;
                if (reason && reason.name === 'AbortError') {
                    return {
                        status: '超时',
                        value: null,
                        apiUrl: api[index] 
                    };
                }
                console.error(`请求失败: ${api[index]}, 错误信息: ${reason?.status} ${reason?.statusText}`);
                return {
                    status: '请求失败',
                    value: null,
                    apiUrl: api[index] 
                };
            }
            return {
                status: response.status,
                value: response.value,
                apiUrl: api[index] 
            };
        });

        console.log(modifiedResponses); 

        for (const response of modifiedResponses) {
            if (response.status === 'fulfilled') {
                const content = await response.value || 'null'; 
                if (content.includes('proxies:')) {
                    订阅转换URLs += "|" + response.apiUrl; 
                } else if (content.includes('outbounds"') && content.includes('inbounds"')) {
                    订阅转换URLs += "|" + response.apiUrl; 
                } else if (content.includes('://')) {
                    newapi += content + '\n'; 
                } else if (isValidBase64(content)) {
                    newapi += base64Decode(content) + '\n'; 
                } else {
                    const 异常订阅LINK = `trojan://CMLiussss@127.0.0.1:8888?security=tls&allowInsecure=1&type=tcp&headerType=none#%E5%BC%82%E5%B8%B8%E8%AE%A2%E9%98%85%20${response.apiUrl.split('://')[1].split('/')[0]}`;
                    console.log('异常订阅: ' + 异常订阅LINK);
                    异常订阅 += `${异常订阅LINK}\n`;
                }
            }
        }
    } catch (error) {
        console.error(error); 
    } finally {
        clearTimeout(timeout); 
    }

    const 订阅内容 = await ADD(newapi + 异常订阅); 
    return [订阅内容, 订阅转换URLs];
}

async function getUrl(request, targetUrl, 追加UA, userAgentHeader) {
    const newHeaders = new Headers(request.headers);
    newHeaders.set("User-Agent", `${atob('djJyYXlOLzYuNDU=')} cmliu/CF-Workers-SUB ${追加UA}(${userAgentHeader})`);

    const modifiedRequest = new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.method === "GET" ? null : request.body,
        redirect: "follow",
        cf: {
            insecureSkipVerify: true,
            allowUntrusted: true,
            validateCertificate: false
        }
    });

    console.log(`请求URL: ${targetUrl}`);
    console.log(`请求头: ${JSON.stringify([...newHeaders])}`);
    console.log(`请求方法: ${request.method}`);

    return fetch(modifiedRequest);
}

function isValidBase64(str) {
    const cleanStr = str.replace(/\s/g, '');
    const base64Regex = /^[A-Za-z0-9+/=]+$/;
    return base64Regex.test(cleanStr);
}

async function 迁移地址列表(env, txt = 'ADD.txt') {
    const 旧数据 = await env.KV.get(`/${txt}`);
    const 新数据 = await env.KV.get(txt);

    if (旧数据 && !新数据) {
        await env.KV.put(txt, 旧数据);
        await env.KV.delete(`/${txt}`);
        return true;
    }
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
    return String(text).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[char]));
}

async function getAdminSessionValue(env, token) {
    if (!isAdminLoginEnabled(env)) return '';
    return await MD5MD5(`${env.USER}:${env.PASS}:${token}:admin-login`);
}

function isAdminLoginEnabled(env) {
    return !!(env.USER && env.PASS);
}

async function isAdminLoggedIn(request, env, token) {
    const session = await getAdminSessionValue(env, token);
    if (!session) return false;
    return getCookie(request, 'CF_SUB_ADMIN') === session;
}

function buildAdminCookie(value, url) {
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    return `CF_SUB_ADMIN=${encodeURIComponent(value)}; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

async function handleAdminLogin(request, env, url, token) {
    let username = '';
    let password = '';
    try {
        const form = await request.formData();
        username = String(form.get('username') || '');
        password = String(form.get('password') || '');
    } catch (error) {
        return new Response(renderLoginPage(url, '登录请求格式不正确'), {
            status: 400,
            headers: {
                'Content-Type': 'text/html;charset=utf-8',
                'Cache-Control': 'no-store',
            },
        });
    }

    if (username === env.USER && password === env.PASS) {
        const session = await getAdminSessionValue(env, token);
        return new Response('', {
            status: 302,
            headers: {
                'Location': url.pathname,
                'Set-Cookie': buildAdminCookie(session, url),
                'Cache-Control': 'no-store',
            },
        });
    }

    return new Response(renderLoginPage(url, '用户名或密码错误'), {
        status: 401,
        headers: {
            'Content-Type': 'text/html;charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}

function getToolStyles() {
    return `
        * {
            box-sizing: border-box;
        }
        body {
            margin: 0;
            background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            color: #202124;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            min-height: 100vh;
        }
        .page {
            width: 100%;
            max-width: 760px;
            margin: 0 auto;
            padding: 18px 14px 28px;
        }
        .header {
            margin-bottom: 14px;
        }
        .title {
            margin: 0;
            font-size: 28px;
            font-weight: 700;
            line-height: 1.2;
            color: #1a1a1a;
        }
        .subtitle {
            margin-top: 8px;
            color: #666;
            font-size: 13px;
        }
        .panel {
            background: rgba(255, 255, 255, 0.7);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(255, 255, 255, 0.5);
            border-radius: 20px;
            padding: 16px;
            margin-top: 12px;
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.1);
        }
        .section-title {
            margin: 0 0 10px;
            font-size: 15px;
            font-weight: 700;
        }
        .section-note {
            margin: 4px 0 10px;
            color: #888;
            font-size: 12px;
        }
        .link-list {
            display: grid;
            gap: 10px;
        }
        .link-item {
            border: 1px solid rgba(229, 229, 223, 0.6);
            border-radius: 12px;
            padding: 12px;
            background: rgba(255, 255, 255, 0.5);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
        }
        .link-label {
            font-weight: 600;
            margin-bottom: 8px;
            color: #1a1a1a;
        }
        .link-url {
            display: block;
            width: 100%;
            word-wrap: break-word;
            overflow-wrap: break-word;
            padding: 10px 10px;
            border: 1px solid rgba(229, 229, 223, 0.8);
            border-radius: 8px;
            background: rgba(250, 250, 250, 0.7);
            color: #1f4b99;
            text-decoration: none;
            word-break: break-all;
            transition: all 0.3s ease;
        }
        .link-url:hover {
            background: rgba(31, 75, 153, 0.05);
            border-color: #1f4b99;
        }
        .actions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            margin-top: 10px;
        }
        button {
            min-height: 36px;
            padding: 8px 16px;
            border: 1px solid rgba(34, 34, 34, 0.2);
            border-radius: 10px;
            background: rgba(34, 34, 34, 0.8);
            color: #fff;
            font-size: 14px;
            cursor: pointer;
            font-weight: 500;
            transition: all 0.3s ease;
        }
        button:hover {
            background: rgba(34, 34, 34, 0.9);
            box-shadow: 0 4px 12px rgba(34, 34, 34, 0.15);
        }
        button.secondary {
            background: rgba(255, 255, 255, 0.8);
            color: #222;
            border-color: rgba(200, 200, 192, 0.5);
        }
        button.secondary:hover {
            background: rgba(255, 255, 255, 0.95);
        }
        button.hidden-btn {
            background: rgba(34, 34, 34, 0.6);
        }
        button:disabled {
            opacity: 0.65;
            cursor: default;
        }
        .field {
            margin-top: 12px;
        }
        label {
            display: block;
            margin-bottom: 6px;
            font-weight: 600;
            color: #1a1a1a;
        }
        input, textarea {
            width: 100%;
            border: 1px solid rgba(207, 207, 200, 0.6);
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.8);
            color: #202124;
            font-size: 14px;
            padding: 10px;
            transition: border-color 0.2s;
        }
        input:focus, textarea:focus {
            outline: none;
            border-color: #3b82f6;
            background: #fff;
        }
        input {
            height: 42px;
        }
        textarea {
            min-height: 200px;
            line-height: 1.5;
            resize: vertical;
        }
        .error {
            color: #b00020;
            margin-top: 10px;
        }
        .muted {
            color: #666;
            font-size: 13px;
            margin-left: 8px;
        }
        .toast {
            position: fixed;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            display: none;
            min-width: 190px;
            max-width: calc(100vw - 40px);
            padding: 12px 18px;
            text-align: center;
            color: #fff;
            background: rgba(0, 0, 0, 0.82);
            border-radius: 12px;
            z-index: 9999;
        }
        .status-indicator {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 13px;
            margin-bottom: 12px;
        }
        .status-ok {
            background: rgba(76, 175, 80, 0.1);
            color: #2e7d32;
        }
        .status-error {
            background: rgba(244, 67, 54, 0.1);
            color: #c62828;
        }
        #current-qrcode {
            display: none;
            margin-top: 12px;
            padding: 12px;
            border: 1px solid rgba(229, 229, 223, 0.6);
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.7);
            backdrop-filter: blur(10px);
            width: fit-content;
            max-width: 100%;
        }
        .hidden {
            display: none;
        }
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
    return `
        <div class="link-list">
            ${links.map(([label, value, displayValue]) => `
                <div class="link-item">
                    <div class="link-label">${escapeHTML(label)}</div>
                    <a class="link-url" href="${escapeHTML(value)}" target="_blank" rel="noopener noreferrer" data-url="${escapeHTML(value)}">${escapeHTML(displayValue || value)}</a>
                    <div class="actions">
                        <button type="button" class="copy-btn" onclick="copySubscription(this)" data-url="${escapeHTML(value)}">复制</button>
                        <button type="button" class="secondary hide-btn hidden" onclick="hideQrcode(this)">隐藏二维码</button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderToolScripts(includeEditor = false) {
    return `
        <script>
        let toastTimer;
        function showToast(message) {
            const toast = document.getElementById('copyNotice');
            toast.textContent = message;
            toast.style.display = 'block';
            clearTimeout(toastTimer);
            toastTimer = setTimeout(function () {
                toast.style.display = 'none';
            }, 1500);
        }

        function copySubscription(button) {
            const text = button.dataset.url;
            navigator.clipboard.writeText(text).then(function () {
                showToast('已复制到剪贴板');
                showQrcode(button);
                button.classList.add('hidden');
                const hideBtn = button.closest('.actions').querySelector('.hide-btn');
                if (hideBtn) hideBtn.classList.remove('hidden');
            }).catch(function (err) {
                console.error('复制失败:', err);
                showToast('复制失败，请手动复制');
            });
        }

        function showQrcode(button) {
            const text = button.dataset.url;
            const qrcodeDiv = document.getElementById('current-qrcode');
            const item = button.closest('.link-item');
            item.appendChild(qrcodeDiv);
            qrcodeDiv.innerHTML = '';
            qrcodeDiv.style.display = 'block';
            new QRCode(qrcodeDiv, {
                text: text,
                width: 220,
                height: 220,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.Q,
                scale: 1
            });
        }

        function hideQrcode(button) {
            const qrcodeDiv = document.getElementById('current-qrcode');
            qrcodeDiv.style.display = 'none';
            qrcodeDiv.innerHTML = '';
            button.classList.add('hidden');
            const copyBtn = button.closest('.actions').querySelector('.copy-btn');
            if (copyBtn) copyBtn.classList.remove('hidden');
        }

        function checkSubapiStatus() {
            const statusDiv = document.getElementById('subapi-status');
            if (!statusDiv) return;
            
            const subapiUrl = statusDiv.dataset.url;
            if (!subapiUrl) return;
            
            statusDiv.innerHTML = '🔄 <span style="color: #666; font-weight: 500;">测试连通性中...</span>';
            
            fetch(subapiUrl + '/version', {
                method: 'GET'
            }).then(response => {
                if (response.ok) return response.text();
                throw new Error('HTTP ' + response.status);
            }).then(version => {
                statusDiv.innerHTML = '✅ <span style="color: #2e7d32; font-weight: 500;">正常工作 (' + version.trim() + ')</span>';
                statusDiv.className = 'status-indicator status-ok';
            }).catch(error => {
                statusDiv.innerHTML = '❌ <span style="color: #c62828; font-weight: 500;">不可用</span>';
                statusDiv.className = 'status-indicator status-error';
                console.error('SUBAPI状态检测失败:', error);
            });
        }

        document.addEventListener('DOMContentLoaded', function() {
            checkSubapiStatus();
        });

        ${includeEditor ? `
        function replaceFullwidthColon() {
            const textarea = document.getElementById('content');
            textarea.value = textarea.value.replace(/：/g, ':');
        }

        function saveConfig(button) {
            const statusElem = document.getElementById('configSaveStatus');
            const subname = document.getElementById('config-subname').value;
            const subapi = document.getElementById('config-subapi').value;
            const subconfig = document.getElementById('config-subconfig').value;
            const noads = document.getElementById('config-noads').value;
            
            button.disabled = true;
            button.textContent = '保存中...';
            
            const payload = {
                type: 'config',
                settings: {
                    subName: subname,
                    subApi: subapi,
                    subConfig: subconfig,
                    noAds: noads
                }
            };

            fetch(window.location.href, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-cache'
            }).then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                statusElem.textContent = '已保存 ' + new Date().toLocaleString();
                statusElem.style.color = '#2e7d32';
                setTimeout(() => location.reload(), 800); // 保存后刷新页面应用新全局设置
            }).catch(function (error) {
                statusElem.textContent = '保存失败: ' + error.message;
                statusElem.style.color = '#b00020';
            }).finally(function () {
                button.disabled = false;
                button.textContent = '保存全局设置';
            });
        }

        function saveContent(button) {
            const textarea = document.getElementById('content');
            const statusElem = document.getElementById('saveStatus');
            if (!textarea) return;
            if (!/iPad|iPhone|iPod/.test(navigator.userAgent)) replaceFullwidthColon();
            
            button.disabled = true;
            button.textContent = '保存中...';
            
            const payload = {
                type: 'content',
                content: textarea.value || ''
            };

            fetch(window.location.href, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-cache'
            }).then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                textarea.defaultValue = textarea.value || '';
                statusElem.textContent = '已保存 ' + new Date().toLocaleString();
                statusElem.style.color = '#2e7d32';
            }).catch(function (error) {
                statusElem.textContent = '保存失败: ' + error.message;
                statusElem.style.color = '#b00020';
            }).finally(function () {
                button.disabled = false;
                button.textContent = '保存节点订阅';
            });
        }
        ` : ''}
        </script>
    `;
}

function renderLoginPage(url, error = '') {
    const configNotice = error || '';
    return `
    <!DOCTYPE html>
    <html>
        <head>
            <title>${escapeHTML(FileName)} 管理员登录</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                ${getToolStyles()}
                .login-btn {
                    display: block;
                    width: 100%;
                    max-width: 280px;
                    min-height: 44px;
                    margin: 28px auto 6px;
                    padding: 0;
                    background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
                    border: none;
                    border-radius: 12px;
                    color: #fff;
                    font-size: 15px;
                    font-weight: 600;
                    letter-spacing: 2px;
                    cursor: pointer;
                    box-shadow: 0 4px 12px rgba(29, 78, 216, 0.25);
                    transition: all 0.3s ease;
                }
                .login-btn:hover {
                    background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
                    box-shadow: 0 6px 16px rgba(29, 78, 216, 0.35);
                    transform: translateY(-1px);
                }
                .login-btn:active {
                    transform: translateY(1px);
                }
                .error {
                    text-align: center;
                    margin-top: 15px;
                }
            </style>
        </head>
        <body>
            <main class="page">
                <header class="header">
                    <h1 class="title">${escapeHTML(FileName)}订阅管理</h1>
                    <div class="subtitle">管理员登录</div>
                </header>
                <section class="panel">
                <form method="POST" action="${escapeHTML(url.pathname)}" autocomplete="on">
                    <div class="field">
                        <label for="username">用户名</label>
                        <input id="username" name="username" type="text" autocomplete="username" required autofocus>
                    </div>
                    <div class="field">
                        <label for="password">密码</label>
                        <input id="password" name="password" type="password" autocomplete="current-password" required>
                    </div>
                    <button type="submit" class="login-btn">登录</button>
                    ${configNotice ? `<div class="error">${escapeHTML(configNotice)}</div>` : ''}
                </form>
                </section>
            </main>
        </body>
    </html>
    `;
}

// 专属访客展示页渲染函数
function renderGuestPage(url, guest) {
    return `
    <!DOCTYPE html>
    <html>
        <head>
            <title>${escapeHTML(FileName)}访客订阅</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>${getToolStyles()}</style>
            <script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js"></script>
        </head>
        <body>
            <div id="copyNotice" class="toast"></div>
            <main class="page">
                <header class="header">
                    <h1 class="title">${escapeHTML(FileName)}访客订阅</h1>
                    <div class="subtitle">复制订阅链接或生成二维码</div>
                </header>
                <section class="panel">
                    <h2 class="section-title">订阅链接</h2>
                    ${renderLinkList(getSubscriptionLinks(url, guest, true))}
                </section>
                <section class="panel">
                    <h2 class="section-title">当前使用配置信息</h2>
                    <div id="subapi-status" class="status-indicator" data-url="${escapeHTML(`${subProtocol}://${subConverter}`)}"></div>
                    <div class="link-list">
                        <div class="link-item">
                            <div class="link-label">SUBAPI 后端地址</div>
                            <a class="link-url" href="${escapeHTML(`${subProtocol}://${subConverter}`)}" target="_blank" rel="noopener noreferrer">${escapeHTML(`${subProtocol}://${subConverter}`)}</a>
                        </div>
                        <div class="link-item">
                            <div class="link-label">SUBCONFIG 转换规则</div>
                            <a class="link-url" href="${escapeHTML(subConfig)}" target="_blank" rel="noopener noreferrer">${escapeHTML(subConfig)}</a>
                        </div>
                    </div>
                </section>
                <div id="current-qrcode"></div>
            </main>
            ${renderToolScripts(false)}
        </body>
    </html>
    `;
}

function renderAdminPage(url, content, hasKV, guest, settings) {
    return `
    <!DOCTYPE html>
    <html>
        <head>
            <title>${escapeHTML(settings.subName)}</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>${getToolStyles()}</style>
            <script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js"></script>
        </head>
        <body>
            <div id="copyNotice" class="toast"></div>
            <main class="page">
                <header class="header">
                    <h1 class="title">${escapeHTML(settings.subName)}</h1>
                    <div class="subtitle">汇聚订阅控制台</div>
                </header>

                <section class="panel">
                    <h2 class="section-title">全局设置 (绑定KV空间后生效)</h2>
                    <div class="field">
                        <label for="config-subname">站点/订阅名称 (SUBNAME)</label>
                        <input id="config-subname" type="text" value="${escapeHTML(settings.subName)}" placeholder="例如：CF-Workers-SUB">
                    </div>
                    <div class="field">
                        <label for="config-subapi">订阅转换后端 (SUBAPI)</label>
                        <input id="config-subapi" type="text" value="${escapeHTML(settings.subApi)}" placeholder="例如：SUBAPI.cmliussss.net">
                    </div>
                    <div class="field">
                        <label for="config-subconfig">转换规则 (SUBCONFIG)</label>
                        <input id="config-subconfig" type="text" value="${escapeHTML(settings.subConfig)}">
                    </div>
                    <div class="field">
                        <label for="config-noads">去广告关键字 (NOADS) <span class="muted" style="font-weight: normal;font-size:12px;">逗号或换行分隔</span></label>
                        <textarea id="config-noads" style="min-height: 80px;" placeholder="例如：剩余流量,官网,套餐">${escapeHTML(settings.noAds)}</textarea>
                    </div>
                    ${hasKV ? `
                        <div class="actions">
                            <button type="button" onclick="saveConfig(this)">保存全局设置</button>
                            <span id="configSaveStatus" class="muted"></span>
                        </div>
                    ` : '<p class="muted">请绑定变量名称为 KV 的 KV 命名空间</p>'}
                </section>

                <section class="panel">
                    <h2 class="section-title">汇聚订阅节点编辑</h2>
                    ${hasKV ? `
                        <textarea id="content" placeholder="在此输入单节点链接或订阅地址...">${escapeHTML(content)}</textarea>
                        <div class="actions">
                            <button type="button" onclick="saveContent(this)">保存节点订阅</button>
                            <span id="saveStatus" class="muted"></span>
                        </div>
                    ` : '<p class="muted">请绑定变量名称为 KV 的 KV 命名空间</p>'}
                </section>

                <section class="panel">
                    <h2 class="section-title">管理员订阅链接</h2>
                    <div class="section-note">点击复制会自动生成二维码，点击隐藏二维码则隐藏</div>
                    ${renderLinkList(getSubscriptionLinks(url, mytoken, false))}
                </section>

                <section class="panel">
                    <h2 class="section-title">访客订阅链接</h2>
                    <div class="section-note">点击复制会自动生成二维码，点击隐藏二维码则隐藏</div>
                    ${renderLinkList(getSubscriptionLinks(url, guest, true))}
                </section>

                <div id="current-qrcode"></div>
            </main>
            ${renderToolScripts(true)}
        </body>
    </html>
    `;
}

async function KV(request, env, txt = 'LINK.txt', guest) {
    const url = new URL(request.url);

    // 设置默认值
    let settings = {
        subName: 'CF-Workers-SUB',
        subApi: 'SUBAPI.cmliussss.net',
        subConfig: 'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_MultiCountry.ini',
        noAds: ''
    };

    let hasKV = !!env.KV;

    // 从 KV 提取用户全局设置
    if (hasKV) {
        try {
            const kvConfigStr = await env.KV.get('CONFIG.json');
            if (kvConfigStr) {
                settings = { ...settings, ...JSON.parse(kvConfigStr) };
            }
        } catch (e) { console.error('提取配置失败', e); }
    }

    try {
        if (request.method === "POST") {
            if (!hasKV) return new Response("未绑定KV空间", { status: 400 });
            try {
                // 现支持 JSON 结构传输，拆分更新请求
                const text = await request.text();
                try {
                    const data = JSON.parse(text);
                    if (data.type === 'config' && data.settings) {
                        await env.KV.put('CONFIG.json', JSON.stringify(data.settings));
                        return new Response("设置保存成功");
                    } else if (data.type === 'content') {
                        await env.KV.put(txt, data.content || '');
                        return new Response("订阅保存成功");
                    }
                } catch (jsonErr) {
                    // 向下兼容旧版纯文本保存逻辑
                    await env.KV.put(txt, text);
                    return new Response("保存成功");
                }
            } catch (error) {
                return new Response("保存失败: " + error.message, { status: 500 });
            }
        }

        let content = '';
        if (hasKV) {
            try {
                content = await env.KV.get(txt) || '';
            } catch (error) {
                content = '读取数据时发生错误: ' + error.message;
            }
        }

        const html = renderAdminPage(url, content, hasKV, guest, settings);
        return new Response(html, {
            headers: { "Content-Type": "text/html;charset=utf-8" }
        });
    } catch (error) {
        return new Response("服务器错误: " + error.message, {
            status: 500,
            headers: { "Content-Type": "text/plain;charset=utf-8" }
        });
    }
}
