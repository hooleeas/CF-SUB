/**
 * CF-SUB
 * 基于 CF-SUB 核心能力扩展的多 SUB / 多订阅链接 URL 管理版
 *
 * 核心原则：
 * 1. 只使用一个 Cloudflare KV Binding：KV
 * 2. 保留 CF-SUB 的订阅获取、聚合、去重、NOADS、SUBAPI、格式识别、
 *    主页伪装、管理员登录、二维码、API/CONFIG 状态检测等能力。
 * 3. SUB 是“聚合节点配置”，不是公开订阅链接。
 * 4. URL 才是公开订阅入口。
 *
 * KV：
 *   CONFIG.json
 *   SUB:<id>
 *   URL:<url>
 *
 * 运行时仅需绑定 KV；应用配置保存在 CONFIG.json。
 */

const INTERNAL_TOKEN_SEED = 'CF-SUBS-INTERNAL';
const ADMIN_SESSION_CONTEXT = 'CF-SUBS-ADMIN-SESSION';
const ADMIN_SESSION_MAX_AGE_SECONDS = 604800;
let FileName = 'CF-SUBS';
const SUB_UPDATE_INTERVAL = 6;

// ================= 全局默认配置 =================
const defaultSubConverter = "SUBAPI.cmliussss.net";
const defaultSubConfig = "https://raw.githubusercontent.com/hooleeas/ACL4SSR/refs/heads/master/Clash/config/China_Direct_Overseas_Proxy.ini";
const defaultSubProtocol = "https";
// ================================================

const SUB_PREFIX = 'SUB:';
const URL_PREFIX = 'URL:';
const ID_CHARS = 'ABCDEFGHJKMNPQRSTWXYZ2345678';
const DEFAULT_ADMIN_PATH = 'admin';
const DEFAULT_SUB_UPDATE_MINUTES = 60;

function normalizeUpdateMinutes(value) {
    const minutes = Number(value);
    return Number.isFinite(minutes) && minutes >= 0 ? Math.floor(minutes) : DEFAULT_SUB_UPDATE_MINUTES;
}

function normalizeUpdateEnabled(value) {
    return value === undefined || value === null ? true : value === true || value === 'true' || value === 1 || value === '1';
}

export default {
    async fetch(request, env) {
        try {
            return await handleRequest(request, env);
        } catch (error) {
            console.error('CF-SUBS request error:', error);
            return new Response('CF-SUBS Worker Error: ' + (error?.message || String(error)), {
                status: 500,
                headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-store'
                }
            });
        }
    }
};

async function handleRequest(request, env) {
        const userAgentHeader = request.headers.get('User-Agent') || '';
        const userAgent = userAgentHeader.toLowerCase();
        const url = new URL(request.url);
        const queryToken = url.searchParams.get('token') || '';
        const conversionSourceToken = url.searchParams.get('sourceToken') || '';

        let adminUser = '';
        let adminPass = '';
        let adminPath = DEFAULT_ADMIN_PATH;
        let siteLogo = '';
        let subConverter = '';
        let subConfig = '';
        let subProtocol = defaultSubProtocol;
        let configNoAds = '';
        let fakeMode = '';
        let fakeUrl = '';
        let fakeUrl302 = '';
        let fakeCode = '';

        // 读取 KV 配置
        if (env.KV) {
            try {
                const kvConfig = await getKVJson(env, 'CONFIG.json');
                if (kvConfig) {

                    FileName = kvConfig.subName || 'CF-SUBS';
                    siteLogo = String(kvConfig.siteLogo || '').trim();

                    subConverter = kvConfig.subApi || '';
                    subConfig = kvConfig.subConfig || '';
                    configNoAds = String(kvConfig.noAds || '');
                    adminUser = kvConfig.user || '';
                    adminPass = kvConfig.pass || '';
                    adminPath = normalizeAdminPath(kvConfig.adminPath) || DEFAULT_ADMIN_PATH;

                    fakeMode = kvConfig.fakeMode || '';
                    fakeUrl = kvConfig.fakeUrl || '';
                    fakeUrl302 = kvConfig.fakeUrl302 || '';
                    fakeCode = kvConfig.fakeCode || '';
                }
            } catch (e) {
                console.error('解析 KV 配置失败', e);
            }
        }

        const customSubApi = String(subConverter || '').trim();
        const customSubConfig = String(subConfig || '').trim();
        const hasCustomApi = !!customSubApi;
        const hasCustomConfig = !!customSubConfig;

        subConverter = customSubApi;
        subConfig = customSubConfig;
        subProtocol = defaultSubProtocol;

        if (subConverter.includes('http://')) {
            subConverter = subConverter.split('//')[1];
            subProtocol = 'http';
        } else if (subConverter.includes('https://')) {
            subConverter = subConverter.split('//')[1] || subConverter;
        }

        const effectiveSubConverter = hasCustomApi ? subConverter : defaultSubConverter;
        const effectiveSubProtocol = hasCustomApi ? subProtocol : defaultSubProtocol;
        const effectiveSubConfig = hasCustomConfig ? subConfig : defaultSubConfig;

        const currentDate = new Date();
        currentDate.setHours(0, 0, 0, 0);
        const timeTemp = Math.ceil(currentDate.getTime() / 1000);
        const fakeToken = await MD5MD5(`${INTERNAL_TOKEN_SEED}${timeTemp}`);
        const isProxyClientUA = [
            'clash', 'meta', 'mihomo', 'sing-box', 'singbox', 'surge',
            'quantumult', 'loon', 'nekobox', 'v2rayn', 'v2rayng',
            'shadowrocket', 'subconverter'
        ].some(keyword => userAgent.includes(keyword));
        // 退出登录：直接跳回主页，不显示 logout 中间页面
        if (url.searchParams.has('logout') || url.pathname === `/${adminPath}/logout`) {
            return new Response(null, {
                status: 302,
                headers: {
                    'Location': '/',
                    'Cache-Control': 'no-store',
                    'Set-Cookie': 'CF_SUB_ADMIN=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'
                }
            });
        }

        // ==================== 管理后台 ====================
        if (
            url.pathname === `/${adminPath}` ||
            url.pathname === `/${adminPath}/JSON` ||
            url.pathname === `/${adminPath}/status`
        ) {
            if (!!adminUser !== !!adminPass) {
                return new Response(
                    '管理员用户名和密码需要同时设置；如不启用登录，请将两项都留空。',
                    {
                        status: 503,
                        headers: {
                            'Content-Type': 'text/plain; charset=utf-8',
                            'Cache-Control': 'no-store'
                        }
                    }
                );
            }

            if (adminUser && adminPass) {
                const isLoggedIn = await isAdminLoggedIn(request, adminUser, adminPass);
                if (!isLoggedIn) {
                    if (request.method === 'POST') {
                        return await handleAdminLogin(request, url, adminUser, adminPass, siteLogo);
                    }
                    return new Response(renderLoginPage(url, '', siteLogo), {
                        headers: {
                            'Content-Type': 'text/html;charset=utf-8',
                            'Cache-Control': 'no-store'
                        }
                    });
                }
            }

            if (url.pathname === `/${adminPath}/JSON`) {
                return await handleAdminJson(request, env, adminPath, siteLogo, adminUser, adminPass);
            }
            if (url.pathname === `/${adminPath}/status`) {
                return await handleAdminStatus(request, {
                    effectiveSubConverter,
                    effectiveSubConfig,
                    effectiveSubProtocol,
                    hasCustomApi,
                    hasCustomConfig
                });
            }

            return await handleAdmin(request, env, {
                adminUser,
                adminPass,
                effectiveSubConverter,
                effectiveSubConfig,
                effectiveSubProtocol,
                hasCustomApi,
                hasCustomConfig,
                adminPath
            });
        }

        // ==================== 解析公开 URL ====================
        // 新版 URL：
        //   /abc123
        //   /abc123?clash
        //   /?token=abc123
        let publicToken = queryToken;

        if (!publicToken && url.pathname !== '/') {
            publicToken = decodeURIComponent(url.pathname.slice(1));
        }

        let tokenData = null;

        if (env.KV && publicToken) {
            tokenData = await getToken(env, publicToken);
        }

        const isFakeTokenRequest =
            publicToken === fakeToken ||
            url.pathname === '/' + fakeToken;

        // 新 URL 和内部转换入口都属于有效入口
        const validPublicEntry =
            !!tokenData || isFakeTokenRequest;

        // ==================== 无效路径 / 主页 ====================
        if (!validPublicEntry && url.pathname !== '/') {
            return Response.redirect(url.origin + '/', 302);
        }

        if (!validPublicEntry && url.pathname === '/') {
            if (fakeMode === '1' && fakeUrl) {
                try {
                    return await proxyURL(fakeUrl, url, FileName, siteLogo);
                } catch {}
            } else if (fakeMode === '2' && fakeUrl302) {
                return Response.redirect(fakeUrl302, 302);
            } else if (fakeMode === '3' && fakeCode && fakeCode.trim() !== '') {
                let html = fakeCode;
                const title = `<title>${escapeHTML(FileName)}</title>`;
                if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)) {
                    html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, title);
                } else if (/<head\b[^>]*>/i.test(html)) {
                    html = html.replace(/<head\b[^>]*>/i, match => match + title);
                } else {
                    html = title + html;
                }
                html = injectFavicon(html, siteLogo);
                return new Response(html, {
                    headers: { 'Content-Type': 'text/html; charset=UTF-8' }
                });
            }

            return new Response(await nginx(FileName, siteLogo), {
                headers: { 'Content-Type': 'text/html; charset=UTF-8' }
            });
        }

        let subscriptionData = tokenData;
        if (isFakeTokenRequest && conversionSourceToken) {
            subscriptionData = await getToken(env, conversionSourceToken);
            if (!subscriptionData) {
                return new Response('内部订阅来源不存在。', { status: 404 });
            }
        }

        const selectedSources = subscriptionData
            ? await getSourcesForToken(env, subscriptionData)
            : [];

        // SUBAPI uses this route as a Base64 feed of the selected token's raw nodes.
        if (isFakeTokenRequest && conversionSourceToken) {
            const sourceData = await collectSubscriptionSources(
                selectedSources,
                request,
                'v2rayn',
                userAgentHeader
            );
            const nodes = filterSubscriptionNodes(sourceData.nodes, configNoAds);
            return new Response(encodeBase64(nodes.join('\n')), {
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }

        // ==================== 浏览器 UI ====================
        if (
            tokenData &&
            userAgent.includes('mozilla') &&
            !url.search &&
            !isProxyClientUA
        ) {
            return new Response(
                renderGuestPage(
                    url,
                    tokenData.url,
                    tokenData.name,
                    siteLogo
                ),
                { headers: { 'Content-Type': 'text/html;charset=utf-8' } }
            );
        }

        const updateSettings = subscriptionData || {};
        return await generateSubscription(
            request,
            selectedSources,
            {
                fakeToken,
                effectiveSubConverter,
                effectiveSubConfig,
                effectiveSubProtocol,
                userAgent,
                userAgentHeader,
                configNoAds,
                fileName: FileName,
                updateMinutes: normalizeUpdateMinutes(updateSettings.update),
                updateEnabled: normalizeUpdateEnabled(updateSettings.updateEnable)
            },
            publicToken
        );
}

/* =========================================================
 * 配置 / 后台状态
 * ======================================================= */

async function fetchWithTimeout(resource, options = {}, timeoutMs = 8e3) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(resource, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function probeBackend(apiUrl, configUrl, timeoutMs = 8e3) {
    const rawApi = String(apiUrl || '').trim();
    const protocol = /^http:\/\//i.test(rawApi) ? 'http' : 'https';
    const host = rawApi.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const api = host ? `${protocol}://${host}` : '';
    let apiOk = false;
    let apiVersion = '';
    if (api) {
        try {
            const response = await fetchWithTimeout(
                `${api}/version`,
                { headers: { 'User-Agent': 'SUB-UI/Status' } },
                timeoutMs
            );
            if (response.ok) {
                apiOk = true;
                apiVersion = (await response.text()).trim().slice(0, 80);
            }
        } catch (error) {
            console.warn('SUBAPI availability probe failed:', error);
        }
    }
    const config = String(configUrl || '').trim();
    let configOk = false;
    if (config) {
        try {
            const response = await fetchWithTimeout(
                config,
                { headers: { 'User-Agent': 'SUB-UI/Status' } },
                timeoutMs
            );
            configOk = response.ok;
        } catch {}
    }
    return {
        api: { ok: apiOk, url: api, version: apiVersion },
        config: { ok: configOk, url: config },
        available: (api ? apiOk : true) && (config ? configOk : true)
    };
}

async function getBackendStatus(api, config, protocol, hasCustomApi, hasCustomConfig) {
    let customApiOk = false;
    let customApiVersion = '';
    let defaultApiOk = false;
    let defaultApiVersion = '';
    let customConfigOk = false;
    let defaultConfigOk = false;

    async function probeApi(targetApi, targetProtocol) {
        const result = await probeBackend(`${targetProtocol}://${targetApi}`, '');
        return { ok: result.api.ok, version: result.api.version.slice(0, 30) };
    }

    async function probeConfig(configUrl) {
        if (!configUrl) return false;
        return (await probeBackend('', configUrl)).config.ok;
    }

    if (hasCustomApi) {
        const res = await probeApi(api, protocol);
        customApiOk = res.ok;
        customApiVersion = res.version || '';
        if (!customApiOk) {
            const resDef = await probeApi(defaultSubConverter, defaultSubProtocol);
            defaultApiOk = resDef.ok;
            defaultApiVersion = resDef.version || '';
        }
    } else {
        const resDef = await probeApi(defaultSubConverter, defaultSubProtocol);
        defaultApiOk = resDef.ok;
        defaultApiVersion = resDef.version || '';
    }

    if (hasCustomConfig) {
        customConfigOk = await probeConfig(config);
        if (!customConfigOk) defaultConfigOk = await probeConfig(defaultSubConfig);
    } else {
        defaultConfigOk = await probeConfig(defaultSubConfig);
    }

    let adminApiHtml = '';
    let guestApiHtml = '';
    let finalApiUrl = '';
    let adminApiCss = '';
    let guestApiCss = '';

    if (hasCustomApi && customApiOk) {
        adminApiHtml = `✅SUBAPI状态正常 (${escapeHTML(customApiVersion)})`;
        guestApiHtml = adminApiHtml;
        finalApiUrl = `${protocol}://${api}`;
        adminApiCss = 'status-ok';
        guestApiCss = 'status-ok';
    } else if (hasCustomApi && !customApiOk && defaultApiOk) {
        adminApiHtml = `⚠️SUBAPI无效 已切换为默认配置 ✅默认值可用`;
        guestApiHtml = `✅SUBAPI状态正常 (${escapeHTML(defaultApiVersion)})`;
        finalApiUrl = `${defaultSubProtocol}://${defaultSubConverter}`;
        adminApiCss = 'status-warn';
        guestApiCss = 'status-ok';
    } else if (!hasCustomApi && defaultApiOk) {
        adminApiHtml = `⚠️SUBAPI未配置 已切换为默认配置 ✅默认值可用`;
        guestApiHtml = `✅SUBAPI状态正常 (${escapeHTML(defaultApiVersion)})`;
        finalApiUrl = `${defaultSubProtocol}://${defaultSubConverter}`;
        adminApiCss = 'status-warn';
        guestApiCss = 'status-ok';
    } else if (!hasCustomApi) {
        adminApiHtml = '❌默认SUBAPI暂不可用';
        guestApiHtml = '❌默认SUBAPI暂不可用';
        finalApiUrl = `${defaultSubProtocol}://${defaultSubConverter}`;
        adminApiCss = 'status-error';
        guestApiCss = 'status-error';
    } else {
        adminApiHtml = '❌SUBAPI无效待维护';
        guestApiHtml = adminApiHtml;
        finalApiUrl = `${defaultSubProtocol}://${defaultSubConverter}`;
        adminApiCss = 'status-error';
        guestApiCss = 'status-error';
    }

    let adminConfigHtml = '';
    let guestConfigHtml = '';
    let finalConfigUrl = '';
    let adminConfigCss = '';
    let guestConfigCss = '';

    if (hasCustomConfig && customConfigOk) {
        adminConfigHtml = '✅SUBCONFIG状态正常';
        guestConfigHtml = adminConfigHtml;
        finalConfigUrl = config;
        adminConfigCss = 'status-ok';
        guestConfigCss = 'status-ok';
    } else if (hasCustomConfig && !customConfigOk && defaultConfigOk) {
        adminConfigHtml = '⚠️SUBCONFIG无效 已切换为默认配置 ✅默认值可用';
        guestConfigHtml = '✅SUBCONFIG状态正常';
        finalConfigUrl = defaultSubConfig;
        adminConfigCss = 'status-warn';
        guestConfigCss = 'status-ok';
    } else if (!hasCustomConfig && defaultConfigOk) {
        adminConfigHtml = '⚠️SUBCONFIG未配置 已切换为默认配置 ✅默认值可用';
        guestConfigHtml = '✅SUBCONFIG状态正常';
        finalConfigUrl = defaultSubConfig;
        adminConfigCss = 'status-warn';
        guestConfigCss = 'status-ok';
    } else if (!hasCustomConfig) {
        adminConfigHtml = '❌默认SUBCONFIG暂不可用';
        guestConfigHtml = adminConfigHtml;
        finalConfigUrl = defaultSubConfig;
        adminConfigCss = 'status-error';
        guestConfigCss = 'status-error';
    } else {
        adminConfigHtml = '❌SUBCONFIG无效待维护';
        guestConfigHtml = adminConfigHtml;
        finalConfigUrl = defaultSubConfig;
        adminConfigCss = 'status-error';
        guestConfigCss = 'status-error';
    }

    return {
        adminApiHtml,
        guestApiHtml,
        finalApiUrl,
        adminApiCss,
        guestApiCss,
        adminConfigHtml,
        guestConfigHtml,
        finalConfigUrl,
        adminConfigCss,
        guestConfigCss
    };
}

/* =========================================================
 * SUB / URL 数据
 * ======================================================= */

function makeSubId() {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    let value = '';
    for (const b of bytes) value += ID_CHARS[b % ID_CHARS.length];
    return value;
}

async function makeRandomToken(env, adminPath) {
    for (let n = 0; n < 30; n++) {
        const token = crypto.randomUUID();

        if (
            validCustomToken(token, adminPath) &&
            !(await getToken(env, token))
        ) {
            return token;
        }
    }
    throw new Error('随机 URL 生成失败，请重试');
}

async function getSub(env, id) {
    if (!env.KV || !id) return null;
    try {
        const sub = await getKVJson(env, `${SUB_PREFIX}${id}`);
        if (!sub) return null;

        if (
            Object.prototype.hasOwnProperty.call(sub, 'update') ||
            Object.prototype.hasOwnProperty.call(sub, 'updateEnable')
        ) {
            delete sub.update;
            delete sub.updateEnable;
            await env.KV.put(`${SUB_PREFIX}${id}`, serializeKVJson(sub));
        }

        return sub;
    } catch {
        return null;
    }
}

async function getToken(env, token) {
    if (!env.KV || !token) return null;
    try {
        return await getKVJson(env, `${URL_PREFIX}${token}`);
    } catch {
        return null;
    }
}

async function getSourcesForToken(env, tokenData) {
    const sourceList = [];
    const ids = Array.isArray(tokenData.subs) ? tokenData.subs : [];

    for (const id of ids) {
        const sub = await getSub(env, id);
        if (!sub || sub.enabled === false || !Array.isArray(sub.sources)) continue;
        sourceList.push(...sub.sources);
    }

    return [...new Set(sourceList.map(source => String(source).trim()).filter(Boolean))];
}

async function listSubs(env) {
    if (!env.KV) return [];
    const result = [];
    let cursor;

    do {
        const page = await env.KV.list({
            prefix: SUB_PREFIX,
            ...(cursor ? { cursor } : {})
        });

        const values = await Promise.all(page.keys.map(item =>
            getSub(env, item.name.slice(SUB_PREFIX.length))
        ));
        for (const data of values) {
            if (data) result.push(data);
        }

        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    result.sort((a, b) => {
        const ao = Number.isFinite(Number(a.order)) ? Number(a.order) : (Date.parse(a.createdAt || '') || 0);
        const bo = Number.isFinite(Number(b.order)) ? Number(b.order) : (Date.parse(b.createdAt || '') || 0);
        if (ao !== bo) return ao - bo;
        return String(a.name).localeCompare(String(b.name), 'zh-CN');
    });
    return result;
}

async function listTokens(env) {
    if (!env.KV) return [];
    const result = [];
    let cursor;

    do {
        const page = await env.KV.list({
            prefix: URL_PREFIX,
            ...(cursor ? { cursor } : {})
        });

        const values = await Promise.all(page.keys.map(item =>
            getToken(env, item.name.slice(URL_PREFIX.length))
        ));
        for (const data of values) {
            if (data) result.push(data);
        }

        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    result.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
    return result;
}

async function listKVEntries(env) {
    const result = [];
    let cursor;

    do {
        const page = await env.KV.list(cursor ? { cursor } : {});
        const entries = await Promise.all(page.keys.map(async ({ name }) => {
            const value = await env.KV.get(name);
            let formattedValue = value || '';
            let isJson = false;
            let rawValue = value || '';

            if (value !== null) {
                try {
                    const parsed = JSON.parse(value);
                    const uppercaseValue = serializeKVJson(parsed);
                    if (uppercaseValue !== value) await env.KV.put(name, uppercaseValue);
                    formattedValue = JSON.stringify(JSON.parse(uppercaseValue), null, 2);
                    isJson = true;
                    rawValue = JSON.parse(uppercaseValue);
                } catch {
                    rawValue = value;
                }
            }

            return { name, value: formattedValue, isJson, raw: rawValue };
        }));

        result.push(...entries);
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
}

async function handleAdminJson(request, env, adminPath, siteLogo, adminUser, adminPass) {
    if (!env.KV) {
        return new Response('未绑定名为 KV 的 Cloudflare KV Namespace。', { status: 500 });
    }

    if (request.method === 'POST') {
        try {
            const data = await request.json();
            if (data?.type === 'factory_reset') {
                const expectedUser = String(adminUser || '');
                const expectedPass = String(adminPass || '');
                const suppliedUser = typeof data.username === 'string' ? data.username : '';
                const suppliedPass = typeof data.password === 'string' ? data.password : '';

                if (!expectedUser && !expectedPass) {
                    if (suppliedUser || suppliedPass) {
                        return jsonResponse({ ok: false, error: '当前未设置管理员凭据，请清空用户名和密码后重试' }, 400);
                    }
                } else if (!expectedUser || !expectedPass) {
                    return jsonResponse({ ok: false, error: '管理员用户名和密码必须同时设置；请先修正后台安全设置' }, 403);
                } else if (
                    !suppliedUser ||
                    !suppliedPass ||
                    !constantTimeEqual(suppliedUser, expectedUser) ||
                    !constantTimeEqual(suppliedPass, expectedPass)
                ) {
                    return jsonResponse({ ok: false, error: '管理员用户名或密码错误' }, 403);
                }

                const keys = [];
                let cursor;
                do {
                    const page = await env.KV.list(cursor ? { cursor } : {});
                    keys.push(...page.keys.map(({ name }) => name));
                    cursor = page.list_complete ? undefined : page.cursor;
                } while (cursor);

                let deleted = 0;
                try {
                    for (const key of keys) {
                        await env.KV.delete(key);
                        deleted++;
                    }
                } catch (error) {
                    console.error('Factory reset stopped after partial KV deletion:', error);
                    return jsonResponse({
                        ok: false,
                        error: `恢复出厂设置未能完成，已删除 ${deleted} 项 KV 数据`
                    }, 500);
                }
                return jsonResponse({ ok: true, deleted });
            }

            if (data?.type !== 'import_all_json') {
                return jsonResponse({ ok: false, error: '不支持的操作类型' }, 400);
            }
            const payload = data.payload;
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
                return jsonResponse({ ok: false, error: '导入内容必须是一个 JSON 对象' }, 400);
            }

            const entries = Object.entries(payload);
            for (const [key, value] of entries) {
                const raw = value === undefined ? '' : value;
                const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
                await env.KV.put(String(key), text);
            }

            return jsonResponse({ ok: true, count: entries.length, entries: await listKVEntries(env) });
        } catch (error) {
            return jsonResponse({ ok: false, error: '导入失败: ' + (error?.message || String(error)) }, 400);
        }
    }

    if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const entries = await listKVEntries(env);
    return new Response(renderAdminJsonPage(entries, adminPath, siteLogo, Boolean(adminUser || adminPass)), {
        headers: {
            'Content-Type': 'text/html;charset=utf-8',
            'Cache-Control': 'no-store'
        }
    });
}

async function handleAdminStatus(request, runtime) {
    if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const status = await getBackendStatus(
        runtime.effectiveSubConverter,
        runtime.effectiveSubConfig,
        runtime.effectiveSubProtocol,
        runtime.hasCustomApi,
        runtime.hasCustomConfig
    );
    return jsonResponse(status);
}

function renderAdminJsonPage(entries, adminPath, siteLogo, credentialsConfigured = false) {
    const exportData = Object.fromEntries(entries.map(entry => [entry.name, entry.raw ?? entry.value]));
    const safeExportData = serializeInlineJson(exportData);
    const safeDisplayEntries = serializeInlineJson(entries.map(({ name, value }) => ({ name, value })));
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>备份与迁移 · ${escapeHTML(FileName || 'CF-SUBS')}</title>${faviconTag(siteLogo, `备份与迁移 · ${FileName || 'CF-SUBS'}`)}
<style>
${getToolStyles()}
body{min-height:100vh}
.json-shell{max-width:1100px;padding-top:0!important;padding-bottom:34px}
.json-header{margin:0 -28px 18px;padding:28px;border-bottom:1px solid rgba(120,130,140,.18)}
.json-header-main{min-width:0}
.json-list{display:grid;gap:10px}
.json-entry{min-width:0;padding:14px;border:1px solid rgba(120,130,140,.2);border-radius:12px;background:rgba(255,255,255,.58)}
.json-entry-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.json-key{min-width:0;font-size:16px;font-weight:700;overflow-wrap:anywhere}
.json-entry-meta{display:flex;flex:0 0 auto;align-items:center;gap:10px}
.json-empty{padding:28px 12px;color:#777;text-align:center}
.json-actions{display:flex;gap:8px;flex-wrap:wrap}
.json-toast{position:fixed;top:18px;right:18px;z-index:10000;display:none;max-width:calc(100vw - 36px);padding:10px 14px;border-radius:10px;background:#1f2937;color:#fff;box-shadow:0 8px 30px rgba(0,0,0,.18)}
.json-view-overlay{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.58);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);overscroll-behavior:contain}
.json-view-overlay.open{display:flex}
.json-view-modal{display:flex;width:min(900px,100%);max-height:min(82vh,900px);flex-direction:column;padding:20px;border:1px solid rgba(120,130,140,.24);border-radius:16px;background:#fff;color:#1f2937;box-shadow:0 18px 55px rgba(0,0,0,.32);overscroll-behavior:contain}
.json-view-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.json-view-title{min-width:0;margin:0;font-size:18px;font-weight:750;overflow-wrap:anywhere}
.json-view-close{width:38px;min-width:38px;height:38px;flex:0 0 auto;padding:0;font-size:22px;line-height:1}
.json-view-value{max-height:calc(82vh - 90px);min-height:0;margin:0;padding:14px;border-radius:10px;background:rgba(245,247,248,.9);font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow:auto;overscroll-behavior:contain;touch-action:pan-x pan-y}
.factory-reset-modal{width:min(480px,100%);gap:12px}
.factory-reset-modal h2{margin:0;font-size:20px}
.factory-reset-modal p{margin:0;color:#b42318;line-height:1.6}
.factory-reset-modal label{display:block;margin:4px 0}
.factory-reset-modal input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid rgba(120,130,140,.35);border-radius:9px;font:inherit}
.factory-reset-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
@media(max-width:600px){.page.app-shell.json-shell{width:calc(100% - 28px);margin:14px 14px 28px;padding:0 14px 24px;border-radius:22px}.json-header{margin:0 -14px 16px;padding:22px 14px 20px}.json-header .title{font-size:22px}.json-actions{width:100%}.json-actions .button{flex:1 1 auto;text-align:center}.json-entry{padding:10px}.json-key{font-size:14px;overflow-wrap:anywhere}.json-entry-head{align-items:center}.json-view-overlay{padding:12px}.json-view-modal{max-height:86vh;padding:16px;border-radius:14px}.json-view-value{max-height:calc(86vh - 82px);padding:10px}}
@media(prefers-color-scheme:dark){.json-header{border-bottom-color:rgba(255,255,255,.1)}.json-entry{background:rgba(8,12,14,.78);border-color:rgba(255,255,255,.12)}.json-empty{color:#9aa7b5}.json-view-modal{background:#11191d;border-color:rgba(255,255,255,.16);color:#e7ecef}.json-view-value{background:rgba(2,6,8,.72);color:#e7ecef}.factory-reset-modal p{color:#ff8a80}.factory-reset-modal input{background:rgba(0,0,0,.35);border-color:rgba(255,255,255,.16);color:#f3f6f7}}
</style>
</head>
<body>
<main class="page app-shell json-shell">
<header class="header json-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px">
<div class="json-header-main"><h1 class="title">备份与迁移</h1><div class="subtitle">共 ${entries.length} 项 KV 数据；导入时同名键覆盖，其他数据保留</div></div>
<div class="json-actions"><button type="button" class="button danger" id="factory-reset-open">恢复出厂设置</button><button type="button" class="button" id="json-export-all">导出</button><button type="button" class="button secondary" id="json-import-all">导入</button><button type="button" class="button secondary" id="json-refresh">刷新</button><a class="button secondary" href="/${escapeHTML(adminPath)}">返回管理面板</a></div>
</header>
<div id="json-list" class="json-list">${entries.length ? entries.map((entry, index) => `<article class="json-entry"><div class="json-entry-head"><div class="json-key">${escapeHTML(entry.name)}</div><div class="json-entry-meta"><button type="button" class="button secondary json-show" data-entry-index="${index}">展示</button></div></div></article>`).join('') : '<div class="json-entry json-empty">KV 暂无数据</div>'}</div>
</main>
<div id="jsonViewOverlay" class="json-view-overlay" aria-hidden="true"><section class="json-view-modal" role="dialog" aria-modal="true" aria-labelledby="jsonViewTitle"><div class="json-view-head"><h2 id="jsonViewTitle" class="json-view-title"></h2><button type="button" class="button secondary json-view-close" id="jsonViewClose" aria-label="关闭">×</button></div><pre id="jsonViewValue" class="json-view-value"></pre></section></div>
<div id="factoryResetOverlay" class="json-view-overlay" aria-hidden="true"><section class="json-view-modal factory-reset-modal" role="dialog" aria-modal="true" aria-labelledby="factoryResetTitle"><h2 id="factoryResetTitle">恢复出厂设置</h2><p>此操作会永久删除当前 KV 中的全部数据，包括 CONFIG、所有订阅和链接。请先导出备份；删除后无法撤销。</p>${credentialsConfigured ? '<label for="factoryResetUsername">管理员用户名</label><input id="factoryResetUsername" type="text" autocomplete="username" required><label for="factoryResetPassword">管理员密码</label><input id="factoryResetPassword" type="password" autocomplete="current-password" required>' : '<p>当前未设置管理员用户名和密码。确认后将直接执行删除。</p>'}<div class="factory-reset-actions"><button type="button" class="button secondary" id="factoryResetCancel">取消</button><button type="button" class="button danger" id="factoryResetConfirm">${credentialsConfigured ? '验证并删除全部数据' : '确认删除全部数据'}</button></div></section></div>
<div class="json-toast" id="jsonToast" role="status" aria-live="polite"></div>
<script>
(function(){
'use strict';
var exportData=${safeExportData};
var displayEntries=${safeDisplayEntries};
var toast=document.getElementById('jsonToast'),toastTimer;
function showMessage(message,isError){toast.textContent=message;toast.style.background=isError?'#d93025':'#1f2937';toast.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(function(){toast.style.display='none'},2200)}
function escapeHtml(value){return String(value).replace(/[&<>"']/g,function(character){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]})}
function renderJsonEntries(){
 var list=document.getElementById('json-list');
 list.innerHTML=displayEntries.length?displayEntries.map(function(entry,index){return '<article class="json-entry"><div class="json-entry-head"><div class="json-key">'+escapeHtml(entry.name)+'</div><div class="json-entry-meta"><button type="button" class="button secondary json-show" data-entry-index="'+index+'">展示</button></div></div></article>'}).join(''):'<div class="json-entry json-empty">KV 暂无数据</div>';
 var subtitle=document.querySelector('.json-header-main .subtitle');
 if(subtitle)subtitle.textContent='共 '+displayEntries.length+' 项 KV 数据；导入时同名键覆盖，其他数据保留';
}
var openOverlays=new Set(),savedBodyStyles=null,savedScrollX=0,savedScrollY=0;
function lockPageScroll(){if(savedBodyStyles)return;savedScrollX=window.scrollX;savedScrollY=window.scrollY;savedBodyStyles={position:document.body.style.position,top:document.body.style.top,left:document.body.style.left,width:document.body.style.width,overflow:document.body.style.overflow};document.body.style.position='fixed';document.body.style.top=(-savedScrollY)+'px';document.body.style.left=(-savedScrollX)+'px';document.body.style.width='100%';document.body.style.overflow='hidden'}
function unlockPageScroll(){if(!savedBodyStyles)return;Object.assign(document.body.style,savedBodyStyles);window.scrollTo(savedScrollX,savedScrollY);savedBodyStyles=null}
function openOverlay(overlay){if(!openOverlays.size)lockPageScroll();openOverlays.add(overlay);overlay.classList.add('open');overlay.setAttribute('aria-hidden','false')}
function closeOverlay(overlay){if(!openOverlays.delete(overlay))return;overlay.classList.remove('open');overlay.setAttribute('aria-hidden','true');if(!openOverlays.size)unlockPageScroll()}
var viewOverlay=document.getElementById('jsonViewOverlay'),viewTitle=document.getElementById('jsonViewTitle'),viewValue=document.getElementById('jsonViewValue'),viewClose=document.getElementById('jsonViewClose'),lastViewTrigger=null;
function closeJsonView(){closeOverlay(viewOverlay);viewTitle.textContent='';viewValue.textContent='';if(lastViewTrigger)lastViewTrigger.focus()}
document.getElementById('json-list').addEventListener('click',function(event){var button=event.target.closest('.json-show');if(!button)return;var entry=displayEntries[Number(button.dataset.entryIndex)];if(!entry)return;lastViewTrigger=button;viewTitle.textContent=entry.name;viewValue.textContent=entry.value;openOverlay(viewOverlay);viewClose.focus()});
viewClose.addEventListener('click',closeJsonView);
viewOverlay.addEventListener('click',function(event){if(event.target===viewOverlay)closeJsonView()});
var resetOverlay=document.getElementById('factoryResetOverlay'),resetUsername=document.getElementById('factoryResetUsername'),resetPassword=document.getElementById('factoryResetPassword'),resetConfirm=document.getElementById('factoryResetConfirm'),resetCredentialsRequired=${credentialsConfigured};
function closeFactoryReset(){closeOverlay(resetOverlay);if(resetPassword)resetPassword.value=''}
document.getElementById('factory-reset-open').addEventListener('click',function(){openOverlay(resetOverlay);if(resetUsername)resetUsername.focus()});
document.getElementById('factoryResetCancel').addEventListener('click',closeFactoryReset);
resetOverlay.addEventListener('click',function(event){if(event.target===resetOverlay)closeFactoryReset()});
document.addEventListener('keydown',function(event){if(event.key!=='Escape'||!openOverlays.size)return;event.preventDefault();var overlays=Array.from(openOverlays),top=overlays[overlays.length-1];if(top===viewOverlay)closeJsonView();else closeFactoryReset()});
resetConfirm.addEventListener('click',async function(){var username=resetUsername?resetUsername.value:'',password=resetPassword?resetPassword.value:'';if(resetCredentialsRequired&&(!username||!password)){showMessage('请输入管理员用户名和密码',true);return}if(!confirm('确定永久删除当前 KV 中的全部数据吗？此操作无法撤销。'))return;resetConfirm.disabled=true;try{var response=await fetch(window.location.pathname,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({type:'factory_reset',username:username,password:password})}),result=await response.json().catch(function(){return{}});if(!response.ok||!result.ok)throw new Error(result.error||'恢复出厂设置失败');showMessage('已删除 '+result.deleted+' 项 KV 数据');setTimeout(function(){window.location.assign('/')},900)}catch(error){showMessage(error.message||'恢复出厂设置失败',true);if(resetPassword){resetPassword.value='';resetPassword.focus()}}finally{resetConfirm.disabled=false}});
function downloadExport(){var blob=new Blob([JSON.stringify(exportData,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='kv-export-'+new Date().toISOString().slice(0,10)+'.json';document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(function(){URL.revokeObjectURL(url)},1000);showMessage('已导出全部 KV 数据')}
document.getElementById('json-export-all').addEventListener('click',downloadExport);
document.getElementById('json-refresh').addEventListener('click',function(){window.location.reload()});
var input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.hidden=true;document.body.appendChild(input);
document.getElementById('json-import-all').addEventListener('click',function(){input.click()});
input.addEventListener('change',async function(){var file=input.files&&input.files[0];if(!file)return;try{var payload=JSON.parse(await file.text());if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('导入内容必须是一个 JSON 对象');var response=await fetch(window.location.pathname,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({type:'import_all_json',payload:payload})}),result=await response.json().catch(function(){return{}});if(!response.ok||!result.ok)throw new Error(result.error||'导入失败');if(!Array.isArray(result.entries))throw new Error('导入成功，但无法刷新当前数据列表');exportData={};displayEntries=result.entries.map(function(entry){exportData[entry.name]=entry.raw===undefined?entry.value:entry.raw;return{name:entry.name,value:entry.value}});renderJsonEntries();showMessage('已导入 '+(result.count||0)+' 项数据')}catch(error){showMessage(error.message||'导入失败',true)}finally{input.value=''}});
})();
<\/script>
</body>
</html>`;
}

function normalizeAdminPath(value) {
    let path = String(value || '').trim();
    if (!path) return DEFAULT_ADMIN_PATH;
    path = path.replace(/^[/]+/, '').replace(/[/]+$/, '');
    if (!/^[A-Za-z0-9_-]{2,60}$/.test(path)) return '';
    return path;
}

function normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeToken(value) {
    return String(value || '').trim();
}

function validName(name) {
    return name.length >= 1 && name.length <= 80;
}

function validCustomToken(token, adminPath) {
    const lower = token.toLowerCase();
    const reserved = new Set([
        'admin', 'api', 'login', 'logout', 'favicon.ico',
        DEFAULT_ADMIN_PATH.toLowerCase(),
        String(adminPath || DEFAULT_ADMIN_PATH).toLowerCase()
    ]);
    const hasControlCharacter = Array.from(token).some(character => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
    });

    return (
        token.length > 0 &&
        new TextEncoder().encode(token).length <= 508 &&
        token !== '.' &&
        token !== '..' &&
        !/[\\/?#]/.test(token) &&
        !hasControlCharacter &&
        !reserved.has(lower)
    );
}

async function isSubNameUsed(env, name, exceptId = '') {
    const subs = await listSubs(env);
    return subs.some(s =>
        s.id !== exceptId &&
        String(s.name).toLowerCase() === String(name).toLowerCase()
    );
}

async function isTokenNameUsed(env, name, exceptToken = '') {
    const tokens = await listTokens(env);
    return tokens.some(t =>
        t.url !== exceptToken &&
        String(t.name).toLowerCase() === String(name).toLowerCase()
    );
}

function cleanSourceList(input) {
    if (Array.isArray(input)) {
        return input
            .flatMap(x => String(x || '').split(/\r?\n/))
            .map(x => x.trim())
            .filter(Boolean);
    }

    return String(input || '')
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean);
}

async function handleAdmin(request, env, runtime) {
    if (!env.KV) {
        return new Response(
            '未绑定名为 KV 的 Cloudflare KV Namespace。',
            { status: 500 }
        );
    }

    // 管理后台 POST：统一处理配置 / SUB / URL
    if (request.method === 'POST') {
        const contentType = request.headers.get('content-type') || '';

        if (contentType.includes('application/x-www-form-urlencoded')) {
            return new Response('不支持的数据格式', { status: 400 });
        }

        try {
            const data = await request.json();

            if (data.type === 'config') {
                const old = await getConfig(env);

                const next = {
                    subName: normalizeName(data.settings?.subName) || 'CF-SUBS',
                    subApi: String(data.settings?.subApi || '').trim(),
                    subConfig: String(data.settings?.subConfig || '').trim(),
                    siteLogo: String(data.settings?.siteLogo ?? old.siteLogo ?? '').trim(),
                    noAds: String(data.settings?.noAds || '').trim(),

                    // 保留旧配置
                    user: String(data.settings?.user || old.user || ''),
                    pass: data.settings?.pass
                        ? String(data.settings.pass)
                        : String(old.pass || ''),
                    adminPath: normalizeAdminPath(data.settings?.adminPath || old.adminPath) || DEFAULT_ADMIN_PATH,

                    fakeMode: String(data.settings?.fakeMode ?? old.fakeMode ?? ''),
                    fakeUrl: String(data.settings?.fakeUrl ?? old.fakeUrl ?? ''),
                    fakeUrl302: String(data.settings?.fakeUrl302 ?? old.fakeUrl302 ?? ''),
                    fakeCode: String(data.settings?.fakeCode ?? old.fakeCode ?? '')
                };

                await env.KV.put('CONFIG.json', serializeKVJson(next));
                return jsonResponse({
                    ok: true,
                    adminPath: next.adminPath,
                    credentialsChanged: next.user !== String(old.user || '') || next.pass !== String(old.pass || '')
                });
            }

            if (data.type === 'sub_create') {
                const name = normalizeName(data.name);
                const sources = cleanSourceList(data.sources);

                if (!validName(name)) return new Response('SUBS 名称不能为空且不能超过 80 个字符', { status: 400 });
                if (await isSubNameUsed(env, name)) return new Response('SUBS 名称已存在，不能重名', { status: 409 });
                if (!sources.length) return new Response('至少添加一个订阅地址或单节点', { status: 400 });

                const id = makeSubId();
                const item = {
                    id,
                    name,
                    enabled: true,
                    order: Date.now(),
                    sources,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                await env.KV.put(`${SUB_PREFIX}${id}`, serializeKVJson(item));
                return jsonResponse({ ok: true, sub: item });
            }

            if (data.type === 'sub_update') {
                const id = String(data.id || '');
                const old = await getSub(env, id);
                if (!old) return new Response('SUBS 不存在', { status: 404 });

                const name = normalizeName(data.name);
                const sources = cleanSourceList(data.sources);

                if (!validName(name)) return new Response('SUBS 名称不能为空且不能超过 80 个字符', { status: 400 });
                if (await isSubNameUsed(env, name, id)) return new Response('SUBS 名称已存在，不能重名', { status: 409 });
                if (!sources.length) return new Response('至少添加一个订阅地址或单节点', { status: 400 });

                const item = {
                    ...old,
                    name,
                    sources,
                    enabled: true,
                    order: Number.isFinite(Number(old.order)) ? Number(old.order) : Date.now(),
                    updatedAt: new Date().toISOString()
                };
                delete item.update;
                delete item.updateEnable;

                await env.KV.put(`${SUB_PREFIX}${id}`, serializeKVJson(item));
                return jsonResponse({ ok: true, sub: item });
            }

            if (data.type === 'sub_reorder') {
                const ids = Array.isArray(data.ids)
                    ? [...new Set(data.ids.map(String).filter(Boolean))]
                    : [];

                if (!ids.length) return new Response('排序数据不能为空', { status: 400 });

                const subs = await listSubs(env);
                const byId = new Map(subs.map(item => [String(item.id), item]));
                if (ids.length !== subs.length || ids.some(id => !byId.has(id))) {
                    return new Response('聚合节点排序数据不完整', { status: 400 });
                }

                const now = Date.now();
                await Promise.all(ids.map((id, index) => {
                    const item = byId.get(id);
                    item.order = index;
                    item.updatedAt = new Date(now + index).toISOString();
                    return env.KV.put(`${SUB_PREFIX}${id}`, serializeKVJson(item));
                }));

                return jsonResponse({ ok: true, ids });
            }

            if (data.type === 'sub_delete') {
                const id = String(data.id || '');
                if (!(await getSub(env, id))) return new Response('SUBS 不存在', { status: 404 });

                await env.KV.delete(`${SUB_PREFIX}${id}`);

                // 删除 SUB 后，自动从所有 URL 的绑定列表移除
                const tokens = await listTokens(env);
                const affected = tokens.filter(item => Array.isArray(item.subs) && item.subs.includes(id));
                await Promise.all(affected.map(item => {
                    item.subs = item.subs.filter(x => x !== id);
                    item.updatedAt = new Date().toISOString();
                    return env.KV.put(`${URL_PREFIX}${item.url}`, serializeKVJson(item));
                }));

                return jsonResponse({ ok: true });
            }

            if (data.type === 'url_create') {
                const name = normalizeName(data.name);
                let token = normalizeToken(data.url || data.token);
                const selected = Array.isArray(data.subs)
                    ? [...new Set(data.subs.map(String))]
                    : [];

                if (!validName(name)) return new Response('链接名称不能为空且不能超过 80 个字符', { status: 400 });
                if (await isTokenNameUsed(env, name)) return new Response('链接名称已存在，不能重名', { status: 409 });

                if (!token) token = await makeRandomToken(env, runtime.adminPath);
                if (!validCustomToken(token, runtime.adminPath)) {
                    return new Response('订阅路径不能为空，不能包含 /、\\、?、# 或控制字符，也不能使用系统保留路径', { status: 400 });
                }
                if (await getToken(env, token)) {
                    return new Response('URL 已存在，请使用其他 URL', { status: 409 });
                }

                const validSubs = [];
                for (const id of selected) {
                    if (await getSub(env, id)) validSubs.push(id);
                }

                if (!validSubs.length) {
                    return new Response('至少选择一个聚合节点', { status: 400 });
                }

                const item = {
                    url: token,
                    name,
                    subs: validSubs,
                    update: normalizeUpdateMinutes(data.update),
                    updateEnable: normalizeUpdateEnabled(data.updateEnable),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                await env.KV.put(`${URL_PREFIX}${token}`, serializeKVJson(item));
                return jsonResponse({ ok: true, url: item });
            }

            if (data.type === 'url_update') {
                const oldToken = normalizeToken(data.oldUrl || data.oldToken || data.url || data.token);
                let newToken = normalizeToken(data.newUrl ?? data.newToken ?? data.url ?? data.token);
                if (!newToken) newToken = await makeRandomToken(env, runtime.adminPath);
                const old = await getToken(env, oldToken);
                if (!old) return new Response('URL 不存在', { status: 404 });

                const name = normalizeName(data.name);
                const selected = Array.isArray(data.subs)
                    ? [...new Set(data.subs.map(String))]
                    : [];

                if (!validName(name)) return new Response('链接名称不能为空且不能超过 80 个字符', { status: 400 });
                if (!validCustomToken(newToken, runtime.adminPath)) {
                    return new Response('订阅路径不能包含 /、\\、?、# 或控制字符，也不能使用系统保留路径', { status: 400 });
                }
                if (await isTokenNameUsed(env, name, oldToken)) return new Response('链接名称已存在，不能重名', { status: 409 });

                if (newToken !== oldToken && await getToken(env, newToken)) {
                    return new Response('新的 URL 已存在，请使用其他 URL', { status: 409 });
                }

                const validSubs = [];
                for (const id of selected) {
                    if (await getSub(env, id)) validSubs.push(id);
                }

                if (!validSubs.length) return new Response('至少选择一个聚合节点', { status: 400 });

                const item = {
                    ...old,
                    url: newToken,
                    name,
                    subs: validSubs,
                    update: normalizeUpdateMinutes(data.update),
                    updateEnable: normalizeUpdateEnabled(data.updateEnable),
                    updatedAt: new Date().toISOString()
                };

                // URL 本身发生变化时，迁移 KV Key，确保旧地址立即失效、新地址立即生效。
                if (newToken !== oldToken) {
                    await env.KV.put(`${URL_PREFIX}${newToken}`, serializeKVJson(item));
                    await env.KV.delete(`${URL_PREFIX}${oldToken}`);
                } else {
                    await env.KV.put(`${URL_PREFIX}${oldToken}`, serializeKVJson(item));
                }

                return jsonResponse({ ok: true, url: item, oldUrl: oldToken });
            }

            if (data.type === 'url_delete') {
                const token = normalizeToken(data.url || data.token);
                if (!(await getToken(env, token))) return new Response('URL 不存在', { status: 404 });

                await env.KV.delete(`${URL_PREFIX}${token}`);
                return jsonResponse({ ok: true });
            }

            return new Response('不支持的数据类型', { status: 400 });
        } catch (e) {
            return new Response(`服务器错误: ${e.message}`, { status: 500 });
        }
    }

    const [subs, tokens, settings] = await Promise.all([
        listSubs(env),
        listTokens(env),
        getConfig(env)
    ]);

    const status = await getBackendStatus(
        runtime.effectiveSubConverter,
        runtime.effectiveSubConfig,
        runtime.effectiveSubProtocol,
        runtime.hasCustomApi,
        runtime.hasCustomConfig
    );

    return new Response(
        renderAdminPage(
            new URL(request.url),
            subs,
            tokens,
            settings,
            status
        ),
        {
            headers: {
                'Content-Type': 'text/html;charset=utf-8',
                'Cache-Control': 'no-store'
            }
        }
    );
}

async function getConfig(env) {
    const defaults = {
        subName: 'CF-SUBS',
        subApi: '',
        subConfig: '',
        siteLogo: '',
        noAds: '',
        user: '',
        pass: '',
        adminPath: DEFAULT_ADMIN_PATH,
        fakeMode: '',
        fakeUrl: '',
        fakeUrl302: '',
        fakeCode: ''
    };

    if (!env.KV) return defaults;

    try {
        const config = await getKVJson(env, 'CONFIG.json');
        return config ? { ...defaults, ...config } : defaults;
    } catch {
        return defaults;
    }
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'Cache-Control': 'no-store'
        }
    });
}

function serializeInlineJson(value) {
    return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => ({
        '<': '\\u003c',
        '>': '\\u003e',
        '&': '\\u0026',
        '\u2028': '\\u2028',
        '\u2029': '\\u2029'
    })[character]);
}

const KV_JSON_CAMEL_KEYS = {
    ADMINPATH: 'adminPath',
    CREATEDAT: 'createdAt',
    FAKECODE: 'fakeCode',
    FAKEMODE: 'fakeMode',
    FAKEURL: 'fakeUrl',
    FAKEURL302: 'fakeUrl302',
    NOADS: 'noAds',
    SITELOGO: 'siteLogo',
    SUBAPI: 'subApi',
    SUBCONFIG: 'subConfig',
    SUBNAME: 'subName',
    UPDATEDAT: 'updatedAt',
    UPDATE_ENABLE: 'updateEnable'
};

function transformKVJsonKeys(value, transformKey) {
    if (Array.isArray(value)) return value.map(item => transformKVJsonKeys(item, transformKey));
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        transformKey(key),
        transformKVJsonKeys(item, transformKey)
    ]));
}

function serializeKVJson(value) {
    return JSON.stringify(transformKVJsonKeys(value, key => key === 'updateEnable' ? 'UPDATE_ENABLE' : key.toUpperCase()));
}

function normalizeKVJson(value) {
    return transformKVJsonKeys(value, key => {
        if (key !== key.toUpperCase()) return key;
        return KV_JSON_CAMEL_KEYS[key] || key.toLowerCase();
    });
}

async function getKVJson(env, key) {
    const raw = await env.KV.get(key);
    if (raw === null) return null;

    const value = normalizeKVJson(JSON.parse(raw));
    const uppercaseValue = serializeKVJson(value);
    if (uppercaseValue !== raw) await env.KV.put(key, uppercaseValue);
    return value;
}

async function ADD(envadd) {
    var addtext = envadd.replace(/[ "'|\r\n]+/g, '\n').replace(/\n+/g, '\n');
    if (addtext.charAt(0) == '\n') addtext = addtext.slice(1);
    if (addtext.charAt(addtext.length - 1) == '\n') addtext = addtext.slice(0, addtext.length - 1);
    return addtext.split('\n');
}

async function generateSubscription(request, sourceList, runtime, token) {
    const requestUrl = new URL(request.url);
    const isSubConverterRequest =
        request.headers.has('subconverter-request') ||
        request.headers.has('subconverter-version') ||
        runtime.userAgent.includes('subconverter');

    let target = 'base64';
    if (!(
        runtime.userAgent.includes('null') ||
        isSubConverterRequest ||
        runtime.userAgent.includes('nekobox') ||
        runtime.userAgent.includes('cf-sub')
    )) {
        if (runtime.userAgent.includes('sing-box') || runtime.userAgent.includes('singbox')) target = 'singbox';
        else if (runtime.userAgent.includes('surge')) target = 'surge';
        else if (runtime.userAgent.includes('quantumult')) target = 'quanx';
        else if (runtime.userAgent.includes('loon')) target = 'loon';
        else if (runtime.userAgent.includes('clash') || runtime.userAgent.includes('meta') || runtime.userAgent.includes('mihomo')) target = 'clash';
    }

    if (requestUrl.searchParams.has('b64') || requestUrl.searchParams.has('base64')) {
        target = 'base64';
    } else if (requestUrl.searchParams.has('clash')) {
        target = 'clash';
    } else if (requestUrl.searchParams.has('sb') || requestUrl.searchParams.has('singbox')) {
        target = 'singbox';
    } else if (requestUrl.searchParams.has('surge')) {
        target = 'surge';
    } else if (requestUrl.searchParams.has('quanx')) {
        target = 'quanx';
    } else if (requestUrl.searchParams.has('loon')) {
        target = 'loon';
    }

    if (!sourceList.length) {
        return new Response('此订阅链接没有启用的聚合来源。', {
            status: 404,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
        });
    }

    const sourceData = await collectSubscriptionSources(
        sourceList,
        request,
        subscriptionUserAgent(target),
        runtime.userAgentHeader
    );
    if (!sourceData.nodes.length && !sourceData.structuredUrls.length) {
        return new Response('订阅源均无法读取，请检查来源地址后重试。', {
            status: 502,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
        });
    }

    const filteredNodes = filterSubscriptionNodes(sourceData.nodes, runtime.configNoAds);
    const rawResult = filteredNodes.join('\n');
    const responseHeaders = {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'Profile-web-page-url': `${requestUrl.origin}${requestUrl.pathname}`
    };
    if (runtime.updateEnabled) {
        responseHeaders['Profile-Update-Interval'] = String(runtime.updateMinutes * 60);
    }

    const convertUrl = sourceData.structuredUrls.join('|');
    if (target === 'base64') {
        let result = rawResult;
        if (convertUrl) {
            try {
                const converted = await fetchConvertedSubscription(
                    runtime,
                    'mixed',
                    convertUrl,
                    runtime.userAgentHeader
                );
                const convertedNodes = converted ? await ADD(converted) : [];
                result = filterSubscriptionNodes(
                    [...sourceData.nodes, ...convertedNodes],
                    runtime.configNoAds
                ).join('\n');
            } catch (error) {
                console.error('Base64 subscription conversion failed:', error);
                return new Response(
                    `Base64 订阅生成失败：${getSubscriptionErrorMessage(error)}`,
                    {
                    status: 502,
                    headers: responseHeaders
                    }
                );
            }
        }
        return new Response(encodeBase64(result), { headers: responseHeaders });
    }

    const sourceToken = requestUrl.searchParams.get('sourceToken') || token || '';
    const internalFeed = new URL(`/${encodeURIComponent(runtime.fakeToken)}`, requestUrl.origin);
    internalFeed.searchParams.set('token', runtime.fakeToken);
    if (sourceToken) internalFeed.searchParams.set('sourceToken', sourceToken);
    const converterInput = [internalFeed.href, ...sourceData.structuredUrls].join('|');

    try {
        let content = await fetchConvertedSubscription(
            runtime,
            target,
            converterInput,
            runtime.userAgentHeader
        );
        if (target === 'clash') content = clashFix(content);
        if (!runtime.userAgent.includes('mozilla')) {
            responseHeaders['Content-Disposition'] =
                `attachment; filename*=utf-8''${encodeURIComponent(runtime.fileName)}`;
        }
        return new Response(content, { headers: responseHeaders });
    } catch (error) {
        console.error(`Subscription conversion failed (${target}):`, error);
        return new Response(
            `订阅格式转换失败（${target}）：${getSubscriptionErrorMessage(error)}`,
            { status: 502, headers: responseHeaders }
        );
    }
}

function getSubscriptionErrorMessage(error) {
    if (error instanceof Error) return error.message;
    return String(error || '未知错误');
}

async function collectSubscriptionSources(sourceList, request, additionalUserAgent, userAgentHeader) {
    const inlineSources = [];
    const remoteSources = [];

    for (const source of sourceList) {
        if (/^https?:\/\//i.test(source)) remoteSources.push(source);
        else inlineSources.push(source);
    }

    const nodes = [];
    for (const source of inlineSources) {
        nodes.push(...(await ADD(source)).filter(Boolean));
    }
    const structuredUrls = [];
    const results = await Promise.allSettled(remoteSources.map(async source => {
        const response = await getUrl(request, source, additionalUserAgent, userAgentHeader);
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`来源返回 HTTP ${response.status}`);
        }
        return { source, content: (await response.text()).replace(/^\uFEFF/, '').trim() };
    }));

    for (let index = 0; index < results.length; index++) {
        const result = results[index];
        if (result.status === 'rejected') {
            let sourceOrigin = 'invalid subscription URL';
            try {
                sourceOrigin = new URL(remoteSources[index]).origin;
            } catch {}
            console.warn('Subscription source request failed:', sourceOrigin, result.reason);
            continue;
        }

        const { source, content } = result.value;
        if (!content) continue;
        if (isStructuredSubscription(content)) {
            structuredUrls.push(source);
            continue;
        }

        let decoded = content;
        if (!content.includes('://') && isValidBase64(content)) {
            try {
                decoded = base64Decode(content.replace(/\s/g, ''));
            } catch (error) {
                console.warn('Subscription source Base64 decode failed:', source, error);
                continue;
            }
        }
        if (decoded.includes('://')) {
            nodes.push(...(await ADD(decoded)).filter(line => line.includes('://')));
        } else {
            console.warn('Subscription source format not recognized:', source);
        }
    }

    return {
        nodes: [...new Set(nodes)],
        structuredUrls: [...new Set(structuredUrls)]
    };
}

function isStructuredSubscription(content) {
    return /(?:^|\n)\s*proxies\s*:/i.test(content) ||
        /"(?:outbounds|inbounds)"\s*:/.test(content) ||
        /(?:^|\n)\s*proxy-providers\s*:/i.test(content);
}

function filterSubscriptionNodes(nodes, noAds) {
    const keywords = String(noAds || '')
        .split(/[, \r\n]+/)
        .map(keyword => keyword.trim().toLowerCase())
        .filter(Boolean);
    return [...new Set(nodes.filter(line => {
        const lowerLine = line.toLowerCase();
        return !keywords.some(keyword => lowerLine.includes(keyword));
    }))];
}

async function fetchConvertedSubscription(runtime, target, sourceUrl, userAgent) {
    const urls = [];
    if (runtime.effectiveSubConverter) {
        urls.push(buildSubUrl(
            runtime.effectiveSubConverter,
            runtime.effectiveSubConfig,
            target,
            sourceUrl,
            runtime.effectiveSubProtocol
        ));
    }

    const defaultUrl = buildSubUrl(
        defaultSubConverter,
        defaultSubConfig,
        target,
        sourceUrl,
        defaultSubProtocol
    );
    if (!urls.includes(defaultUrl)) urls.push(defaultUrl);

    let lastError;
    for (const converterUrl of urls) {
        try {
            const response = await fetchWithTimeout(converterUrl, {
                headers: { 'User-Agent': userAgent }
            }, 15000);
            if (!response.ok) {
                const errorBody = (await response.text())
                    .replace(/https?:\/\/\S+/gi, '[url]')
                    .replace(/\s+/g, ' ')
                    .slice(0, 240);
                throw new Error(
                    `SUBAPI 返回 HTTP ${response.status}${errorBody ? `: ${errorBody}` : ''}`
                );
            }
            const body = await response.text();
            if (target === 'mixed') {
                if (isValidBase64(body.trim())) return base64Decode(body.trim());
                if (body.includes('://')) return body;
                throw new Error('SUBAPI mixed 响应不是有效的 Base64 或节点列表');
            }
            return body;
        } catch (error) {
            lastError = error;
            console.warn(`SUBAPI request failed (${target}):`, error);
        }
    }

    throw lastError || new Error('没有可用的 SUBAPI');
}

function subscriptionUserAgent(target) {
    return ({
        base64: 'v2rayn',
        clash: 'clash',
        singbox: 'singbox',
        surge: 'surge',
        quanx: 'Quantumult%20X',
        loon: 'Loon'
    })[target] || 'v2rayn';
}

function buildSubUrl(api, config, target, urlToConvert, protocol) {
    let base = `${protocol}://${api}/sub?target=${target}&url=${encodeURIComponent(urlToConvert)}&insert=false&config=${encodeURIComponent(config)}&emoji=true&list=false&tfo=false&scv=true&fdn=false&sort=false`;
    if (target === 'surge') base += '&ver=4&new_name=true';
    else if (target === 'quanx') base += '&udp=true';
    else if (target === 'clash' || target === 'singbox' || target === 'mixed') base += '&new_name=true';
    return base;
}

async function getUrl(request, targetUrl, additionalUserAgent, userAgentHeader) {
    let currentUrl = parsePublicHttpUrl(targetUrl);
    let method = request.method;
    const headers = new Headers();
    headers.set('User-Agent', `v2rayN/6.45 cmliu/CF-SUB ${additionalUserAgent}(${userAgentHeader})`);
    headers.set('Accept', 'text/plain, application/json, */*');
    const contentType = request.headers.get('Content-Type');
    if (contentType) headers.set('Content-Type', contentType);

    for (let redirectCount = 0; redirectCount <= 5; redirectCount++) {
        const outboundRequest = new Request(currentUrl.href, {
            method,
            headers,
            body: method === 'GET' || method === 'HEAD' ? null : request.clone().body,
            redirect: 'manual'
        });
        const response = await fetchWithTimeout(outboundRequest, {}, 10000);
        const location = response.headers.get('Location');
        if (![301, 302, 303, 307, 308].includes(response.status) || !location) return response;
        if (redirectCount === 5) {
            await response.body?.cancel();
            throw new Error('订阅源重定向次数超过限制');
        }

        currentUrl = parsePublicHttpUrl(new URL(location, currentUrl).href);
        if (response.status === 303 || ([301, 302].includes(response.status) && method === 'POST')) {
            method = 'GET';
        }
        await response.body?.cancel();
    }

    throw new Error('订阅源重定向次数超过限制');
}

function parsePublicHttpUrl(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error('订阅源 URL 无效');
    }
    if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        isBlockedOutboundHostname(url.hostname)
    ) {
        throw new Error('订阅源 URL 不允许访问');
    }
    return url;
}

function isBlockedOutboundHostname(hostname) {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    const bareHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
    if (
        host === 'localhost' ||
        host.endsWith('.localhost') ||
        host.endsWith('.local') ||
        host.endsWith('.internal') ||
        host.endsWith('.home') ||
        host.endsWith('.lan') ||
        host.endsWith('.test') ||
        host.endsWith('.invalid') ||
        host.endsWith('.example') ||
        host.endsWith('.arpa') ||
        host === 'metadata.google' ||
        host === 'metadata.google.internal' ||
        host === 'metadata.azure.internal' ||
        host === 'instance-data.ec2.internal'
    ) return true;

    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bareHost)) {
        const octets = bareHost.split('.').map(Number);
        const [first, second, third] = octets;
        return first === 0 || first === 10 || first === 127 ||
            (first === 100 && second >= 64 && second <= 127) ||
            (first === 169 && second === 254) ||
            (first === 172 && second >= 16 && second <= 31) ||
            (first === 192 && (second === 0 || second === 2 || second === 168)) ||
            (first === 192 && second === 88 && third === 99) ||
            (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) ||
            (first === 203 && second === 0 && third === 113) ||
            first >= 224;
    }
    if (bareHost.includes(':')) {
        const ipv6 = bareHost.toLowerCase();
        return ipv6 === '::' || ipv6 === '::1' ||
            ipv6.startsWith('fc') || ipv6.startsWith('fd') ||
            /^fe[89ab]/.test(ipv6) || ipv6.startsWith('ff') ||
            ipv6.startsWith('2001:db8:') || ipv6.startsWith('::ffff:');
    }
    return false;
}

function isValidBase64(value) {
    const normalized = String(value || '').replace(/\s/g, '');
    return normalized.length >= 4 &&
        normalized.length % 4 !== 1 &&
        /^[A-Za-z0-9+/_-]+={0,2}$/.test(normalized);
}

function encodeBase64(value) {
    const bytes = new TextEncoder().encode(String(value || ''));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

function base64Decode(value) {
    let normalized = String(value || '').replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    normalized += '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function clashFix(content) {
    if (!content.includes('wireguard') || content.includes('remote-dns-resolve')) return content;
    return content.replace(
        /type: wireguard[^\r\n]*/g,
        line => line.replace(/, mtu: 1280, udp: true/g, ', mtu: 1280, remote-dns-resolve: true, udp: true')
    );
}

// ================== 原生页面兜底 ==================
async function nginx(titleName, siteLogo = '') {
    return `<!DOCTYPE html>
<html>
<head>
<title>${escapeHTML(titleName)}</title>
${faviconTag(siteLogo)}
<style>
    body { width: 35em; margin: 0 auto; font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and working. Further configuration is required.</p>
<p>For online documentation and support please refer to <a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at <a href="http://nginx.com/">nginx.com</a>.</p>
<p><em>Thank you for using nginx.</em></p>
</body>
</html>`;
}

// Cloudflare Workers 不保证 WebCrypto 支持 MD5。
// 使用纯 JS MD5，避免 crypto.subtle.digest('MD5') 触发 Worker 1101。
function md5Hex(input) {
    const data = new TextEncoder().encode(String(input));
    const bitLen = data.length * 8;
    const len = (((data.length + 8) >> 6) + 1) * 64;
    const bytes = new Uint8Array(len);
    bytes.set(data);
    bytes[data.length] = 0x80;

    const view = new DataView(bytes.buffer);
    view.setUint32(len - 8, bitLen >>> 0, true);
    view.setUint32(len - 4, Math.floor(bitLen / 0x100000000), true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    const s = [
        7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
        5,9,14,20, 5,9,14,20, 5,9,14,20, 5,9,14,20,
        4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
        6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21
    ];
    const K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) {
        K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
    }

    const leftRotate = (x, amount) => ((x << amount) | (x >>> (32 - amount))) >>> 0;

    for (let offset = 0; offset < bytes.length; offset += 64) {
        const M = new Uint32Array(16);
        for (let i = 0; i < 16; i++) M[i] = view.getUint32(offset + i * 4, true);

        let A = a0, B = b0, C = c0, D = d0;
        for (let i = 0; i < 64; i++) {
            let F, g;
            if (i < 16) { F = (B & C) | (~B & D); g = i; }
            else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
            else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
            else { F = C ^ (B | ~D); g = (7 * i) % 16; }
            F = (F + A + K[i] + M[g]) >>> 0;
            A = D; D = C; C = B; B = (B + leftRotate(F, s[i])) >>> 0;
        }
        a0 = (a0 + A) >>> 0;
        b0 = (b0 + B) >>> 0;
        c0 = (c0 + C) >>> 0;
        d0 = (d0 + D) >>> 0;
    }

    const out = new Uint8Array(16);
    const outView = new DataView(out.buffer);
    outView.setUint32(0, a0, true);
    outView.setUint32(4, b0, true);
    outView.setUint32(8, c0, true);
    outView.setUint32(12, d0, true);
    return Array.from(out, b => b.toString(16).padStart(2, '0')).join('');
}

async function MD5MD5(text) {
    const firstHex = md5Hex(text);
    return md5Hex(firstHex.slice(7, 27));
}

// 代理模式自动替换 HTML 标题
async function proxyURL(proxyURL, url, titleName, siteLogo = '') {
    const URLs = await ADD(proxyURL);
    const fullURL = URLs[Math.floor(Math.random() * URLs.length)];
    let parsedURL = new URL(fullURL);
    let URLPathname = parsedURL.pathname;
    if (URLPathname.charAt(URLPathname.length - 1) == '/') URLPathname = URLPathname.slice(0, -1);
    URLPathname += url.pathname;
    let newURL = `${parsedURL.protocol.slice(0, -1) || 'https'}://${parsedURL.hostname}${URLPathname}${parsedURL.search}`;
    
    let response = await fetch(newURL);
    const contentType = response.headers.get('content-type') || '';
    
    // 如果反代的是网页，则动态注入配置文件名作为标题
    if (contentType.includes('text/html')) {
        let html = await response.text();
        const title = `<title>${escapeHTML(titleName)}</title>`;
        if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)) {
            html = html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, title);
        } else if (/<head\b[^>]*>/i.test(html)) {
            html = html.replace(/<head\b[^>]*>/i, match => match + title);
        } else {
            html = title + html;
        }
        html = injectFavicon(html, siteLogo);
        let newResponse = new Response(html, {
            status: response.status,
            statusText: response.statusText,
            headers: new Headers(response.headers)
        });
        newResponse.headers.delete('content-length');
        newResponse.headers.set('X-New-URL', newURL);
        return newResponse;
    } else {
        let newResponse = new Response(response.body, { 
            status: response.status, 
            statusText: response.statusText, 
            headers: response.headers 
        });
        newResponse.headers.set('X-New-URL', newURL);
        return newResponse;
    }
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

function faviconTag(value, title = '') {
    const logoUrl = String(value || '').trim();
    if (logoUrl) {
        try {
            const parsedUrl = new URL(logoUrl);
            if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
                return `<link rel="icon" href="${escapeHTML(parsedUrl.href)}">`;
            }
        } catch {}
    }

    const initial = Array.from(String(title).trim())[0] || '?';
    if (!title) return '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1677ff"/><text x="32" y="45" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="40" font-weight="700" fill="#fff">${escapeHTML(initial)}</text></svg>`;
    return `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${escapeHTML(encodeURIComponent(svg))}">`;
}

function injectFavicon(html, value) {
    const tag = faviconTag(value);
    if (!tag) return html;

    const withoutExistingIcons = String(html).replace(
        /<link\b[^>]*\brel\s*=\s*(['"])(?:shortcut\s+)?icon\1[^>]*>/gi,
        ''
    );
    if (/<head\b[^>]*>/i.test(withoutExistingIcons)) {
        return withoutExistingIcons.replace(/<head\b[^>]*>/i, match => match + tag);
    }

    const htmlTag = withoutExistingIcons.match(/<html\b[^>]*>/i);
    if (htmlTag) {
        return withoutExistingIcons.replace(htmlTag[0], `${htmlTag[0]}<head>${tag}</head>`);
    }
    return `${tag}${withoutExistingIcons}`;
}

function escapeHTML(text = '') {
    return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function getAdminSessionValue(user, pass, issuedAt) {
    if (!user || !pass) return '';

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(pass),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const payload = `${ADMIN_SESSION_CONTEXT}:${user}:admin-login:${issuedAt}`;
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
    const signatureHex = Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${issuedAt}.${signatureHex}`;
}

async function isAdminLoggedIn(request, user, pass) {
    const session = getCookie(request, 'CF_SUB_ADMIN');
    const [issuedAtValue, signature, extra] = session.split('.');
    const issuedAt = Number(issuedAtValue);
    const now = Date.now();

    if (
        !user ||
        !pass ||
        !signature ||
        extra !== undefined ||
        !Number.isSafeInteger(issuedAt) ||
        issuedAt > now ||
        now - issuedAt > ADMIN_SESSION_MAX_AGE_SECONDS * 1000
    ) {
        return false;
    }

    const expectedSession = await getAdminSessionValue(user, pass, issuedAt);
    return constantTimeEqual(signature, expectedSession.split('.')[1]);
}

function constantTimeEqual(value, expected) {
    if (value.length !== expected.length) return false;

    let difference = 0;
    for (let index = 0; index < value.length; index++) {
        difference |= value.charCodeAt(index) ^ expected.charCodeAt(index);
    }
    return difference === 0;
}

function buildAdminCookie(value, url) {
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    return `CF_SUB_ADMIN=${encodeURIComponent(value)}; Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

async function handleAdminLogin(request, url, user, pass, siteLogo = '') {
    let inputUser = '';
    let inputPass = '';
    try {
        const form = await request.formData();
        inputUser = String(form.get('username') || '');
        inputPass = String(form.get('password') || '');
    } catch {
        return new Response(renderLoginPage(url, '登录请求格式不正确', siteLogo), { status: 400, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (inputUser === user && inputPass === pass) {
        const session = await getAdminSessionValue(user, pass, Date.now());
        return new Response('', { status: 302, headers: { 'Location': url.pathname, 'Set-Cookie': buildAdminCookie(session, url), 'Cache-Control': 'no-store' } });
    }
    return new Response(renderLoginPage(url, '用户名或密码错误', siteLogo), { status: 401, headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } });
}

// ==================== UI 样式与渲染模块 ====================
function getToolStyles() {
    return `
        * { box-sizing: border-box; }
        :root { --ui-primary-bg: #2f3338; --ui-primary-fg: #fff; --ui-primary-border: #343a40; --ui-primary-hover: #1f2327; --ui-secondary-bg: #fff; --ui-secondary-fg: #222; --ui-secondary-border: #c8c8c0; --ui-danger-bg: #dc3545; --ui-danger-fg: #fff; --ui-danger-border: #dc3545; --ui-link: #1f4b99; --ui-focus: #3b82f6; --ui-choice: #1677ff; }
        body { margin: 0; background: radial-gradient(circle at 0% 0%, rgba(222,246,235,.78), transparent 38%), linear-gradient(135deg, #f7faf8 0%, #eef7f2 52%, #e3f2e9 100%); color: #202124; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.5; min-height: 100vh; transition: background 0.3s, color 0.3s; background-attachment: fixed; }
        .page { width: 100%; max-width: 760px; margin: 0 auto; padding: 18px 14px 28px; }
        .page.app-shell { max-width: 1100px; margin: 24px auto 40px; padding: 0 28px 34px; border: 1px solid rgba(255,255,255,.72); border-radius: 28px; background: linear-gradient(135deg, rgba(255,255,255,.82) 0%, rgba(246,252,248,.76) 48%, rgba(225,244,233,.82) 100%); box-shadow: 0 18px 55px rgba(50,90,70,.10); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); overflow: hidden; }
        .header { margin-bottom: 14px; }
        .title { margin: 0; font-size: 28px; font-weight: 700; line-height: 1.2; color: #1a1a1a; transition: color 0.3s; }
        .subtitle { margin-top: 8px; color: #666; font-size: 13px; }
        .panel { background: rgba(255, 255, 255, 0.85); border: 1px solid rgba(229, 229, 223, 0.8); border-radius: 20px; padding: 16px; margin-top: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05); transition: background 0.3s, border-color 0.3s; }
        .section-title { margin: 0 0 10px; font-size: 15px; font-weight: 700; }
        .section-note { margin: 4px 0 10px; color: #888; font-size: 12px; }
        .link-list { display: grid; gap: 10px; }
        .link-item { border: 1px solid rgba(229, 229, 223, 0.6); border-radius: 12px; padding: 12px; background: rgba(255, 255, 255, 0.5); transition: background 0.3s, border-color 0.3s; }
        .link-label { font-weight: 600; margin-bottom: 8px; color: #1a1a1a; transition: color 0.3s; }
        .link-url { display: block; width: 100%; word-wrap: break-word; overflow-wrap: break-word; word-break: break-all; white-space: normal; padding: 10px; border: 1px solid rgba(229, 229, 223, 0.8); border-radius: 8px; background: rgba(250, 250, 250, 0.7); color: #1f4b99; text-decoration: none; transition: all 0.3s ease; }
        .link-url:hover { background: rgba(31, 75, 153, 0.05); border-color: #1f4b99; }
        .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
        button, .button { min-height: 36px; padding: 8px 16px; border: 1px solid var(--ui-primary-border); border-radius: 10px; background: var(--ui-primary-bg); color: var(--ui-primary-fg); font-size: 14px; cursor: pointer; font-weight: 600; transition: background-color .18s ease, color .18s ease, border-color .18s ease, box-shadow .18s ease, transform .18s ease; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; }
        button:hover, .button:hover { background: #1f2327; box-shadow: 0 4px 12px rgba(34, 34, 34, 0.15); }
        button.secondary, .button.secondary { background: var(--ui-secondary-bg); color: var(--ui-secondary-fg); border-color: var(--ui-secondary-border); }
        button.secondary:hover, .button.secondary:hover { background: #f1f3f5; }
        button.danger, .button.danger { background: var(--ui-danger-bg); color: var(--ui-danger-fg); border-color: var(--ui-danger-border); }
        button.danger:hover, .button.danger:hover { background: #c82333; box-shadow: 0 4px 12px rgba(220, 53, 69, 0.2); }
        button:disabled, .button:disabled { opacity: 0.65; cursor: default; transform: none; }
        button:not(:disabled), .button:not(:disabled) { transform-origin: center; }
        button:not(:disabled):hover, .button:not(:disabled):hover { transform: scale(1.025); }
        button:not(:disabled):active, .button:not(:disabled):active { transform: scale(.95); }
        .field { margin-top: 12px; }
        label { display: block; margin-bottom: 6px; font-weight: 600; color: #1a1a1a; transition: color 0.3s; }
        input, textarea, select { width: 100%; border: 1px solid rgba(207, 207, 200, 0.6); border-radius: 10px; background: rgba(255, 255, 255, 0.8); color: #202124; font-size: 14px; padding: 10px; transition: all 0.3s ease; word-wrap: break-word; word-break: break-all; white-space: pre-wrap; }
        input:focus, textarea:focus, select:focus { outline: none; border-color: #3b82f6; background: #fff; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }
        input, select { height: 42px; white-space: normal; }
        textarea { min-height: 200px; line-height: 1.5; resize: vertical; }
        .error { color: #b00020; margin-top: 10px; }
        .muted { color: #666; font-size: 13px; margin-left: 8px; transition: color 0.3s; }
        .toast { position: fixed; left: 50%; bottom: 15%; transform: translateX(-50%); display: none; min-width: 190px; max-width: calc(100vw - 40px); padding: 12px 18px; text-align: center; color: #fff; background: rgba(0, 0, 0, 0.82); border-radius: 12px; z-index: 9999; }
        .status-indicator { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 8px; font-weight: 600; width: 100%; word-break: break-all; transition: background 0.3s, color 0.3s, border-color 0.3s; }
        .status-ok { background: rgba(76, 175, 80, 0.1); color: #2e7d32; border: 1px solid rgba(76, 175, 80, 0.2); }
        .status-warn { background: rgba(255, 152, 0, 0.1); color: #f57c00; border: 1px solid rgba(255, 152, 0, 0.2); }
        .status-error { background: rgba(244, 67, 54, 0.1); color: #c62828; border: 1px solid rgba(244, 67, 54, 0.2); }
        #current-qrcode { display: none; margin-top: 12px; padding: 12px; border: 1px solid rgba(229, 229, 223, 0.6); border-radius: 12px; background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(10px); width: fit-content; max-width: 100%; }
        .hidden { display: none !important; }
        .modal-overlay { position: fixed; inset: 0; display: none; justify-content: center; align-items: center; padding: 20px; overflow-y: auto; overscroll-behavior: contain; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 1000; }
        .modal-content { width: min(480px, 100%); max-height: calc(100vh - 40px); overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; margin: auto; padding: 24px; border: 1px solid rgba(255, 255, 255, 0.5); border-radius: 20px; background: rgba(255, 255, 255, 0.95); box-shadow: 0 10px 40px rgba(0,0,0,0.2); transition: background 0.3s, border-color 0.3s; }
        @supports (height: 100dvh) { .modal-content { max-height: calc(100dvh - 40px); } }
        @media (prefers-color-scheme: dark) {
            body { background: radial-gradient(circle at 0% 28%, rgba(0,188,212,.12), transparent 24%), radial-gradient(circle at 100% 100%, rgba(0,120,70,.20), transparent 34%), linear-gradient(180deg,#000 0%,#020807 58%,#00140b 100%); background-attachment: fixed; color: #e0e0e0; }
            .page.app-shell { background: linear-gradient(135deg, rgba(1,5,6,.98) 0%, rgba(2,10,10,.96) 48%, rgba(0,54,35,.92) 100%); border-color: rgba(255,255,255,.13); box-shadow: 0 22px 75px rgba(0,0,0,.55); }
            .title { color: #f5f5f5; }
            .subtitle, .section-note, .muted { color: #aaa; }
            .panel { background: rgba(30, 30, 30, 0.75); border-color: rgba(255, 255, 255, 0.1); box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
            .link-item { background: rgba(40, 40, 40, 0.5); border-color: rgba(255, 255, 255, 0.1); }
            .link-label, label { color: #ddd; }
            .link-url { background: rgba(0, 0, 0, 0.3); color: #64b5f6; border-color: rgba(255,255,255,0.1); }
            .link-url:hover { background: rgba(100, 181, 246, 0.1); border-color: #64b5f6; }
            input, textarea, select { background: rgba(20, 20, 20, 0.8); color: #fff; border-color: rgba(255,255,255,0.2); }
            input:focus, textarea:focus, select:focus { background: #000; border-color: #3b82f6; }
            :root { --ui-primary-bg: #111827; --ui-primary-fg: #fff; --ui-primary-border: #4b5563; --ui-primary-hover: #525b67; --ui-secondary-bg: #303943; --ui-secondary-fg: #f3f4f6; --ui-secondary-border: #66717c; --ui-danger-bg: #b8323f; --ui-danger-fg: #fff; --ui-danger-border: #d24b58; --ui-link: #64b5f6; --ui-choice: #60a5fa; }
            button, .button { background: var(--ui-primary-bg); color: var(--ui-primary-fg); border-color: var(--ui-primary-border); box-shadow: 0 2px 8px rgba(0,0,0,0.28); }
            button:hover, .button:hover { background: #525b67; border-color: #858f9b; box-shadow: 0 4px 14px rgba(0,0,0,0.4); }
            button.secondary, .button.secondary { background: var(--ui-secondary-bg); color: var(--ui-secondary-fg); border-color: var(--ui-secondary-border); }
            button.secondary:hover, .button.secondary:hover { background: #46515d; border-color: #8c99a6; }
            button.danger, .button.danger { background: var(--ui-danger-bg); color: var(--ui-danger-fg); border-color: var(--ui-danger-border); }
            button.danger:hover { background: #d13e4d; border-color: #e16a75; }
            .save-button,.save-button.secondary,.save-button.edit-button { background:#2f3338!important; color:#fff!important; border-color:#343a40!important; }
            .save-button:hover,.save-button.secondary:hover,.save-button.edit-button:hover { background:#1f2327!important; color:#fff!important; border-color:#343a40!important; }
            .status-ok { background: rgba(129, 199, 132, 0.1); color: #81c784; border-color: rgba(129, 199, 132, 0.2); }
            .status-warn { background: rgba(255, 183, 77, 0.1); color: #ffb74d; border-color: rgba(255, 183, 77, 0.2); }
            .status-error { background: rgba(229, 115, 115, 0.1); color: #e57373; border-color: rgba(229, 115, 115, 0.2); }
            .modal-content { background: rgba(30, 30, 30, 0.95); border-color: rgba(255, 255, 255, 0.1); }
            #current-qrcode { background: rgba(255, 255, 255, 0.9); }
        }
    `;
}

function renderLoginPage(url, error = '', siteLogo = '') {
    return `<!DOCTYPE html>
<html>
<head>
<title>${escapeHTML(FileName)}管理面板</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${faviconTag(siteLogo, `${FileName}管理面板`)}
<style>
${getToolStyles()}
.login-btn { display: block; width: 100%; max-width: 280px; min-height: 44px; margin: 28px auto 6px; background: #2f3338; border: 1px solid #343a40; border-radius: 12px; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.3s ease; }
.login-btn:hover { background: #1f2327; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25); }
@media (prefers-color-scheme: dark) { .login-btn { background: #3f4650; border-color: #69717c; } .login-btn:hover { background: #525b67; border-color: #858f9b; } }
.error { text-align: center; margin-top: 15px; color: #c62828; }
</style>
</head>
<body style="display:flex; justify-content:center; align-items:center; min-height:100vh; margin:0;">
<main class="page" style="width:100%; max-width:420px; padding:20px; margin:0;">
<section class="panel" style="padding:30px 24px; text-align:center;">
<h1 class="title" style="margin-bottom:10px;">${escapeHTML(FileName)}</h1>
<div class="subtitle" style="margin-bottom:24px;">请登录管理员控制台</div>
<form method="POST" action="${escapeHTML(url.pathname)}" style="text-align:left;">
<div class="field"><label>用户名</label><input name="username" type="text" required autofocus></div>
<div class="field"><label>密码</label><input name="password" type="password" required></div>
<button type="submit" class="login-btn">登录</button>
${error ? `<div class="error">${escapeHTML(error)}</div>` : ''}
</form>
</section>
</main>
</body>
</html>`;
}

function getSubUIStyles() {
    return `${getToolStyles()}
        .page {
            width: 100%;
            max-width: 1240px;
            margin: 24px auto 40px;
            padding: 0 28px 34px;
            border: 1px solid rgba(255,255,255,.62);
            border-radius: 28px;
            background: rgba(255,255,255,.34);
            box-shadow: 0 14px 45px rgba(50,70,90,.08);
            overflow: hidden;
        }
        .app-shell { backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
        .header { margin: 0 -28px 18px; padding: 28px 28px 24px; border-bottom: 1px solid rgba(120,130,140,.18); }
        .home-hero { display: grid; grid-template-columns: minmax(0,1fr) minmax(360px,520px); gap: 28px; align-items: stretch; }
        .hero-main { display: flex; min-width: 0; min-height: 132px; height: 132px; flex-direction: column; align-items: flex-start; }
        .title { margin: 0; font-size: 52px; font-weight: 800; line-height: 1.08; letter-spacing: -1.5px; }
        .subtitle { margin-top: auto; padding-top: 12px; color: #687384; font-size: 14px; line-height: 1.5; word-break: keep-all; overflow-wrap: normal; hyphens: none; }
        .backend-version-card { display: flex; min-height: 132px; box-sizing: border-box; flex-direction: column; justify-content: center; padding: 28px 34px; border: 1px solid rgba(255,255,255,.62); border-radius: 28px; background: rgba(255,255,255,.58); box-shadow: 0 8px 30px rgba(50,70,90,.06); }
        .backend-version-label { margin-bottom: 10px; color: #69717d; font-size: 13.5px; line-height: 1.3; }
        .backend-version-value { color: #111; font-size: 19px; font-weight: 750; line-height: 1.25; word-break: break-word; overflow-wrap: anywhere; }
        .app-shell > .panel:first-of-type { margin-top: 0; }
        .panel { margin-top: 12px; }
        .row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
        .checks { display: grid; gap: 8px; }
        .check { display: grid; grid-template-columns: 18px minmax(0,1fr); align-items: center; gap: 8px; margin: 0; padding: 10px; border: 1px solid rgba(229,229,223,.6); border-radius: 10px; background: rgba(255,255,255,.5); cursor: pointer; }
        .check input { width: 18px; height: 18px; margin: 0; }
        .check span { font-weight: 600; }
        .check small { grid-column: 2; color: #888; font-size: 12px; word-break: break-all; overflow-wrap: anywhere; }
        .primary { width: 100%; min-height: 42px; margin-top: 12px; }
        .result-panel[hidden] { display: none; }
        .result-label { margin: 12px 0 6px; color: #666; font-size: 12px; font-weight: 600; }
        .result-url { padding: 10px; border: 1px solid rgba(229,229,223,.8); border-radius: 8px; background: rgba(250,250,250,.7); color: #1f4b99; word-break: break-all; overflow-wrap: anywhere; }
        @media (max-width: 900px) {
            .page { max-width: 760px; margin: 14px auto 28px; padding: 0 18px 28px; border-radius: 22px; }
            .header { margin: 0 -18px 16px; padding: 22px 18px 20px; }
            .home-hero { grid-template-columns: 1fr; gap: 18px; }
            .hero-main { min-height: auto; }
            .title { font-size: 40px; letter-spacing: -.9px; }
            .subtitle { margin-top: 14px; padding-top: 0; font-size: 11px; word-break: keep-all; overflow-wrap: normal; hyphens: none; }
            .backend-version-card { min-height: 108px; padding: 22px 24px; border-radius: 22px; }
            .backend-version-label { margin-bottom: 7px; font-size: 12.5px; }
            .backend-version-value { font-size: 16px; }
        }
        @media (max-width: 600px) {
            .aggregate-result-modal { width: calc(100vw - 40px); }
            .aggregate-result-modal > #copyDirect { width: 190px; }
            .row { grid-template-columns: 1fr; }
            .page.app-shell { width: calc(100% - 28px); margin-left: 14px; margin-right: 14px; }
        }
        @media (prefers-color-scheme: dark) {
            body { background: #000; background-image: radial-gradient(circle at 0% 28%,rgba(0,188,212,.18),transparent 24%),radial-gradient(circle at 100% 100%,rgba(0,120,70,.22),transparent 32%),linear-gradient(180deg,#000 0%,#020807 58%,#00140b 100%); background-attachment: fixed; color: #f4f7f8; }
            .page.app-shell { background: linear-gradient(135deg,rgba(1,5,6,.98) 0%,rgba(2,10,10,.96) 48%,rgba(0,54,35,.92) 100%); border-color: rgba(255,255,255,.13); box-shadow: 0 20px 70px rgba(0,0,0,.55); }
            .header { border-bottom-color: rgba(255,255,255,.10); }
            .title, .backend-version-value { color: #fff; }
            .subtitle { color: #9aa7b5; }
            .backend-version-card { background: linear-gradient(135deg,rgba(4,10,14,.98) 0%,rgba(3,18,20,.98) 48%,rgba(0,65,42,.94) 100%); border-color: rgba(255,255,255,.16); box-shadow: 0 12px 36px rgba(0,40,25,.28); }
            .backend-version-label, .section-note { color: #91a0ae; }
            .panel { background: rgba(8,12,14,.78); border-color: rgba(255,255,255,.10); }
            .field input, .field textarea, .native-picker, .current-api-input, .current-config-input, .current-config-link { background: rgba(2,6,8,.82); border-color: rgba(255,255,255,.13); color: #f3f6f7; }
            .native-picker option { background: #0b1012; color: #f3f6f7; }
            .check { background: rgba(15,22,24,.7); border-color: rgba(255,255,255,.10); }
            .check small { color: #8e9aa6; }
            .result-label { color: #aab4be; }
            .result-url { background: rgba(2,6,8,.72); color: #64b5f6; border-color: rgba(255,255,255,.12); }
        }
    `;
}



function getSubscriptionLinks(url, token) {
    const base = `${url.origin}/${token}`;
    return [
        ['自适应订阅地址', base],
        ['Base64订阅地址', `${base}?b64`],
        ['Clash订阅地址', `${base}?clash`],
        ['Sing-box订阅地址', `${base}?sb`],
        ['Surge订阅地址', `${base}?surge`],
        ['Loon订阅地址', `${base}?loon`],
    ];
}

function renderGuestPage(url, guest, guestName = '', siteLogo = '') {
    const links = getSubscriptionLinks(url, guest);
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(guestName ? `${guestName} 聚合订阅` : '聚合订阅')}</title>${faviconTag(siteLogo, guestName ? `${guestName} 聚合订阅` : '聚合订阅')}
<style>
${getSubUIStyles()}
.guest-shell{max-width:1100px;padding-top:0!important}.guest-header{margin:0 -28px 18px;padding:28px;border-bottom:1px solid rgba(120,130,140,.18)}
.guest-link-list{display:grid;gap:10px}.guest-link-item{position:relative;padding:12px;border:1px solid rgba(229,229,223,.6);border-radius:12px;background:rgba(255,255,255,.5)}
.guest-link-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:30px;margin-bottom:14px}.guest-link-label{font-weight:700;word-break:break-word;padding-right:90px}
.guest-link-url{display:block;width:100%;box-sizing:border-box;padding:10px 12px;margin-top:14px;border:1px solid rgba(229,229,223,.8);border-radius:9px;background:rgba(250,250,250,.7);color:#1f4b99;text-decoration:none;word-break:break-all;overflow-wrap:anywhere;transition:all .3s ease}.guest-link-url:hover{background:rgba(31,75,153,.05);border-color:#1f4b99}
.guest-actions{position:absolute;top:12px;right:12px;display:flex;gap:8px;align-items:center;justify-content:flex-end}.guest-actions button{margin:0}.guest-copy-btn,.guest-hide-btn{min-width:56px;width:auto;height:30px;min-height:30px;padding:0 10px;flex:0 0 auto}.guest-hide-btn{display:none}.guest-qrcode{display:none;background:#fff;border-radius:12px;padding:12px;margin:14px auto 0;width:max-content;max-width:100%;box-shadow:0 8px 24px rgba(0,0,0,.08)}
@media(max-width:640px){.guest-shell{width:calc(100% - 28px);margin:14px 14px 28px;padding:0 18px 24px;border-radius:22px}.guest-header{margin:0 -18px 16px;padding:22px 18px 20px}.guest-header .title{font-size:34px}}
@media(prefers-color-scheme:dark){.guest-link-item{background:rgba(8,12,14,.78);border-color:rgba(255,255,255,.10)}.guest-link-url{background:rgba(2,6,8,.82);border-color:rgba(255,255,255,.12);color:#64b5f6}.guest-link-url:hover{background:rgba(100,181,246,.1);border-color:#64b5f6}}
</style>
<script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js"></script>
</head>
<body>
<div id="copyNotice" class="toast"></div>
<main class="page app-shell guest-shell">
<header class="header guest-header"><h1 class="title" style="font-size:26px">聚合订阅链接</h1><div class="subtitle">复制订阅链接可同时生成二维码</div></header>
<div class="guest-link-list">
${links.map(([label,value])=>`<div class="guest-link-item"><div class="guest-link-head"><div class="guest-link-label">${escapeHTML(label)}</div></div><a class="guest-link-url" href="${escapeHTML(value)}" target="_blank" rel="noopener">${escapeHTML(value)}</a><div class="guest-actions"><button type="button" class="button guest-copy-btn" data-url="${escapeHTML(value)}" onclick="copyGuest(this)">复制</button><button type="button" class="button secondary guest-hide-btn" onclick="hideGuestQr(this)" style="display:none">隐藏二维码</button></div><div class="guest-qrcode"></div></div>`).join('')}
</div>
</main>
<script>
let guestToastTimer;
function guestToast(message){const el=document.getElementById('copyNotice');el.textContent=message;el.style.display='block';clearTimeout(guestToastTimer);guestToastTimer=setTimeout(()=>el.style.display='none',1500)}
function copyGuest(button){const value=button.dataset.url||'';const done=()=>{guestToast('已复制到剪贴板');showGuestQr(button)};if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(value).then(done).catch(()=>guestToast('复制失败，请手动复制'));else{const ta=document.createElement('textarea');ta.value=value;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');done()}catch(e){guestToast('复制失败，请手动复制')}ta.remove()}}
function showGuestQr(button){const item=button.closest('.guest-link-item');const qr=item&&item.querySelector('.guest-qrcode');const copy=item&&item.querySelector('.guest-copy-btn');const hide=item&&item.querySelector('.guest-hide-btn');if(!item||!qr)return;document.querySelectorAll('.guest-link-item').forEach(function(x){if(x===item)return;const q=x.querySelector('.guest-qrcode'),c=x.querySelector('.guest-copy-btn'),h=x.querySelector('.guest-hide-btn');if(q){q.style.display='none';q.innerHTML=''}if(c)c.style.display='inline-flex';if(h)h.style.display='none'});qr.innerHTML='';qr.style.display='block';if(copy)copy.style.display='none';if(hide)hide.style.display='inline-flex';if(window.QRCode)new QRCode(qr,{text:value=button.dataset.url,width:220,height:220,colorDark:'#000',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.Q})}
function hideGuestQr(button){const item=button.closest('.guest-link-item');if(!item)return;const q=item.querySelector('.guest-qrcode'),c=item.querySelector('.guest-copy-btn'),h=item.querySelector('.guest-hide-btn');if(q){q.style.display='none';q.innerHTML=''}if(c)c.style.display='inline-flex';if(h)h.style.display='none'}
</script></body></html>`;
}


/* =========================================================
 * CF-SUB 管理后台/* =========================================================
 * CF-SUB 管理后台
 * 保持 CF-SUB 核心视觉与管理逻辑
 * ======================================================= */

function renderAdminPage(url, subs, tokens, settings, status) {
    const origin = url.origin;

    const fakeStatusHtml =
        settings.fakeMode === '1'
            ? (settings.fakeUrl ? '✅ 当前使用: URL反向代理' : '❌ 无效: 未填写URL，自动拦截为原生NGINX')
            : settings.fakeMode === '2'
                ? (settings.fakeUrl302 ? '✅ 当前使用: URL重定向(302)' : '❌ 无效: 未填写目标地址，自动拦截为原生NGINX')
                : settings.fakeMode === '3'
                    ? (settings.fakeCode ? '✅ 当前使用: 自定义HTML' : '❌ 无效: 代码为空，自动拦截为原生NGINX')
                    : '✅ 当前使用: 默认防嗅探 (原生NGINX 强制覆盖模式)';

    const fakeStatusCss =
        settings.fakeMode === '1'
            ? (settings.fakeUrl ? 'status-ok' : 'status-error')
            : settings.fakeMode === '2'
                ? (settings.fakeUrl302 ? 'status-ok' : 'status-error')
                : settings.fakeMode === '3'
                    ? (settings.fakeCode ? 'status-ok' : 'status-error')
                    : 'status-ok';

    return `<!DOCTYPE html>
<html>
<head>
<title>${escapeHTML(settings.subName)}管理面板</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${faviconTag(settings.siteLogo, `${settings.subName}管理面板`)}
<style>
${getToolStyles()}
.url-path-control { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; align-items: center; }
.url-path-control input { grid-column: 1; grid-row: 1; min-width: 0; width: auto; }
.url-path-control .small-note { grid-column: 1 / -1; grid-row: 2; min-width: 0; margin: 0; }
.url-path-control .url-uuid-button { grid-column: 2; grid-row: 1; }
.admin-shell { max-width: 1100px; padding-top: 0 !important; }
.admin-header { margin: 0 -28px 18px; padding: 28px; border-bottom: 1px solid rgba(120,130,140,.18); }
.sub-grid { display: grid; gap: 10px; }
.sub-row { padding: 12px; border: 1px solid rgba(229,229,223,.6); border-radius: 12px; background: rgba(255,255,255,.5); color: inherit; transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
.sub-row:hover { transform: translateY(-1px); box-shadow: 0 7px 20px rgba(50,90,70,.08); }
.sub-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.sub-head-main { display: flex; min-width: 0; flex: 1; align-items: center; gap: 10px; }
.sub-head .actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0; }
.sub-name { color: inherit; font-size: 15px; font-weight: 700; word-break: break-word; }
.sub-count { margin-left: auto; color: #888; font-size: 12px; word-break: break-word; }
.source-box { max-height: 120px; margin-top: 9px; padding: 9px; overflow: auto; border-radius: 9px; background: rgba(250,250,250,.75); color: inherit; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
.token-url { margin-top: 10px; color: #1f4b99; word-break: break-all; }
.chip { display: inline-block; margin: 2px 3px 2px 0; padding: 3px 8px; border-radius: 8px; background: rgba(31,75,153,.08); color: #1f4b99; font-size: 12px; }
.check-list { display: grid; max-height: 230px; gap: 8px; overflow: auto; padding: 10px; border: 1px solid rgba(207,207,200,.6); border-radius: 10px; }
.check-item { display: flex; align-items: center; gap: 8px; margin: 0; font-weight: 400; cursor: grab; touch-action: none; user-select: none; }
.check-item input { width: 18px; height: 18px; }
.sortable-item { position: relative; cursor: grab; touch-action: none; user-select: none; }
.sortable-item .drag-handle { display: inline-flex; width: 22px; min-width: 22px; flex-shrink: 0; align-items: center; justify-content: center; color: #999; font-size: 18px; line-height: 1; cursor: grab; }
.sortable-item.dragging { transform: scale(.99); opacity: .55; box-shadow: 0 8px 22px rgba(0,0,0,.16); }
#url-sub-list .check-item { padding: 8px 10px; border: 1px solid rgba(207,207,200,.45); border-radius: 10px; background: rgba(250,250,250,.55); }
#url-sub-list .check-item.dragging { background: rgba(59,130,246,.08); }
.inline-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.small-note { margin-top: 6px; color: #888; font-size: 12px; }
.edit-button { min-height: 36px; padding: 8px 14px; background: #fff !important; color: #222 !important; border-color: #c8c8c0 !important; }
.edit-button:hover { background: #f1f3f5 !important; border-color: #bfc3c8 !important; }
.save-button, .save-button.secondary, .save-button.edit-button { background: var(--ui-primary-bg) !important; color: var(--ui-primary-fg) !important; border-color: var(--ui-primary-border) !important; }
.save-button:hover, .save-button.secondary:hover, .save-button.edit-button:hover { background: var(--ui-primary-hover) !important; color: #fff !important; border-color: var(--ui-primary-border) !important; }
.panel-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.panel-head .section-title { margin-bottom: 0; }
.config-value { margin-top: 10px; padding: 10px 12px; border: 1px solid rgba(229,229,223,.7); border-radius: 10px; background: rgba(250,250,250,.65); font-size: 13px; white-space: pre-wrap; word-break: break-all; }
@media (max-width: 600px) {
    .url-path-control input { grid-column: 1 / -1; grid-row: 1; }
    .url-path-control .small-note { grid-column: 1; grid-row: 2; }
    .url-path-control .url-uuid-button { grid-column: 2; grid-row: 2; align-self: center; }
    .inline-row { grid-template-columns: 1fr; }
    .page.app-shell.admin-shell { width: calc(100% - 28px); margin: 14px 14px 28px; padding: 0 14px 24px; border-radius: 22px; }
    .admin-header { margin: 0 -12px 14px; padding: 18px 12px 16px; }
    .admin-header > div:last-child { display: grid !important; width: 100%; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
    .admin-header > div:last-child > * { width: 100%; }
    .admin-shell > .panel { padding: 12px; }
    .sub-head { align-items: flex-start; }
    .sub-head-main { width: 100%; justify-content: space-between; gap: 8px; }
    .sub-head .actions { width: 100%; justify-content: flex-end; }
    .sub-head .actions button { min-width: 94px; flex: 1 1 auto; }
    .sub-row { padding: 10px; }
    .sub-count { margin-left: 0; }
}
@media (prefers-color-scheme: dark) {
    .admin-shell { background: linear-gradient(135deg,rgba(1,5,6,.98) 0%,rgba(2,10,10,.96) 48%,rgba(0,54,35,.92) 100%); }
    .sub-row { background: rgba(30,30,30,.82); border-color: rgba(255,255,255,.12); color: #eee; box-shadow: 0 2px 10px rgba(0,0,0,.18); }
    .sub-name, .check-item { color: #f3f3f3; }
    .sub-count { color: #aaa; }
    .source-box { background: rgba(10,10,10,.55); border: 1px solid rgba(255,255,255,.08); color: #ddd; }
    .token-url { color: #64b5f6; }
    .chip { background: rgba(100,181,246,.12); color: #90caf9; }
    .check-list { background: rgba(20,20,20,.65); border-color: rgba(255,255,255,.12); }
    #url-sub-list .check-item { background: rgba(10,10,10,.45); border-color: rgba(255,255,255,.08); }
    .sortable-item .drag-handle { color: #777; }
    .config-value { background: rgba(0,0,0,.22); border-color: rgba(255,255,255,.1); color: #ddd; }
    .edit-button { background: var(--ui-secondary-bg) !important; color: var(--ui-secondary-fg) !important; border-color: var(--ui-secondary-border) !important; }
    .edit-button:hover { background: #46515d !important; border-color: #8c99a6 !important; }
}
</style>
<script src="https://cdn.jsdelivr.net/npm/@keeex/qrcodejs-kx@1.0.2/qrcode.min.js"></script>
</head>
<body>

<div id="copyNotice" class="toast"></div>

<!-- SUB Modal -->
<div id="subsModal" class="modal-overlay">
<div class="modal-content">
<h2 class="section-title" style="font-size:20px;margin-bottom:20px;">📦 <span id="subsModalTitle">创建聚合节点</span></h2>
<div class="field">
<label>聚合节点名称</label>
<input id="sub-edit-name" type="text" placeholder="例如：Japan">
</div>
<div class="field">
<label>订阅地址 / 自建节点</label>
<textarea id="sub-edit-sources" style="min-height:220px" placeholder="一行一个订阅地址或节点"></textarea>
<div class="section-note">可以同时放订阅 URL 和自建节点。SUBS 本身不会生成公开订阅链接。</div>
</div>
<div class="actions" style="justify-content:flex-end;">
<button type="button" class="secondary" onclick="closeSubsModal()">取消</button>
<button type="button" class="save-button" onclick="saveSubs()">保存</button>
</div>
<span id="subSaveStatus" class="muted" style="display:block;text-align:right;margin-top:8px;"></span>
</div>
</div>

<!-- URL Modal -->
<div id="urlModal" class="modal-overlay">
<div class="modal-content">
<h2 class="section-title" style="font-size:20px;margin-bottom:20px;">🔗 <span id="urlModalTitle">创建订阅链接</span></h2>

<div class="field">
<label>链接名称</label>
<input id="url-edit-name" type="text" placeholder="例如：我的主订阅">
</div>

<div class="field">
<label>订阅链接路径</label>
<div class="url-path-control">
<input id="url-edit-value" type="text" placeholder="留空自动生成 UUID">
<div class="small-note" id="urlModeNote">留空自动生成 UUID；可直接输入自定义路径，或点击按钮反复生成。</div>
<button type="button" class="secondary url-uuid-button" onclick="generateUrlUUID()">随机UUID</button>
</div>
</div>

<div class="field">
<label>可使用的聚合节点</label>
<div id="url-sub-list" class="check-list"></div>
<div class="small-note">一个订阅链接可以选择多个 SUB；一个 SUB 也可以被多个订阅链接使用。</div>
</div>
<div class="field">
<label>推荐自动更新</label>
<label class="check-item"><input id="url-update-enable" type="checkbox" checked> 开启</label>
</div>
<div class="field">
<label>推荐更新时间（分钟）</label>
<input id="url-update" type="number" min="0" step="1" value="60" placeholder="例如：60">
<div class="section-note">关闭开关不会修改已保存的分钟数。</div>
</div>

<div class="actions" style="justify-content:flex-end;">
<button type="button" class="secondary" onclick="closeUrlModal()">取消</button>
<button type="button" class="save-button" onclick="saveUrl()">保存</button>
</div>
<span id="urlSaveStatus" class="muted" style="display:block;text-align:right;margin-top:8px;"></span>
</div>
</div>


<!-- SUBAPI 编辑 Modal -->
<div id="subApiModal" class="modal-overlay">
<div class="modal-content">
<h2 class="section-title" style="font-size:20px;margin-bottom:20px;">编辑 SUBAPI</h2>
<div class="field">
<label>订阅转换后端 SUBAPI</label>
<input id="config-subapi" type="text" value="${escapeHTML(settings.subApi || '')}" placeholder="[默认值]">
<div class="section-note">留空使用默认 SUBAPI。</div>
</div>
<div class="actions" style="justify-content:flex-end;">
<button type="button" class="secondary" onclick="closeSubApiModal()">取消</button>
<button type="button" class="save-button" onclick="saveConfig(this,'subapi')">保存</button>
</div>
<span id="subApiSaveStatus" class="muted" style="display:block;text-align:right;margin-top:8px;"></span>
</div>
</div>

<!-- SUBCONFIG 编辑 Modal -->
<div id="subConfigModal" class="modal-overlay">
<div class="modal-content">
<h2 class="section-title" style="font-size:20px;margin-bottom:20px;">编辑 SUBCONFIG</h2>
<div class="field">
<label>订阅转换规则 SUBCONFIG</label>
<textarea id="config-subconfig" style="min-height:150px" placeholder="[默认值]">${escapeHTML(settings.subConfig || '')}</textarea>
<div class="section-note">留空使用默认 SUBCONFIG。</div>
</div>
<div class="actions" style="justify-content:flex-end;">
<button type="button" class="secondary" onclick="closeSubConfigModal()">取消</button>
<button type="button" class="save-button" onclick="saveConfig(this,'subconfig')">保存</button>
</div>
<span id="subConfigSaveStatus" class="muted" style="display:block;text-align:right;margin-top:8px;"></span>
</div>
</div>

<!-- NOADS 编辑 Modal -->
<div id="noAdsModal" class="modal-overlay">
<div class="modal-content">
<h2 class="section-title" style="font-size:20px;margin-bottom:20px;">编辑 节点屏蔽（NOADS）</h2>
<div class="field">
<label>节点屏蔽关键字</label>
<textarea id="config-noads" style="min-height:150px" placeholder="示例: 加入TG群, 订阅YouTube频道, https://t.me ......">${escapeHTML(settings.noAds || '')}</textarea>
<div class="section-note">使用英文逗号、空格或换行分隔。</div>
</div>
<div class="actions" style="justify-content:flex-end;">
<button type="button" class="secondary" onclick="closeNoAdsModal()">取消</button>
<button type="button" class="save-button" onclick="saveConfig(this,'noads')">保存</button>
</div>
<span id="noAdsSaveStatus" class="muted" style="display:block;text-align:right;margin-top:8px;"></span>
</div>
</div>

<!-- 安全设置 Modal -->
<div id="securityModal" class="modal-overlay">
<div class="modal-content">
<h2 class="section-title" style="font-size:20px;margin-bottom:20px;">安全设置</h2>
<div class="field"><label>后台登录账号 (USER)</label><input id="sec-user" type="text" value="${escapeHTML(settings.user || '')}" placeholder="例如：admin"></div>
<div class="field"><label>后台登录密码 (PASS)</label><input id="sec-pass" type="password" value="" placeholder="留空则不修改当前密码"></div>
<div class="field"><label>确认登录密码</label><input id="sec-pass2" type="password" value="" placeholder="留空则不修改当前密码"></div>
<div class="actions" style="margin-top:24px;justify-content:flex-end;">
<button type="button" class="secondary" onclick="closeSecurityModal()">取消</button>
<button type="button" class="save-button" onclick="saveConfig(this,'sec')">保存修改</button>
</div>
<span id="secSaveStatus" class="muted" style="display:block;text-align:right;margin-top:8px;"></span>
</div>
</div>

<!-- 站点设置 Modal -->
<div id="fakeModal" class="modal-overlay">
<div class="modal-content">
<h2 class="section-title" style="font-size:20px;margin-bottom:20px;">站点设置</h2>
<div id="fake-mode-status" class="status-indicator ${fakeStatusCss}" style="margin-bottom:16px;">${fakeStatusHtml}</div>
<div class="field">
<label>主页模式</label>
<select id="fake-mode" onchange="switchFakeMode()">
<option value="" ${!settings.fakeMode ? 'selected' : ''}>[关闭] 强制原生 NGINX</option>
<option value="1" ${settings.fakeMode === '1' ? 'selected' : ''}>[URL] 网页反向代理</option>
<option value="2" ${settings.fakeMode === '2' ? 'selected' : ''}>[URL302] 强制重定向</option>
<option value="3" ${settings.fakeMode === '3' ? 'selected' : ''}>[HTML] 自定义代码</option>
</select>
</div>
<div class="field hidden" id="fake-group-url">
<label>反代目标地址 (URL)</label>
<input id="fake-url" type="text" value="${escapeHTML(settings.fakeUrl || '')}" placeholder="例如: https://www.bing.com">
</div>
<div class="field hidden" id="fake-group-url302">
<label>重定向地址 (URL302)</label>
<input id="fake-url302" type="text" value="${escapeHTML(settings.fakeUrl302 || '')}" placeholder="例如: https://github.com">
</div>
<div class="field hidden" id="fake-group-code">
<label>自定义 HTML 代码 (CODE)</label>
<textarea id="fake-code" style="min-height:180px" placeholder="在此粘贴网页 HTML 代码...">${escapeHTML(settings.fakeCode || '')}</textarea>
</div>
<div class="field">
<label>标签页 Logo URL</label>
<input id="site-logo" type="url" value="${escapeHTML(settings.siteLogo || '')}" placeholder="https://example.com/favicon.png">
<div class="section-note">填写可访问的 HTTP 或 HTTPS 图标地址，用于全站标签页。</div>
</div>
<div class="field">
<label>管理员后台路径</label>
<input id="site-admin-path" type="text" value="${escapeHTML(normalizeAdminPath(settings.adminPath) || DEFAULT_ADMIN_PATH)}" placeholder="例如：admin 或 manage">
<div class="section-note">只填写路径单词，不需要填写 /。修改后会立即退出后台并返回主页；例如改成 apple 后，使用 /apple 进入后台。</div>
</div>
<div class="actions" style="margin-top:24px;justify-content:flex-end;">
<button type="button" class="secondary" onclick="closeFakeModal()">取消</button>
<button type="button" class="save-button" onclick="saveConfig(this,'fake')">保存修改</button>
</div>
<span id="fakeSaveStatus" class="muted" style="display:block;text-align:right;margin-top:8px;"></span>
</div>
</div>

<main class="page app-shell admin-shell">
<header class="header admin-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;">
<div>
<h1 id="admin-page-title" class="title">${escapeHTML(settings.subName)}管理面板</h1>
</div>
<div style="display:flex;gap:8px;flex-wrap:wrap;">
<button type="button" class="secondary" onclick="openSecurityModal()">安全</button>
<button type="button" class="secondary" onclick="openFakeModal()">站点</button>
<a class="button danger" href="/${escapeHTML(normalizeAdminPath(settings.adminPath) || DEFAULT_ADMIN_PATH)}/logout">退出</a>
</div>
</header>

<section class="panel">
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
<div>
<h2 class="section-title">全局名称设置 (SUBNAME)</h2>
<div class="section-note">设置订阅名称，将显示在生成的订阅信息中。</div>
</div>
<button type="button" class="save-button" onclick="saveConfig(this,'subname')">保存</button>
</div>
<div class="field" style="margin-top:12px;"><input id="config-subname" type="text" value="${escapeHTML(settings.subName)}" placeholder="例如：CF-SUBS"></div>
<span id="configSaveStatus" class="muted" style="display:block;text-align:right;margin-top:8px;"></span>
</section>

<section class="panel">
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
<div>
<h2 class="section-title">聚合节点 (SUB)</h2>
<div class="section-note">SUB 是聚合节点配置，不是订阅链接。默认为空，可创建多个且名称不能重复。</div>
</div>
<button type="button" onclick="openSubCreate()">＋ 创建聚合节点</button>
</div>

<div id="sub-list" class="sub-grid" style="margin-top:12px;">
${subs.length ? subs.map(s => `
<div class="sub-row sortable-item" data-sort-id="${escapeHTML(s.id)}">
<div class="sub-head">
<span class="drag-handle" aria-hidden="true">⋮⋮</span>
<div class="sub-head-main">
<div class="sub-name">${escapeHTML(s.name)}</div>
<div class="sub-count">${s.sources?.length || 0} 个来源</div>
</div>
<div class="actions" style="margin-top:0;">
<button type="button" class="edit-button" onclick="editSub('${escapeHTML(s.id)}')">编辑</button>
<button type="button" class="danger" onclick="deleteSub('${escapeHTML(s.id)}')">删除</button>
</div>
</div>
</div>
`).join('') : `<div class="empty">暂无聚合节点。SUB 默认就是空的，请点击“创建聚合节点”。</div>`}
</div>
</section>

<section class="panel">
<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
<div>
<h2 class="section-title">订阅链接 (URL)</h2>
<div class="section-note">创建订阅链接才会生成公开订阅入口。URL 可以绑定一个或多个 SUB。</div>
</div>
<button type="button" onclick="openUrlCreate()">＋ 创建订阅链接</button>
</div>

<div id="url-list" class="sub-grid" style="margin-top:12px;">
${tokens.length ? tokens.map(t => {
    const tokenUrl = `${origin}/${encodeURIComponent(t.url)}`;
    const subNames = (t.subs || []).map(id => {
        const s = subs.find(x => x.id === id);
        return s ? s.name : '已删除';
    });

    return `
<div class="sub-row">
<div class="sub-head">
<div style="min-width:0;">
<div class="sub-name">${escapeHTML(t.name)}</div>
<div class="sub-count">URL：${escapeHTML(t.url)}</div>
</div>
<div class="actions" style="margin-top:0;">
<button type="button" onclick="copyValue('${escapeHTML(tokenUrl)}')">复制</button>
<button type="button" class="edit-button" onclick="editUrl('${escapeHTML(t.url)}')">编辑</button>
<button type="button" class="danger" onclick="deleteUrl('${escapeHTML(t.url)}')">删除</button>
</div>
</div>
<a class="link-url token-url" href="${escapeHTML(tokenUrl)}" target="_blank">${escapeHTML(tokenUrl)}</a>
<div style="margin-top:8px;">
${subNames.length ? subNames.map(x => `<span class="chip">${escapeHTML(x)}</span>`).join('') : '<span class="small-note">未绑定聚合节点</span>'}
</div>
</div>`;
}).join('') : `<div class="empty">暂无订阅链接。创建订阅链接后才会产生公开订阅地址。</div>`}
</div>
</section>

<section class="panel">
<div class="panel-head">
<div>
<h2 class="section-title">订阅转换后端 SUBAPI</h2>
<div class="section-note">当前订阅转换后端</div>
</div>
<button type="button" class="edit-button" onclick="openSubApiModal()">编辑</button>
</div>
<div id="subapi-status" class="status-indicator ${status.adminApiCss}" style="margin-top:10px;">${status.adminApiHtml}</div>
<a id="subapi-url" class="link-url" href="${escapeHTML(status.finalApiUrl)}" target="_blank">${escapeHTML(status.finalApiUrl)}</a>
</section>

<section class="panel">
<div class="panel-head">
<div>
<h2 class="section-title">订阅转换规则 SUBCONFIG</h2>
<div class="section-note">当前订阅转换规则</div>
</div>
<button type="button" class="edit-button" onclick="openSubConfigModal()">编辑</button>
</div>
<div id="subconfig-status" class="status-indicator ${status.adminConfigCss}" style="margin-top:10px;">${status.adminConfigHtml}</div>
<a id="subconfig-url" class="link-url" href="${escapeHTML(status.finalConfigUrl)}" target="_blank">${escapeHTML(status.finalConfigUrl)}</a>
</section>

<section class="panel">
<div class="panel-head">
<div>
<h2 class="section-title">节点屏蔽 (NOADS)</h2>
<div class="section-note">按关键字屏蔽不需要的节点</div>
</div>
<button type="button" class="edit-button" onclick="openNoAdsModal()">编辑</button>
</div>
<div id="noads-config-value" class="config-value">${escapeHTML(settings.noAds || '未设置')}</div>
</section>

<section class="panel" style="display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:12px;margin-bottom:28px;">
<div style="min-width:0;">
<h2 class="section-title" style="margin:0;">备份与迁移</h2>
<div class="section-note">备份与恢复当前 KV 中保存的配置、订阅和链接数据，适用于迁移和恢复。</div>
</div>
<a class="button secondary" href="/${escapeHTML(normalizeAdminPath(settings.adminPath) || DEFAULT_ADMIN_PATH)}/JSON">进入</a>
</section>

<div id="current-qrcode"></div>
</main>

<script>
const SUBS = ${serializeInlineJson(subs)};
const TOKENS = ${serializeInlineJson(tokens)};
let editingSub = '';
let editingUrlValue = '';

const AdminUI = (function(){
 const openModals=new Set();
 let bodyStyles=null;
 let scrollX=0;
 let scrollY=0;

 function resolveModal(target){
   return typeof target==='string'?document.getElementById(target):target;
 }

 function lockPageScroll(){
   if(bodyStyles)return;
   const body=document.body;
   scrollX=window.scrollX;
   scrollY=window.scrollY;
   bodyStyles={
     position:body.style.position,
     top:body.style.top,
     left:body.style.left,
     width:body.style.width,
     overflow:body.style.overflow
   };
   body.style.position='fixed';
   body.style.top=(-scrollY)+'px';
   body.style.left=(-scrollX)+'px';
   body.style.width='100%';
   body.style.overflow='hidden';
 }

 function unlockPageScroll(){
   if(!bodyStyles)return;
   const body=document.body;
   body.style.position=bodyStyles.position;
   body.style.top=bodyStyles.top;
   body.style.left=bodyStyles.left;
   body.style.width=bodyStyles.width;
   body.style.overflow=bodyStyles.overflow;
   window.scrollTo(scrollX,scrollY);
   bodyStyles=null;
 }

 function openModal(target){
   const modal=resolveModal(target);
   if(!modal)return;
   if(!openModals.has(modal)){
     if(!openModals.size)lockPageScroll();
     openModals.add(modal);
   }
   modal.style.display='flex';
   modal.setAttribute('aria-hidden','false');
 }

 function closeModal(target){
   const modal=resolveModal(target);
   if(!modal)return;
   modal.style.display='none';
   modal.setAttribute('aria-hidden','true');
   openModals.delete(modal);
   if(!openModals.size)unlockPageScroll();
 }

 function setButtonBusy(button,busy,label){
   if(!button)return;
   if(busy){
     if(!Object.prototype.hasOwnProperty.call(button.dataset,'idleText'))button.dataset.idleText=button.textContent||'';
     button.disabled=true;
     if(label)button.textContent=label;
     return;
   }
   button.disabled=false;
   if(Object.prototype.hasOwnProperty.call(button.dataset,'idleText')){
     button.textContent=button.dataset.idleText;
     delete button.dataset.idleText;
   }
 }

 function toast(message){
   const el=document.getElementById('copyNotice');
   if(!el)return;
   el.textContent=message;
   el.style.display='block';
   clearTimeout(window.__toast);
   window.__toast=setTimeout(()=>el.style.display='none',1500);
 }

 document.addEventListener('keydown',function(event){
   if(event.key!=='Escape'||!openModals.size)return;
   event.preventDefault();
   const modals=Array.from(openModals);
   closeModal(modals[modals.length-1]);
 });

 return {openModal,closeModal,setButtonBusy,toast};
})();

function reorderSubListFromDOM(){
 const box=document.getElementById('sub-list');
 if(!box)return;
 const orderedIds=[...box.querySelectorAll('.sortable-item')].map(function(item){return item.dataset.sortId;}).filter(Boolean);
 if(!orderedIds.length || orderedIds.length!==SUBS.length)return;
 const orderMap=new Map(orderedIds.map((id,index)=>[String(id),index]));
 SUBS.sort(function(a,b){
   const left=orderMap.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER;
   const right=orderMap.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER;
   return left-right;
 });
 fetch(window.location.pathname,{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({type:'sub_reorder',ids:orderedIds})
 }).then(async function(res){
   const text=await res.text();
   if(!res.ok)throw new Error(text||'排序失败');
   showToast('聚合节点排序已更新');
 }).catch(function(error){
   showToast(error.message||'排序失败');
   renderSubList();
 });
}

function renderSubList(){
 const box=document.getElementById('sub-list');
 if(!box)return;
 if(!SUBS.length){
   box.innerHTML='<div class="empty">暂无聚合节点。SUB 默认就是空的，请点击“创建聚合节点”。</div>';
   return;
 }
 box.innerHTML=SUBS.map(function(s){
   const name=escapeJS(s.name||'');
   const id=escapeJS(s.id||'');
   const count=s.sources?.length||0;
   return '<div class="sub-row sortable-item" data-sort-id="'+id+'">'
    +'<div class="sub-head">'
    +'<span class="drag-handle" aria-hidden="true">⋮⋮</span>'
    +'<div class="sub-head-main">'
    +'<div class="sub-name">'+name+'</div>'
    +'<div class="sub-count">'+count+' 个来源</div>'
    +'</div>'
    +'<div class="actions" style="margin-top:0;">'
    +'<button type="button" class="edit-button" onclick="editSub(\\''+id+'\\')">编辑</button>'
    +'<button type="button" class="danger" onclick="deleteSub(\\''+id+'\\')">删除</button>'
    +'</div>'
    +'</div>'
    +'</div>';
 }).join('');
 enableLongPressSort(box,'.sortable-item',reorderSubListFromDOM);
}
function renderUrlList(){
 const box=document.getElementById('url-list');
 if(!box)return;
 const origin=window.location.origin;
 if(!TOKENS.length){
   box.innerHTML='<div class="empty">暂无订阅链接。创建订阅链接后才会产生公开订阅地址。</div>';
   return;
 }
 box.innerHTML=TOKENS.map(function(t){
   const tokenUrl=origin+'/'+encodeURIComponent(t.url||'');
   const name=escapeJS(t.name||'');
   const path=escapeJS(t.url||'');
   const safeUrl=escapeJS(tokenUrl);
   const subNames=(t.subs||[]).map(function(id){
     const sub=SUBS.find(function(x){return x.id===id;});
     return sub?sub.name:'已删除';
   });
   const chips=subNames.length
     ? subNames.map(function(x){return '<span class="chip">'+escapeJS(x)+'</span>';}).join('')
     : '<span class="small-note">未绑定聚合节点</span>';
   return '<div class="sub-row">'
    +'<div class="sub-head">'
    +'<div style="min-width:0;">'
    +'<div class="sub-name">'+name+'</div>'
    +'<div class="sub-count">URL：'+path+'</div>'
    +'</div>'
    +'<div class="actions" style="margin-top:0;">'
    +'<button type="button" onclick="copyValue(\\\''+safeUrl+'\\\')">复制</button>'
    +'<button type="button" class="edit-button" onclick="editUrl(\\\''+path+'\\\')">编辑</button>'
    +'<button type="button" class="danger" onclick="deleteUrl(\\\''+path+'\\\')">删除</button>'
    +'</div>'
    +'</div>'
    +'<a class="link-url token-url" href="'+safeUrl+'" target="_blank">'+safeUrl+'</a>'
    +'<div style="margin-top:8px;">'+chips+'</div>'
    +'</div>';
 }).join('');
}

function refreshSubscriptionUI(){
 renderSubList();
 renderUrlList();
}

function showToast(message){
 AdminUI.toast(message);
}

function copyValue(value){
 navigator.clipboard.writeText(value).then(()=>showToast('已复制到剪贴板')).catch(()=>showToast('复制失败，请手动复制'));
}

function openSubApiModal(){AdminUI.openModal('subApiModal')}
function closeSubApiModal(){AdminUI.closeModal('subApiModal')}
function openSubConfigModal(){AdminUI.openModal('subConfigModal')}
function closeSubConfigModal(){AdminUI.closeModal('subConfigModal')}
function openNoAdsModal(){AdminUI.openModal('noAdsModal')}
function closeNoAdsModal(){AdminUI.closeModal('noAdsModal')}

function openSecurityModal(){AdminUI.openModal('securityModal')}
function closeSecurityModal(){AdminUI.closeModal('securityModal')}
function openFakeModal(){AdminUI.openModal('fakeModal')}
function closeFakeModal(){AdminUI.closeModal('fakeModal')}

function switchFakeMode(){
 const mode=document.getElementById('fake-mode').value;
 ['fake-group-url','fake-group-url302','fake-group-code'].forEach(id=>document.getElementById(id).classList.add('hidden'));
 if(mode==='1')document.getElementById('fake-group-url').classList.remove('hidden');
 if(mode==='2')document.getElementById('fake-group-url302').classList.remove('hidden');
 if(mode==='3')document.getElementById('fake-group-code').classList.remove('hidden');
}

function updateAdminTitle(value){
 const name=(value||'').trim()||'CF-SUBS';
 document.title=name+'管理面板';
 const title=document.getElementById('admin-page-title');
 if(title)title.textContent=name+'管理面板';
 const logo=(document.getElementById('site-logo')?.value||'').trim();
 let iconUrl='';
 try{
   const parsed=new URL(logo,window.location.href);
   if(parsed.protocol==='http:'||parsed.protocol==='https:')iconUrl=parsed.href;
 }catch(error){}
 const icons=document.querySelectorAll('link[rel~="icon"]');
 icons.forEach(icon=>icon.remove());
 const icon=document.createElement('link');
 icon.rel='icon';
 if(iconUrl){
   icon.href=iconUrl;
 }else{
   const initial=Array.from(name+'管理面板')[0]||'?';
   const safeInitial=initial.replace(/[&<>]/g,function(character){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[character]});
   const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1677ff"/><text x="32" y="45" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="40" font-weight="700" fill="#fff">'+safeInitial+'</text></svg>';
   icon.type='image/svg+xml';
   icon.href='data:image/svg+xml,'+encodeURIComponent(svg);
 }
 document.head.appendChild(icon);
}

function updateFakeModeStatus(){
 const status=document.getElementById('fake-mode-status');
 if(!status)return;
 const mode=document.getElementById('fake-mode')?.value||'';
 const valid=mode==='1'
   ? Boolean((document.getElementById('fake-url')?.value||'').trim())
   : mode==='2'
     ? Boolean((document.getElementById('fake-url302')?.value||'').trim())
     : mode==='3'
       ? Boolean((document.getElementById('fake-code')?.value||'').trim())
       : true;
 const message=mode==='1'
   ? (valid?'✅ 当前使用: URL反向代理':'❌ 无效: 未填写URL，自动拦截为原生NGINX')
   : mode==='2'
     ? (valid?'✅ 当前使用: URL重定向(302)':'❌ 无效: 未填写目标地址，自动拦截为原生NGINX')
     : mode==='3'
       ? (valid?'✅ 当前使用: 自定义HTML':'❌ 无效: 代码为空，自动拦截为原生NGINX')
       : '✅ 当前使用: 默认防嗅探 (原生NGINX 强制覆盖模式)';
 status.className='status-indicator '+(valid?'status-ok':'status-error');
 status.textContent=message;
}

async function saveConfig(button,type){
 const isSec=type==='sec';
 const isFake=type==='fake';
 const statusId=isSec?'secSaveStatus':(isFake?'fakeSaveStatus':(type==='subapi'?'subApiSaveStatus':(type==='subconfig'?'subConfigSaveStatus':(type==='noads'?'noAdsSaveStatus':'configSaveStatus'))));
 const statusElem=document.getElementById(statusId);

 const secPass=document.getElementById('sec-pass')?.value||'';
 const secPass2=document.getElementById('sec-pass2')?.value||'';
 const siteAdminPath=(document.getElementById('site-admin-path')?.value||'admin').trim().replace(/^\\/+|\\/+$/g,'')||'admin';
 const currentAdminPath=window.location.pathname.replace(/^\\/+|\\/+$/g,'');
 const adminPathChanged=(isSec||isFake) && siteAdminPath!==currentAdminPath;

 if(isSec && secPass!==secPass2){
   alert('两次输入的密码不一致！');
   return;
 }

 AdminUI.setButtonBusy(button,true,'保存中...');

 try{
   const response=await fetch(window.location.pathname,{
     method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({
     type:'config',
     settings:{
       user:document.getElementById('sec-user')?.value||'',
       pass:secPass,
       subName:document.getElementById('config-subname')?.value||'',
       subApi:document.getElementById('config-subapi')?.value||'',
       subConfig:document.getElementById('config-subconfig')?.value||'',
       noAds:document.getElementById('config-noads')?.value||'',
       fakeMode:document.getElementById('fake-mode')?.value||'',
       fakeUrl:document.getElementById('fake-url')?.value||'',
       fakeUrl302:document.getElementById('fake-url302')?.value||'',
       fakeCode:document.getElementById('fake-code')?.value||'',
    siteLogo:document.getElementById('site-logo')?.value.trim()||'',
       adminPath:siteAdminPath
     }
     })
   });
   if(!response.ok)throw new Error(await response.text());
   const data=await response.json().catch(()=>({}));
   statusElem.textContent='已保存 '+new Date().toLocaleString();
   statusElem.style.color='#2e7d32';
   if(type==='subapi')closeSubApiModal();
   if(type==='subconfig')closeSubConfigModal();
   if(type==='noads')closeNoAdsModal();
   if(type==='subapi'||type==='subconfig')await refreshBackendStatus();
   if(type==='subname'||isFake){
     updateAdminTitle(document.getElementById('config-subname')?.value||'');
   }
   if(type==='noads'){
     const value=document.getElementById('noads-config-value');
     if(value)value.textContent=(document.getElementById('config-noads')?.value||'').trim()||'未设置';
   }
   if(isFake)updateFakeModeStatus();
   if(adminPathChanged && data.adminPath){
     setTimeout(()=>window.location.replace('/'+encodeURIComponent(data.adminPath)),300);
   }else if(data.credentialsChanged){
     setTimeout(()=>window.location.replace(window.location.pathname),300);
   }
 }catch(err){
   statusElem.textContent='保存失败: '+err.message;
   statusElem.style.color='#c62828';
 }finally{
   AdminUI.setButtonBusy(button,false);
 }
}

function openSubCreate(){
 editingSub='';
 document.getElementById('subsModalTitle').textContent='创建聚合节点';
 document.getElementById('sub-edit-name').value='';
 document.getElementById('sub-edit-sources').value='';
 document.getElementById('subSaveStatus').textContent='';
 AdminUI.openModal('subsModal');
}

function closeSubsModal(){AdminUI.closeModal('subsModal')}

function editSub(id){
 const item=SUBS.find(x=>x.id===id);
 if(!item)return;
 editingSub=id;
 document.getElementById('subsModalTitle').textContent='编辑聚合节点';
 document.getElementById('sub-edit-name').value=item.name||'';
 document.getElementById('sub-edit-sources').value=(item.sources||[]).join('\\n');
 document.getElementById('subSaveStatus').textContent='';
 AdminUI.openModal('subsModal');
}

async function saveSubs(){
 const button=document.querySelector('#subsModal button:not(.secondary)');
 const status=document.getElementById('subSaveStatus');
 const oldId=editingSub;
 const payload={
   type:oldId?'sub_update':'sub_create',
   id:oldId,
   name:document.getElementById('sub-edit-name').value.trim(),
   sources:document.getElementById('sub-edit-sources').value,
   enabled:true
 };

 AdminUI.setButtonBusy(button,true,'保存中...');
 status.textContent='正在保存...';
 try{
   const res=await fetch(window.location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const text=await res.text();
   if(!res.ok)throw new Error(text||'保存失败');
   const data=JSON.parse(text);
   if(!data.sub)throw new Error('服务器未返回聚合节点数据');

   if(oldId){
     const index=SUBS.findIndex(x=>x.id===oldId);
     if(index!==-1)SUBS[index]=data.sub; else SUBS.push(data.sub);
   }else{
     SUBS.push(data.sub);
   }

   refreshSubscriptionUI();
   status.textContent='保存成功';
   showToast(oldId?'聚合节点已更新':'聚合节点已创建');
   closeSubsModal();
 }catch(err){
   status.textContent=err.message||'保存失败';
   showToast(err.message||'保存失败');
 }finally{
   AdminUI.setButtonBusy(button,false);
 }
}

async function deleteSub(id){
 const item=SUBS.find(x=>x.id===id);
 if(!item)return;
 if(!confirm('确定删除“'+item.name+'”吗？\\n已经绑定它的 URL 会自动解除绑定。'))return;

 const res=await fetch(window.location.pathname,{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({type:'sub_delete',id})
 });
 const text=await res.text();

 if(!res.ok){showToast(text||'删除失败');return}
 const index=SUBS.findIndex(x=>x.id===id);
 if(index!==-1)SUBS.splice(index,1);
 TOKENS.forEach(t=>{t.subs=Array.isArray(t.subs)?t.subs.filter(x=>x!==id):[];});
 refreshSubscriptionUI();
 showToast('聚合节点已删除');
}

function enableLongPressSort(container, itemSelector, onChange){
 if(!container)return;
 const items=()=>Array.from(container.querySelectorAll(itemSelector));
 let dragging=null;
 let timer=null;
 let touchStartY=0;
 let changed=false;

 function clearTimer(){
   if(timer){clearTimeout(timer);timer=null;}
 }

 function isInteractive(target){
   return !!target.closest('button,input,select,textarea,a');
 }

 function finishTouch(){
   clearTimer();
   if(!dragging)return;
   dragging.classList.remove('dragging');
   dragging=null;
   if(changed && typeof onChange==='function')onChange();
   changed=false;
 }

 items().forEach(item=>{
   item.draggable=true;

   item.addEventListener('dragstart',function(e){
     dragging=item;
     changed=false;
     item.classList.add('dragging');
     if(e.dataTransfer){
       e.dataTransfer.effectAllowed='move';
       e.dataTransfer.setData('text/plain',item.dataset.sortId||'');
     }
   });

   item.addEventListener('dragover',function(e){
     if(!dragging || dragging===item)return;
     e.preventDefault();
     const rect=item.getBoundingClientRect();
     const before=e.clientY < rect.top + rect.height/2;
     if(before){
       if(item.previousElementSibling!==dragging)container.insertBefore(dragging,item);
     }else{
       if(item.nextElementSibling!==dragging)container.insertBefore(dragging,item.nextElementSibling);
     }
     changed=true;
   });

   item.addEventListener('dragend',function(){
     if(!dragging)return;
     dragging.classList.remove('dragging');
     dragging=null;
     if(changed && typeof onChange==='function')onChange();
     changed=false;
   });

   item.addEventListener('touchstart',function(e){
     if(isInteractive(e.target))return;
     const touch=e.touches[0];
     if(!touch)return;
     touchStartY=touch.clientY;
     clearTimer();
     timer=setTimeout(function(){
       dragging=item;
       item.classList.add('dragging');
     },420);
   },{passive:true});

   item.addEventListener('touchmove',function(e){
     const touch=e.touches[0];
     if(!touch)return;
     if(!dragging){
       if(Math.abs(touch.clientY-touchStartY)>10)clearTimer();
       return;
     }
     e.preventDefault();
     const y=touch.clientY;
     let target=null;
     for(const other of items()){
       if(other===dragging)continue;
       const rect=other.getBoundingClientRect();
       if(y < rect.top + rect.height/2){
         target=other;
         break;
       }
     }
     if(target){
       if(target!==dragging.nextElementSibling){
         container.insertBefore(dragging,target);
         changed=true;
       }
     }else if(container.lastElementChild!==dragging){
       container.appendChild(dragging);
       changed=true;
     }
   },{passive:false});

   item.addEventListener('touchend',finishTouch,{passive:true});
   item.addEventListener('touchcancel',finishTouch,{passive:true});
 });
}

function renderUrlSubs(selected){
 const box=document.getElementById('url-sub-list');
 if(!SUBS.length){
   box.innerHTML='<div class="small-note">暂无 SUB，请先创建聚合节点。</div>';
   return;
 }
 const selectedSet=new Set((selected||[]).map(String));
 const ordered=SUBS.filter(s=>selectedSet.has(String(s.id)))
   .concat(SUBS.filter(s=>!selectedSet.has(String(s.id))));
 box.innerHTML=ordered.map(function(s){
   const id=escapeJS(s.id||'');
   const checked=selectedSet.has(String(s.id))?' checked':'';
   return '<label class="check-item sortable-item" data-sort-id="'+id+'">'
    +'<span class="drag-handle" aria-hidden="true">⠿</span>'
    +'<input type="checkbox" value="'+id+'"'+checked+'>'
    +'<span>'+escapeJS(s.name||'')+'</span>'
    +'</label>';
 }).join('');
 enableLongPressSort(box,'.check-item');
}
function escapeJS(value){
 return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function openUrlCreate(){
 editingUrlValue='';
 document.getElementById('urlModalTitle').textContent='创建订阅链接';
 document.getElementById('url-edit-name').value='';
 document.getElementById('url-edit-value').value='';
 document.getElementById('url-edit-value').disabled=false;
 document.getElementById('url-update-enable').checked=true;
 document.getElementById('url-update').value='60';
 document.getElementById('urlModeNote').textContent='留空自动生成 UUID；可直接输入自定义路径，或点击按钮反复生成。';
 document.getElementById('urlSaveStatus').textContent='';
 renderUrlSubs([]);
 AdminUI.openModal('urlModal');
}

function closeUrlModal(){AdminUI.closeModal('urlModal')}

function editUrl(token){
 const item=TOKENS.find(x=>x.url===token);
 if(!item)return;
 editingUrlValue=token;
 document.getElementById('urlModalTitle').textContent='编辑订阅链接';
 document.getElementById('url-edit-name').value=item.name||'';
 document.getElementById('url-edit-value').value=item.url||'';
 document.getElementById('url-edit-value').disabled=false;
 document.getElementById('url-update-enable').checked=item.updateEnable !== false;
 document.getElementById('url-update').value=Number.isFinite(Number(item.update)) ? item.update : 60;
 document.getElementById('urlModeNote').textContent='保留原路径即可不变；也可输入自定义路径、留空生成 UUID，或点击按钮反复生成。';
 document.getElementById('urlSaveStatus').textContent='';
 renderUrlSubs(item.subs||[]);
 AdminUI.openModal('urlModal');
}

function generateUrlUUID(){
 const input=document.getElementById('url-edit-value');
 if(!input || input.disabled)return;
 const bytes=new Uint8Array(16);
 if(window.crypto && window.crypto.getRandomValues){
  window.crypto.getRandomValues(bytes);
 }else{
  for(let index=0;index<bytes.length;index++)bytes[index]=Math.floor(Math.random()*256);
 }
 bytes[6]=(bytes[6]&15)|64;
 bytes[8]=(bytes[8]&63)|128;
 const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
 input.value=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}

async function saveUrl(){
 const selected=[...document.querySelectorAll('#url-sub-list .check-item')].filter(item=>{
   const input=item.querySelector('input[type=checkbox]');
   return input && input.checked;
 }).map(item=>item.dataset.sortId).filter(Boolean);
 const button=document.querySelector('#urlModal button:not(.secondary)');
 const status=document.getElementById('urlSaveStatus');

 if(!selected.length){
   showToast('至少选择一个聚合节点');
   return;
 }

 const oldUrl=editingUrlValue;
 const update=Number(document.getElementById('url-update').value);
 if(!Number.isFinite(update) || update < 0 || !Number.isInteger(update)){
   showToast('推荐更新时间必须是非负整数分钟');
   return;
 }
 const payload=oldUrl?{
   type:'url_update',
   oldUrl,
   newUrl:document.getElementById('url-edit-value').value.trim(),
   name:document.getElementById('url-edit-name').value.trim(),
   subs:selected,
   update,
   updateEnable:document.getElementById('url-update-enable').checked
 }:{
   type:'url_create',
   name:document.getElementById('url-edit-name').value.trim(),
   mode:document.getElementById('url-edit-value').value.trim() ? 'custom' : 'random',
   url:document.getElementById('url-edit-value').value.trim(),
   subs:selected,
   update,
   updateEnable:document.getElementById('url-update-enable').checked
 };

 AdminUI.setButtonBusy(button,true,'保存中...');
 status.textContent='正在保存...';
 try{
   const res=await fetch(window.location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const text=await res.text();
   if(!res.ok)throw new Error(text||'保存失败');
   const data=JSON.parse(text);
   if(!data.url)throw new Error('服务器未返回订阅链接数据');

   if(oldUrl){
     const index=TOKENS.findIndex(x=>x.url===oldUrl);
     if(index!==-1)TOKENS[index]=data.url; else TOKENS.push(data.url);
   }else{
     TOKENS.push(data.url);
   }

   refreshSubscriptionUI();
   status.textContent='保存成功';
   showToast(oldUrl?'订阅链接已更新':'订阅链接已创建');
   closeUrlModal();
 }catch(err){
   status.textContent=err.message||'保存失败';
   showToast(err.message||'保存失败');
 }finally{
   AdminUI.setButtonBusy(button,false);
 }
}

async function deleteUrl(token){
 const item=TOKENS.find(x=>x.url===token);
 if(!item)return;
 if(!confirm('确定删除“'+item.name+'”吗？'))return;

 const res=await fetch(window.location.pathname,{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({type:'url_delete',url:token})
 });
 const text=await res.text();

 if(!res.ok){showToast(text||'删除失败');return}
 const index=TOKENS.findIndex(x=>x.url===token);
 if(index!==-1)TOKENS.splice(index,1);
 renderUrlList();
 showToast('订阅链接已删除');
}

document.querySelectorAll('.modal-overlay').forEach(function(modal){
 if(modal.dataset.overlayDismissBound==='1')return;
 modal.dataset.overlayDismissBound='1';
 modal.setAttribute('aria-hidden','true');
 modal.addEventListener('click',function(event){
   if(event.target===modal){AdminUI.closeModal(modal);}
 });
});

async function refreshBackendStatus(){
 try{
    const statusUrl=window.location.pathname+'/status';
     const response=await fetch(statusUrl,{cache:'no-store'});
     if(!response.ok)throw new Error('状态检查失败（HTTP '+response.status+'）');
     const status=await response.json();
     const subApiStatus=document.getElementById('subapi-status');
     const subApiUrl=document.getElementById('subapi-url');
     const subConfigStatus=document.getElementById('subconfig-status');
     const subConfigUrl=document.getElementById('subconfig-url');
     if(subApiStatus){subApiStatus.className='status-indicator '+status.adminApiCss;subApiStatus.innerHTML=status.adminApiHtml;}
     if(subApiUrl){subApiUrl.href=status.finalApiUrl;subApiUrl.textContent=status.finalApiUrl;}
     if(subConfigStatus){subConfigStatus.className='status-indicator '+status.adminConfigCss;subConfigStatus.innerHTML=status.adminConfigHtml;}
     if(subConfigUrl){subConfigUrl.href=status.finalConfigUrl;subConfigUrl.textContent=status.finalConfigUrl;}
 }catch(error){
   console.warn('管理面板状态刷新失败:',error);
 }
}

switchFakeMode();
refreshSubscriptionUI();
refreshBackendStatus();
window.setInterval(refreshBackendStatus,10000);
</script>
</body>
</html>`;
}
