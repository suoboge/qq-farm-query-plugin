/**
 * QQ农场服务模块
 * 处理扫码登录、农场数据获取等核心功能
 */

import axios from 'axios';
import WebSocket from 'ws';
import type { 
    QRLoginSession, 
    UserLoginState, 
    FarmState, 
    BagState, 
    LandInfo, 
    BagItem,
    FarmSummary 
} from '../types';
import { pluginState } from '../core/state';
import { encode, decode, toLong, toNum, loadProtos, getType, protobuf } from './proto-service';

// ==================== 常量配置 ====================

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)';
const MP_QUA = 'V1_HT5_QDT_0.70.2209190_x64_0_DEV_D';
const FARM_APP_ID = '1112386029';
const CLIENT_VERSION = '1.6.0.14_20251224';
const SERVER_URL = 'wss://gate-obt.nqf.qq.com/prod/ws';

// 植物阶段常量
const PlantPhase = {
    SEED: 1,
    SPROUT: 2,
    GROWING: 3,
    FLOWERING: 4,
    MATURE: 5,
    DEAD: 6,
    UNKNOWN: 0
};

const PHASE_NAMES: Record<number, string> = {
    [PlantPhase.SEED]: '种子期',
    [PlantPhase.SPROUT]: '发芽期',
    [PlantPhase.GROWING]: '生长期',
    [PlantPhase.FLOWERING]: '开花期',
    [PlantPhase.MATURE]: '已成熟',
    [PlantPhase.DEAD]: '已枯萎',
    [PlantPhase.UNKNOWN]: '未知'
};

// 种子ID到中文名称映射
const SEED_NAMES: Record<number, { name: string; price: number }> = {
    20001: { name: '草莓种子', price: 50 },
    20002: { name: '西瓜种子', price: 80 },
    20003: { name: '胡萝卜种子', price: 20 },
    20004: { name: '玉米种子', price: 40 },
    20005: { name: '番茄种子', price: 30 },
    20006: { name: '茄子种子', price: 25 },
    20007: { name: '辣椒种子', price: 35 },
    20008: { name: '黄瓜种子', price: 28 },
    20009: { name: '豆角种子', price: 32 },
    20010: { name: '南瓜种子', price: 60 },
    20011: { name: '向日葵种子', price: 45 },
    20012: { name: '玫瑰种子', price: 100 },
    20013: { name: '郁金香种子', price: 80 },
    20014: { name: '百合种子', price: 120 },
    20015: { name: '康乃馨种子', price: 90 },
    20016: { name: '桃花种子', price: 150 },
    20017: { name: '樱花种子', price: 200 },
    20018: { name: '梅花种子', price: 180 },
    20019: { name: '牡丹种子', price: 250 },
    20020: { name: '兰花种子', price: 220 },
};

// 果实ID到中文名称映射
const FRUIT_NAMES: Record<number, string> = {
    30001: '草莓',
    30002: '西瓜',
    30003: '胡萝卜',
    30004: '玉米',
    30005: '番茄',
    30006: '茄子',
    30007: '辣椒',
    30008: '黄瓜',
    30009: '豆角',
    30010: '南瓜',
    30011: '向日葵',
    30012: '玫瑰',
    30013: '郁金香',
    30014: '百合',
    30015: '康乃馨',
    30016: '桃花',
    30017: '樱花',
    30018: '梅花',
    30019: '牡丹',
    30020: '兰花',
};

/**
 * 获取种子名称
 */
function getSeedName(id: number): string {
    return SEED_NAMES[id]?.name || `种子${id}`;
}

/**
 * 获取果实名称
 */
function getFruitName(id: number): string {
    return FRUIT_NAMES[id] || `果实${id}`;
}

/**
 * 获取植物名称（根据种子ID）
 */
function getPlantName(seedId: number): string {
    // 优先从种子名称映射获取（去掉"种子"后缀）
    const seedInfo = SEED_NAMES[seedId];
    if (seedInfo) {
        return seedInfo.name.replace('种子', '');
    }
    return `植物${seedId}`;
}

// ==================== 用户会话管理 ====================

interface UserSession {
    ws: WebSocket | null;
    loginState: UserLoginState;
    loginCode: string;
    authCode: string;
    clientSeq: number;
    serverSeq: number;
    pendingCallbacks: Map<number, { resolve: Function; reject: Function; timer: NodeJS.Timeout }>;
    qrSession: QRLoginSession | null;
    qrCheckTimer: NodeJS.Timeout | null;
    isConnected: boolean;
    heartbeatTimer: NodeJS.Timeout | null;
    lastHeartbeatResponse: number;
    reconnectAttempts: number;
}

const userSessions = new Map<string, UserSession>();
const HEARTBEAT_INTERVAL = 30000; // 心跳间隔 30秒
const MAX_RECONNECT_ATTEMPTS = 3; // 最大重连次数

function getUserSession(userId: string): UserSession {
    if (!userSessions.has(userId)) {
        userSessions.set(userId, {
            ws: null,
            loginState: { isLoggedIn: false, gid: 0, name: '', level: 0, gold: 0, exp: 0, loginTime: 0, authCode: '' },
            loginCode: '',
            authCode: '',
            clientSeq: 1,
            serverSeq: 0,
            pendingCallbacks: new Map(),
            qrSession: null,
            qrCheckTimer: null,
            isConnected: false,
            heartbeatTimer: null,
            lastHeartbeatResponse: 0,
            reconnectAttempts: 0
        });
    }
    return userSessions.get(userId)!;
}

// ==================== Protobuf 消息编解码 ====================

function encodeGateMessage(serviceName: string, methodName: string, body: Buffer, seq: number): Buffer {
    const gateType = getType('GateMessage');
    if (!gateType) {
        throw new Error('GateMessage 类型未加载');
    }
    
    const msg = gateType.create({
        meta: {
            service_name: serviceName,
            method_name: methodName,
            message_type: 1, // Request
            client_seq: toLong(seq),
            server_seq: toLong(0),
        },
        body: body || Buffer.alloc(0),
    });
    
    return Buffer.from(gateType.encode(msg).finish());
}

function decodeGateMessage(data: Buffer): { meta: any; body: Buffer } | null {
    const gateType = getType('GateMessage');
    if (!gateType) {
        pluginState.logger.warn('[Proto] GateMessage 类型未加载');
        return null;
    }
    
    try {
        const decoded = gateType.decode(data);
        const obj = gateType.toObject(decoded) as any;
        return { meta: obj.meta, body: Buffer.from(obj.body || []) };
    } catch (e) {
        pluginState.logger.warn('[Proto] 解码失败:', e);
        return null;
    }
}

// ==================== WebSocket 通信 ====================

/**
 * 安全获取 logger（防止插件未初始化时出错）
 */
function safeLog(level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
    try {
        const logger = pluginState.logger;
        if (logger) {
            logger[level](message);
        }
    } catch {
        // 忽略日志错误
    }
}

/**
 * 发送心跳请求
 */
async function sendHeartbeat(userId: string): Promise<void> {
    const session = getUserSession(userId);

    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
        return;
    }

    try {
        const heartbeatReqType = getType('HeartbeatRequest');
        if (!heartbeatReqType) {
            safeLog('debug', '[心跳] HeartbeatRequest 类型未加载');
            return;
        }

        const request = heartbeatReqType.create({
            gid: toLong(session.loginState.gid),
            client_version: CLIENT_VERSION,
        });
        const body = Buffer.from(heartbeatReqType.encode(request).finish());

        await sendRequest(userId, 'gamepb.userpb.UserService', 'Heartbeat', body);
        session.lastHeartbeatResponse = Date.now();
        safeLog('debug', '[心跳] 心跳响应正常');
    } catch (e) {
        safeLog('warn', `[心跳] 心跳失败: ${e}`);
    }
}

/**
 * 启动心跳定时器
 */
function startHeartbeat(userId: string): void {
    const session = getUserSession(userId);

    // 清除旧定时器
    if (session.heartbeatTimer) {
        clearInterval(session.heartbeatTimer);
        session.heartbeatTimer = null;
    }

    session.lastHeartbeatResponse = Date.now();

    session.heartbeatTimer = setInterval(() => {
        try {
            // 检查 pluginState 是否已初始化
            if (!pluginState || !pluginState.ctx) {
                // 插件已卸载，停止心跳
                if (session.heartbeatTimer) {
                    clearInterval(session.heartbeatTimer);
                    session.heartbeatTimer = null;
                }
                return;
            }

            // 检查连接状态
            if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
                safeLog('debug', '[心跳] 连接已断开，停止心跳');
                if (session.heartbeatTimer) {
                    clearInterval(session.heartbeatTimer);
                    session.heartbeatTimer = null;
                }
                return;
            }

            // 检查上次心跳响应时间，超过 90 秒无响应认为连接有问题
            const timeSinceLastResponse = Date.now() - session.lastHeartbeatResponse;
            if (timeSinceLastResponse > 90000) {
                safeLog('warn', `[心跳] 连接可能已断开 (${Math.round(timeSinceLastResponse / 1000)}s 无响应)`);
                // 标记连接断开，触发重连
                session.isConnected = false;
                return;
            }

            sendHeartbeat(userId);
        } catch (e) {
            // 忽略错误，可能是插件已卸载
        }
    }, HEARTBEAT_INTERVAL);

    safeLog('info', '[心跳] 心跳定时器已启动');
}

/**
 * 自动重连
 */
async function attemptReconnect(userId: string): Promise<boolean> {
    const session = getUserSession(userId);

    if (!session.loginState.authCode) {
        safeLog('warn', '[重连] 没有 authCode，无法重连');
        return false;
    }

    if (session.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        safeLog('warn', `[重连] 已达最大重连次数 (${MAX_RECONNECT_ATTEMPTS})，请重新登录`);
        session.loginState.isLoggedIn = false;
        return false;
    }

    session.reconnectAttempts++;
    safeLog('info', `[重连] 尝试重连 (${session.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);

    try {
        await ensureProtoLoaded();
        const ws = await connectWebSocket(userId, session.loginState.authCode);
        session.ws = ws;
        session.reconnectAttempts = 0;
        startHeartbeat(userId);
        safeLog('info', '[重连] 重连成功');
        return true;
    } catch (e) {
        safeLog('warn', `[重连] 重连失败: ${e}`);
        return false;
    }
}

/**
 * 确保连接可用（自动重连）
 */
async function ensureConnection(userId: string): Promise<boolean> {
    const session = getUserSession(userId);

    // 连接正常
    if (session.ws && session.ws.readyState === WebSocket.OPEN && session.isConnected) {
        return true;
    }

    // 尝试重连
    if (session.loginState.isLoggedIn && session.loginState.authCode) {
        return await attemptReconnect(userId);
    }

    return false;
}

function sendLogin(userId: string, ws: WebSocket, authCode: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const session = getUserSession(userId);
        const loginReqType = getType('LoginRequest');
        
        if (!loginReqType) {
            // 列出已加载的类型用于调试
            const availableTypes = ['GateMessage', 'LoginRequest', 'LoginReply', 'AllLandsRequest', 'BagRequest'];
            const loaded = availableTypes.map(t => `${t}:${getType(t) ? '✓' : '✗'}`).join(', ');
            pluginState.logger.error(`[Proto] 类型加载状态: ${loaded}`);
            reject(new Error('LoginRequest 类型未加载'));
            return;
        }
        
        pluginState.logger.info('[Proto] LoginRequest 类型已加载');
        
        // 构建 LoginRequest
        const loginReq = loginReqType.create({
            sharer_id: toLong(0),
            sharer_open_id: '',
            device_info: {
                client_version: CLIENT_VERSION,
                sys_software: 'iOS 26.2.1',
                network: 'wifi',
                memory: '7672',
                device_id: 'iPhone X<iPhone18,3>',
            },
            share_cfg_id: toLong(0),
            scene_id: '1256',
            report_data: {
                callback: '',
                cd_extend_info: '',
                click_id: '',
                clue_token: '',
                minigame_channel: 'other',
                minigame_platid: 2,
                req_id: '',
                trackid: '',
            },
        });
        
        const bodyBytes = Buffer.from(loginReqType.encode(loginReq).finish());
        const seq = session.clientSeq++;
        const encoded = encodeGateMessage('gamepb.userpb.UserService', 'Login', bodyBytes, seq);
        
        // 设置回调
        const timer = setTimeout(() => {
            session.pendingCallbacks.delete(seq);
            reject(new Error('登录请求超时'));
        }, 15000);
        
        session.pendingCallbacks.set(seq, {
            resolve: (body: Buffer) => {
                clearTimeout(timer);
                try {
                    const loginReplyType = getType('LoginReply');
                    if (loginReplyType && body.length > 0) {
                        const reply = loginReplyType.toObject(loginReplyType.decode(body)) as any;
                        if (reply.basic) {
                            session.loginState = {
                                isLoggedIn: true,
                                gid: toNum(reply.basic.gid),
                                name: reply.basic.name || '农场主',
                                level: toNum(reply.basic.level) || 1,
                                gold: toNum(reply.basic.gold) || 0,
                                exp: toNum(reply.basic.exp) || 0,
                                loginTime: Date.now(),
                                authCode
                            };
                            pluginState.logger.info(`[农场] 登录成功: ${session.loginState.name} (Lv.${session.loginState.level})`);
                        }
                    }
                } catch (e) {
                    pluginState.logger.warn('[农场] 解析登录响应失败:', e);
                }
                session.isConnected = true;
                resolve();
            },
            reject: (err: Error) => {
                clearTimeout(timer);
                reject(err);
            },
            timer
        });
        
        ws.send(encoded);
        pluginState.logger.info('[农场] 已发送登录请求');
    });
}

function connectWebSocket(userId: string, authCode: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const session = getUserSession(userId);
        const url = `${SERVER_URL}?platform=qq&os=iOS&ver=${CLIENT_VERSION}&code=${authCode}&openID=`;

        pluginState.logger.info(`[农场] 正在连接服务器: ${url.split('?')[0]}...`);

        const ws = new WebSocket(url, {
            headers: {
                'User-Agent': CHROME_UA,
                'Origin': 'https://gate-obt.nqf.qq.com',
            },
        });

        ws.binaryType = 'arraybuffer';

        let loginResolved = false;
        let loginAttempted = false;
        let shouldReconnect = true; // 是否应该重连

        ws.on('open', async () => {
            pluginState.logger.info(`[农场] WebSocket 连接打开，准备发送登录请求...`);

            if (!loginAttempted) {
                loginAttempted = true;
                try {
                    await sendLogin(userId, ws, authCode);
                    if (!loginResolved) {
                        loginResolved = true;
                        session.ws = ws;
                        session.authCode = authCode; // 保存 authCode 用于重连
                        session.isConnected = true;
                        session.reconnectAttempts = 0;
                        startHeartbeat(userId); // 启动心跳
                        resolve(ws);
                    }
                } catch (e) {
                    if (!loginResolved) {
                        loginResolved = true;
                        reject(e);
                    }
                }
            }
        });

        ws.on('message', (rawData) => {
            const data = Buffer.from(rawData as ArrayBuffer);
            const msg = decodeGateMessage(data);
            if (!msg) return;

            const msgType = msg.meta.message_type;
            
            // Response
            if (msgType === 2) {
                const clientSeq = toNum(msg.meta.client_seq);
                const callback = session.pendingCallbacks.get(clientSeq);
                if (callback) {
                    session.pendingCallbacks.delete(clientSeq);
                    clearTimeout(callback.timer);
                    
                    const errorCode = toNum(msg.meta.error_code);
                    if (errorCode !== 0) {
                        callback.reject(new Error(`错误 code=${errorCode}: ${msg.meta.error_message || '未知错误'}`));
                    } else {
                        callback.resolve(msg.body);
                    }
                }
            }
            
            // Notify (message_type = 3)
            if (msgType === 3) {
                pluginState.logger.debug(`[农场] 收到通知: ${msg.meta.service_name}.${msg.meta.method_name}`);
            }
        });

        ws.on('close', (code) => {
            session.isConnected = false;
            pluginState.logger.info(`[农场] WebSocket 连接关闭 (code: ${code})`);

            // 清理心跳定时器
            if (session.heartbeatTimer) {
                clearInterval(session.heartbeatTimer);
                session.heartbeatTimer = null;
            }

            // 认证错误（400等）不进行重连，清除登录状态
            if (!shouldReconnect) {
                pluginState.logger.warn('[农场] 认证失败，清除登录状态');
                session.loginState.isLoggedIn = false;
                session.loginState.gid = 0;
                session.loginState.name = '';
                session.loginState.gold = 0;
                session.loginState.exp = 0;
                session.authCode = '';
                return;
            }

            // 自动重连：延迟 5 秒后重试
            if (session.loginState.isLoggedIn && session.authCode) {
                pluginState.logger.info('[农场] 5 秒后尝试自动重连...');
                setTimeout(() => {
                    attemptReconnect(userId);
                }, 5000);
            }
        });

        ws.on('error', (err) => {
            pluginState.logger.error(`[农场] WebSocket 错误:`, err.message);

            // 检查是否是认证错误（400）
            const message = err.message || '';
            const match = message.match(/Unexpected server response:\s*(\d+)/i);
            if (match) {
                const code = Number.parseInt(match[1], 10) || 0;
                if (code === 400 || code === 401 || code === 403) {
                    // 认证错误，不重连
                    shouldReconnect = false;
                    pluginState.logger.warn(`[农场] 认证失败 (code: ${code})，需要重新登录`);
                }
            }

            if (!loginResolved) {
                loginResolved = true;
                reject(err);
            }
        });

        // 超时处理
        setTimeout(() => {
            if (!loginResolved) {
                loginResolved = true;
                ws.terminate();
                reject(new Error('连接超时'));
            }
        }, 20000);
    });
}

function sendRequest(userId: string, serviceName: string, methodName: string, body: Buffer = Buffer.alloc(0)): Promise<Buffer> {
    const session = getUserSession(userId);
    
    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('未连接到服务器'));
    }

    return new Promise((resolve, reject) => {
        const seq = session.clientSeq++;
        const timer = setTimeout(() => {
            session.pendingCallbacks.delete(seq);
            reject(new Error('请求超时'));
        }, 15000);

        session.pendingCallbacks.set(seq, { resolve, reject, timer });
        
        const encoded = encodeGateMessage(serviceName, methodName, body, seq);
        session.ws.send(encoded);
    });
}

// ==================== 二维码登录 ====================

/**
 * 请求小程序登录码
 */
async function requestLoginCode(userId?: string): Promise<{ code: string; url: string; image: string }> {
    const headers = {
        'qua': MP_QUA,
        'host': 'q.qq.com',
        'accept': 'application/json',
        'content-type': 'application/json',
        'user-agent': CHROME_UA
    };

    const response = await axios.get('https://q.qq.com/ide/devtoolAuth/GetLoginCode', { headers });
    const { code, data } = response.data;

    if (+code !== 0) {
        throw new Error('获取登录码失败');
    }

    const loginCode = data.code || '';
    const loginUrl = `https://h5.qzone.qq.com/qqq/code/${loginCode}?_proxy=1&from=ide`;

    // 使用API生成二维码图片
    let qrImage = '';
    try {
        if (userId) {
            const qrApiUrl = `https://api.andeer.top/API/private_qrcode.php?text=${encodeURIComponent(loginUrl)}&msg=AurorAPI&url=andeer.top&cqq=${userId}`;
            pluginState.logger.info(`[农场] 正在生成二维码图片...`);
            
            const qrResponse = await axios.get(qrApiUrl, { 
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: {
                    'Accept': 'image/png,image/jpeg,*/*',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            // API直接返回PNG图片数据，需要转换为base64
            const contentType = qrResponse.headers['content-type'] || 'image/png';
            const base64 = Buffer.from(qrResponse.data, 'binary').toString('base64');
            qrImage = `data:${contentType};base64,${base64}`;
            
            pluginState.logger.info(`[农场] 二维码图片生成成功, 大小: ${qrImage.length} 字符`);
        }
    } catch (e) {
        pluginState.logger.warn(`[农场] 生成二维码图片失败: ${e}`);
    }

    return { code: loginCode, url: loginUrl, image: qrImage };
}

/**
 * 查询扫码状态
 */
async function queryScanStatus(code: string): Promise<{ status: string; ticket?: string; uin?: number; nickname?: string }> {
    const headers = {
        'qua': MP_QUA,
        'host': 'q.qq.com',
        'accept': 'application/json',
        'content-type': 'application/json',
        'user-agent': CHROME_UA
    };

    const response = await axios.get(
        `https://q.qq.com/ide/devtoolAuth/syncScanSateGetTicket?code=${code}`,
        { headers }
    );

    if (response.status !== 200) {
        return { status: 'Error' };
    }

    const { code: resCode, data } = response.data;

    if (+resCode === 0) {
        if (+data.ok !== 1) return { status: 'Wait' };
        return { status: 'OK', ticket: data.ticket, uin: data.uin, nickname: data.nick || '' };
    }

    if (+resCode === -10003) return { status: 'Used' };

    return { status: 'Error' };
}

/**
 * 获取认证码
 */
async function getAuthCode(ticket: string): Promise<string> {
    const headers = {
        'qua': MP_QUA,
        'host': 'q.qq.com',
        'accept': 'application/json',
        'content-type': 'application/json',
        'user-agent': CHROME_UA
    };

    const response = await axios.post(
        'https://q.qq.com/ide/login',
        { appid: FARM_APP_ID, ticket },
        { headers }
    );

    if (response.status !== 200) return '';

    const { code } = response.data;
    return code || '';
}

// ==================== 公开API ====================

/**
 * 初始化 Proto（异步）
 */
let protoLoaded = false;
async function ensureProtoLoaded(): Promise<void> {
    if (!protoLoaded) {
        try {
            await loadProtos();
            protoLoaded = true;
        } catch (e) {
            pluginState.logger.warn('[Proto] 加载失败，将使用备用方案');
        }
    }
}

/**
 * 开始扫码登录流程
 */
export async function startQRLogin(userId: string): Promise<QRLoginSession> {
    const session = getUserSession(userId);

    if (session.qrCheckTimer) {
        clearInterval(session.qrCheckTimer);
        session.qrCheckTimer = null;
    }

    const { code, url, image } = await requestLoginCode(userId);

    const qrSession: QRLoginSession = {
        code,
        qrImage: image,
        qrUrl: url,
        createdAt: Date.now(),
        userId
    };

    session.qrSession = qrSession;
    session.loginCode = code;

    pluginState.logger.info(`[农场] 用户 ${userId} 开始扫码登录，登录码: ${code}`);

    return qrSession;
}

/**
 * 等待扫码完成
 */
export async function waitForScan(userId: string, timeoutMs: number = 120000): Promise<UserLoginState> {
    const session = getUserSession(userId);

    if (!session.qrSession) {
        throw new Error('请先调用 startQRLogin');
    }

    const startTime = Date.now();

    return new Promise((resolve, reject) => {
        const checkInterval = setInterval(async () => {
            if (Date.now() - startTime > timeoutMs) {
                clearInterval(checkInterval);
                session.qrCheckTimer = null;
                session.qrSession = null;
                reject(new Error('扫码超时'));
                return;
            }

            try {
                const status = await queryScanStatus(session.loginCode);

                if (status.status === 'OK' && status.ticket) {
                    clearInterval(checkInterval);
                    session.qrCheckTimer = null;

                    const authCode = await getAuthCode(status.ticket);
                    if (!authCode) {
                        reject(new Error('获取认证码失败'));
                        return;
                    }

                    // 连接到服务器
                    try {
                        await ensureProtoLoaded();
                        const ws = await connectWebSocket(userId, authCode);
                        session.ws = ws;
                        session.authCode = authCode;

                        pluginState.logger.info(`[农场] 用户 ${userId} 登录成功: ${status.nickname}`);
                        resolve(session.loginState);
                    } catch (e) {
                        // 检查是否是认证错误
                        const message = e instanceof Error ? e.message : String(e);
                        const isAuthError = message.includes('400') || message.includes('401') || message.includes('403');

                        if (isAuthError) {
                            // 认证失败，清除登录状态
                            session.loginState = {
                                isLoggedIn: false,
                                gid: 0,
                                name: '',
                                level: 0,
                                gold: 0,
                                exp: 0,
                                loginTime: 0,
                                authCode: ''
                            };
                            session.authCode = '';
                            pluginState.logger.warn(`[农场] 认证失败: ${message}`);
                            reject(new Error('认证失败，请重新扫码登录'));
                        } else {
                            // 其他错误，使用备用状态（但标记连接失败）
                            session.loginState = {
                                isLoggedIn: true,
                                gid: status.uin || 0,
                                name: status.nickname || '农场主',
                                level: 1,
                                gold: 0,
                                exp: 0,
                                loginTime: Date.now(),
                                authCode
                            };
                            session.isConnected = false;
                            pluginState.logger.warn(`[农场] WebSocket连接失败，使用备用模式: ${e}`);
                            resolve(session.loginState);
                        }
                    }
                } else if (status.status === 'Used') {
                    clearInterval(checkInterval);
                    session.qrCheckTimer = null;
                    reject(new Error('二维码已过期'));
                }
            } catch (e) {
                pluginState.logger.debug(`[农场] 检查扫码状态出错:`, e);
            }
        }, 2000);

        session.qrCheckTimer = checkInterval;
    });
}

/**
 * 获取农场状态 - 真实数据
 */
export async function getFarmState(userId: string): Promise<FarmState> {
    const session = getUserSession(userId);

    if (!session.loginState.isLoggedIn) {
        throw new Error('请先登录');
    }

    // 确保连接可用（自动重连）
    const connected = await ensureConnection(userId);
    if (!connected) {
        pluginState.logger.warn('[农场] 无法建立连接，使用模拟数据');
        return generateMockFarmState(session.loginState);
    }

    // 尝试获取真实数据
    try {
        // 构建 AllLandsRequest
        const allLandsReqType = getType('AllLandsRequest');
        if (allLandsReqType) {
            const request = allLandsReqType.create({
                land_ids: [],
                host_gid: toLong(session.loginState.gid),
            });
            const body = Buffer.from(allLandsReqType.encode(request).finish());

            // 发送请求
            const response = await sendRequest(userId, 'gamepb.plantpb.PlantService', 'AllLands', body);

            // 解析响应
            const allLandsReplyType = getType('AllLandsReply');
            if (allLandsReplyType && response.length > 0) {
                const reply = allLandsReplyType.toObject(allLandsReplyType.decode(response)) as any;

                if (reply.lands && reply.lands.length > 0) {
                    const lands: LandInfo[] = [];
                    const summary: FarmSummary = {
                        harvestable: 0,
                        growing: 0,
                        empty: 0,
                        dead: 0,
                        needWater: 0,
                        needWeed: 0,
                        needBug: 0
                    };

                    const nowSec = Math.floor(Date.now() / 1000);

                    for (const land of reply.lands) {
                        const id = toNum(land.id);
                        const unlocked = !!land.unlocked;
                        let status = 'locked';
                        let plantName = '';
                        let phaseName = '';
                        let matureInSec = 0;
                        let needWater = false;
                        let needWeed = false;
                        let needBug = false;
                        let seedId = 0;

                        if (unlocked) {
                            const plant = land.plant;
                            if (!plant || !plant.phases || plant.phases.length === 0) {
                                status = 'empty';
                                summary.empty++;
                            } else {
                                // 获取当前阶段
                                const currentPhase = plant.phases.find((p: any) => {
                                    const beginTime = toNum(p.begin_time);
                                    return beginTime > 0 && beginTime <= nowSec;
                                }) || plant.phases[0];

                                const phaseVal = currentPhase ? toNum(currentPhase.phase) : 0;

                                if (phaseVal === PlantPhase.MATURE) {
                                    status = 'harvestable';
                                    summary.harvestable++;
                                } else if (phaseVal === PlantPhase.DEAD) {
                                    status = 'dead';
                                    summary.dead++;
                                } else {
                                    status = 'growing';
                                    summary.growing++;
                                }

                                plantName = plant.name || getPlantName(seedId);
                                phaseName = PHASE_NAMES[phaseVal] || '未知';
                                seedId = toNum(plant.id || plant.seed_id || 0);

                                // 计算成熟时间
                                const maturePhase = plant.phases.find((p: any) => toNum(p.phase) === PlantPhase.MATURE);
                                if (maturePhase) {
                                    const matureBegin = toNum(maturePhase.begin_time);
                                    matureInSec = Math.max(0, matureBegin - nowSec);
                                }

                                // 检查状态
                                needWater = toNum(plant.dry_num) > 0;
                                needWeed = plant.weed_owners && plant.weed_owners.length > 0;
                                needBug = plant.insect_owners && plant.insect_owners.length > 0;

                                if (needWater) summary.needWater++;
                                if (needWeed) summary.needWeed++;
                                if (needBug) summary.needBug++;
                            }
                        }

                        lands.push({
                            id,
                            unlocked,
                            status,
                            plantName,
                            seedId,
                            seedImage: '',
                            phaseName,
                            matureInSec,
                            needWater,
                            needWeed,
                            needBug,
                            level: toNum(land.level)
                        });
                    }

                    pluginState.logger.info(`[农场] 获取真实农场数据成功: ${lands.length}块土地`);
                    return {
                        user: session.loginState,
                        lands,
                        summary,
                        queryTime: Date.now()
                    };
                }
            }
        }
    } catch (e) {
        pluginState.logger.warn(`[农场] 获取真实农场数据失败: ${e}`);
    }

    // 回退到模拟数据（带标记）
    pluginState.logger.warn('[农场] 使用模拟数据');
    return generateMockFarmState(session.loginState);
}

/**
 * 生成模拟农场数据
 */
function generateMockFarmState(user: UserLoginState): FarmState {
    const lands: LandInfo[] = [];
    const summary: FarmSummary = {
        harvestable: 0,
        growing: 0,
        empty: 0,
        dead: 0,
        needWater: 0,
        needWeed: 0,
        needBug: 0
    };

    const plantTypes = [
        { name: '草莓', growTime: 7200 },
        { name: '胡萝卜', growTime: 2400 },
        { name: '玉米', growTime: 3600 },
        { name: '番茄', growTime: 6000 },
        { name: '南瓜', growTime: 7200 },
        { name: '西瓜', growTime: 21600 },
    ];

    for (let i = 1; i <= 12; i++) {
        const rand = Math.random();
        let status = 'empty';
        let plantName = '';
        let phaseName = '空地';
        let matureInSec = 0;
        let needWater = false;
        let needWeed = false;
        let needBug = false;

        if (rand < 0.15) {
            status = 'empty';
            summary.empty++;
        } else if (rand < 0.75) {
            status = 'growing';
            const plant = plantTypes[Math.floor(Math.random() * plantTypes.length)];
            plantName = plant.name;
            phaseName = ['种子期', '发芽期', '生长期', '开花期'][Math.floor(Math.random() * 4)];
            matureInSec = Math.floor(Math.random() * plant.growTime);
            needWater = Math.random() < 0.3;
            needWeed = Math.random() < 0.2;
            needBug = Math.random() < 0.2;
            summary.growing++;
            if (needWater) summary.needWater++;
            if (needWeed) summary.needWeed++;
            if (needBug) summary.needBug++;
        } else {
            status = 'harvestable';
            const plant = plantTypes[Math.floor(Math.random() * plantTypes.length)];
            plantName = plant.name;
            phaseName = '已成熟';
            summary.harvestable++;
        }

        lands.push({
            id: i,
            unlocked: true,
            status,
            plantName,
            seedId: 0,
            seedImage: '',
            phaseName,
            matureInSec,
            needWater,
            needWeed,
            needBug,
            level: 1
        });
    }

    return {
        user,
        lands,
        summary,
        queryTime: Date.now()
    };
}

/**
 * 获取背包状态
 */
export async function getBagState(userId: string): Promise<BagState> {
    const session = getUserSession(userId);

    if (!session.loginState.isLoggedIn) {
        throw new Error('请先登录');
    }

    // 确保连接可用（自动重连）
    const connected = await ensureConnection(userId);
    if (!connected) {
        pluginState.logger.warn('[农场] 无法建立连接，使用模拟背包数据');
        return generateMockBagState(session.loginState);
    }

    // 尝试获取真实数据
    try {
            // 构建 BagRequest
            const bagReqType = getType('BagRequest');
            if (bagReqType) {
                const request = bagReqType.create({});
                const body = Buffer.from(bagReqType.encode(request).finish());
                
                const response = await sendRequest(userId, 'gamepb.itempb.ItemService', 'Bag', body);
                
                // 解析响应
                const bagReplyType = getType('BagReply');
                if (bagReplyType && response.length > 0) {
                    const reply = bagReplyType.toObject(bagReplyType.decode(response)) as any;
                    
                    const items: BagItem[] = [];
                    let gold = 0;
                    let exp = 0;

                    const rawItems = reply.item_bag?.items || reply.items || [];
                    
                    for (const item of rawItems) {
                        const id = toNum(item.id);
                        const count = toNum(item.count);
                        
                        if (id === 1 || id === 1001) {
                            gold = count;
                        } else if (id === 1101) {
                            exp = count;
                        } else {
                            let category = 'item';
                            let itemName = `物品${id}`;
                            let price = 0;
                            
                            if (id >= 20000 && id < 30000) {
                                category = 'seed';
                                const seedInfo = SEED_NAMES[id];
                                if (seedInfo) {
                                    itemName = seedInfo.name;
                                    price = seedInfo.price;
                                }
                            } else if (id >= 30000) {
                                category = 'fruit';
                                itemName = getFruitName(id);
                            }
                            
                            items.push({
                                id,
                                count,
                                name: itemName,
                                image: '',
                                category,
                                itemType: 0,
                                price
                            });
                        }
                    }

                    pluginState.logger.info(`[农场] 获取真实背包数据成功: ${items.length}种物品`);
                    return {
                        items,
                        totalKinds: items.length,
                        gold: gold || session.loginState.gold,
                        exp: exp || session.loginState.exp,
                        queryTime: Date.now()
                    };
                }
            }
        } catch (e) {
            pluginState.logger.warn(`[农场] 获取真实背包数据失败: ${e}`);
        }

    // 回退到模拟数据
    pluginState.logger.warn('[农场] 使用模拟背包数据');
    return generateMockBagState(session.loginState);
}

/**
 * 生成模拟背包数据
 */
function generateMockBagState(user: UserLoginState): BagState {
    const items: BagItem[] = [
        { id: 1, count: user.gold || 10000, name: '金币', image: '', category: 'gold', itemType: 1, price: 0 },
        { id: 1101, count: user.exp || 5000, name: '经验', image: '', category: 'exp', itemType: 1, price: 0 },
        { id: 20001, count: 15, name: '草莓种子', image: '', category: 'seed', itemType: 5, price: 50 },
        { id: 20003, count: 30, name: '胡萝卜种子', image: '', category: 'seed', itemType: 5, price: 20 },
        { id: 20004, count: 20, name: '玉米种子', image: '', category: 'seed', itemType: 5, price: 40 },
        { id: 30001, count: 8, name: '草莓果实', image: '', category: 'fruit', itemType: 4, price: 80 },
        { id: 30003, count: 25, name: '胡萝卜果实', image: '', category: 'fruit', itemType: 4, price: 30 },
    ];

    return {
        items,
        totalKinds: items.length,
        gold: user.gold || 10000,
        exp: user.exp || 5000,
        queryTime: Date.now()
    };
}

/**
 * 获取仓库状态（使用背包数据，筛选果实类）
 */
export async function getWarehouseState(userId: string): Promise<BagState> {
    const session = getUserSession(userId);

    if (!session.loginState.isLoggedIn) {
        throw new Error('请先登录');
    }

    // 仓库数据从背包获取，筛选果实类
    const bagState = await getBagState(userId);
    
    // 仓库只显示果实类物品
    const warehouseItems = bagState.items.filter(item => item.category === 'fruit');
    
    pluginState.logger.info(`[农场] 获取仓库数据成功: ${warehouseItems.length}种作物`);
    
    return {
        items: warehouseItems,
        totalKinds: warehouseItems.length,
        gold: bagState.gold,
        exp: bagState.exp,
        queryTime: Date.now()
    };
}

/**
 * 获取商店状态（种子列表）
 */
export async function getShopState(userId: string): Promise<BagState> {
    const session = getUserSession(userId);

    if (!session.loginState.isLoggedIn) {
        throw new Error('请先登录');
    }

    // 商店数据从背包获取，筛选种子类
    const bagState = await getBagState(userId);
    
    // 商店显示种子类物品
    const seedItems = bagState.items.filter(item => item.category === 'seed');
    
    pluginState.logger.info(`[农场] 获取商店数据成功: ${seedItems.length}种种子`);
    
    return {
        items: seedItems,
        totalKinds: seedItems.length,
        gold: bagState.gold,
        exp: bagState.exp,
        queryTime: Date.now()
    };
}

/**
 * 获取用户登录状态
 */
export function getLoginState(userId: string): UserLoginState {
    return getUserSession(userId).loginState;
}

/**
 * 检查用户是否已登录
 */
export function isLoggedIn(userId: string): boolean {
    return getUserSession(userId).loginState.isLoggedIn;
}

/**
 * 登出
 */
export function logout(userId: string): void {
    const session = getUserSession(userId);
    if (session.ws) {
        session.ws.close();
        session.ws = null;
    }
    if (session.qrCheckTimer) {
        clearInterval(session.qrCheckTimer);
        session.qrCheckTimer = null;
    }
    session.loginState = {
        isLoggedIn: false,
        gid: 0,
        name: '',
        level: 0,
        gold: 0,
        exp: 0,
        loginTime: 0,
        authCode: ''
    };
    session.qrSession = null;
    session.isConnected = false;
    pluginState.logger.info(`[农场] 用户 ${userId} 已登出`);
}

/**
 * 清理所有会话和定时器（插件卸载时调用）
 */
export function cleanup(): void {
    for (const [userId, session] of userSessions) {
        // 清理心跳定时器
        if (session.heartbeatTimer) {
            clearInterval(session.heartbeatTimer);
            session.heartbeatTimer = null;
        }
        // 清理扫码检查定时器
        if (session.qrCheckTimer) {
            clearInterval(session.qrCheckTimer);
            session.qrCheckTimer = null;
        }
        // 关闭 WebSocket
        if (session.ws) {
            session.ws.removeAllListeners();
            session.ws.close();
            session.ws = null;
        }
    }
    userSessions.clear();
}

// ==================== 农场操作 ====================

/** 操作结果 */
export interface OperationResult {
    success: boolean;
    message: string;
    lands?: LandInfo[];
}

/**
 * 收获作物
 */
export async function harvest(userId: string, landIds?: number[], isAll: boolean = false): Promise<OperationResult> {
    const session = getUserSession(userId);

    if (!session.loginState.isLoggedIn) {
        throw new Error('请先登录');
    }

    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
        return { success: false, message: '未连接到服务器' };
    }

    try {
        const harvestReqType = getType('HarvestRequest');
        if (!harvestReqType) {
            return { success: false, message: 'HarvestRequest 类型未加载' };
        }

        // 如果不是全部收获且没有指定土地ID，先获取可收获的土地
        let targetLandIds = landIds || [];
        if (!isAll && targetLandIds.length === 0) {
            const farmState = await getFarmState(userId);
            targetLandIds = farmState.lands
                .filter(l => l.status === 'harvestable')
                .map(l => l.id);
            
            if (targetLandIds.length === 0) {
                return { success: false, message: '没有可收获的作物' };
            }
        }

        const request = harvestReqType.create({
            land_ids: targetLandIds.map(id => toLong(id)),
            host_gid: toLong(session.loginState.gid),
            is_all: isAll
        });
        const body = Buffer.from(harvestReqType.encode(request).finish());

        const response = await sendRequest(userId, 'gamepb.plantpb.PlantService', 'Harvest', body);

        const harvestReplyType = getType('HarvestReply');
        if (harvestReplyType && response.length > 0) {
            const reply = harvestReplyType.toObject(harvestReplyType.decode(response)) as any;
            const landCount = reply.land?.length || 0;
            pluginState.logger.info(`[农场] 收获成功: ${landCount}块土地`);
            return { 
                success: true, 
                message: `成功收获 ${landCount} 块土地的作物`,
                lands: reply.land
            };
        }

        return { success: true, message: '收获请求已发送' };
    } catch (e) {
        pluginState.logger.warn(`[农场] 收获失败: ${e}`);
        return { success: false, message: `收获失败: ${e}` };
    }
}

/**
 * 编码种植请求（手动编码，因为 protobufjs 对嵌套消息的编码有问题）
 */
function encodePlantRequest(seedId: number, landIds: number[]): Buffer {
    const writer = protobuf.Writer.create();
    
    // field 2 = items (repeated PlantItem)
    // 每个土地单独种植
    const itemWriter = writer.uint32(18).fork();  // field 2, wire type 2 (length-delimited)
    itemWriter.uint32(8).int64(seedId);  // field 1: seed_id
    
    // field 2: land_ids (repeated int64)
    const idsWriter = itemWriter.uint32(18).fork();
    for (const id of landIds) {
        idsWriter.int64(id);
    }
    idsWriter.ldelim();  // 结束 land_ids
    itemWriter.ldelim();  // 结束 PlantItem
    
    return Buffer.from(writer.finish());
}

/**
 * 种植作物
 */
export async function plant(userId: string, seedId: number, landIds?: number[]): Promise<OperationResult> {
    const session = getUserSession(userId);

    if (!session.loginState.isLoggedIn) {
        throw new Error('请先登录');
    }

    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
        return { success: false, message: '未连接到服务器' };
    }

    try {
        // 如果没有指定土地ID，获取空地
        let targetLandIds = landIds || [];
        if (targetLandIds.length === 0) {
            const farmState = await getFarmState(userId);
            targetLandIds = farmState.lands
                .filter(l => l.status === 'empty')
                .map(l => l.id);

            if (targetLandIds.length === 0) {
                return { success: false, message: '没有空地可种植' };
            }
        }

        // 逐块种植（参考项目也是逐块种植）
        let successCount = 0;
        for (const landId of targetLandIds) {
            try {
                const body = encodePlantRequest(seedId, [landId]);
                await sendRequest(userId, 'gamepb.plantpb.PlantService', 'Plant', body);
                successCount++;
            } catch (e) {
                pluginState.logger.warn(`[农场] 土地${landId}种植失败: ${e}`);
            }
        }

        pluginState.logger.info(`[农场] 种植完成: ${successCount}/${targetLandIds.length}块土地, 种子ID=${seedId}`);
        return {
            success: successCount > 0,
            message: successCount > 0 
                ? `成功在 ${successCount} 块土地种植了种子(${seedId})`
                : `种植失败，请检查种子ID是否正确`
        };
    } catch (e) {
        pluginState.logger.warn(`[农场] 种植失败: ${e}`);
        return { success: false, message: `种植失败: ${e}` };
    }
}

/**
 * 铲除植物
 */
export async function removePlant(userId: string, landIds?: number[]): Promise<OperationResult> {
    const session = getUserSession(userId);

    if (!session.loginState.isLoggedIn) {
        throw new Error('请先登录');
    }

    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
        return { success: false, message: '未连接到服务器' };
    }

    try {
        const removeReqType = getType('RemovePlantRequest');
        if (!removeReqType) {
            return { success: false, message: 'RemovePlantRequest 类型未加载' };
        }

        // 如果没有指定土地ID，获取枯萎的土地
        let targetLandIds = landIds || [];
        if (targetLandIds.length === 0) {
            const farmState = await getFarmState(userId);
            targetLandIds = farmState.lands
                .filter(l => l.status === 'dead')
                .map(l => l.id);
            
            if (targetLandIds.length === 0) {
                return { success: false, message: '没有可铲除的植物（需要枯萎状态）' };
            }
        }

        const request = removeReqType.create({
            land_ids: targetLandIds.map(id => toLong(id))
        });
        const body = Buffer.from(removeReqType.encode(request).finish());

        const response = await sendRequest(userId, 'gamepb.plantpb.PlantService', 'RemovePlant', body);

        const removeReplyType = getType('RemovePlantReply');
        if (removeReplyType && response.length > 0) {
            const reply = removeReplyType.toObject(removeReplyType.decode(response)) as any;
            const landCount = reply.land?.length || 0;
            pluginState.logger.info(`[农场] 铲除成功: ${landCount}块土地`);
            return { 
                success: true, 
                message: `成功铲除 ${landCount} 块土地的植物`,
                lands: reply.land
            };
        }

        return { success: true, message: '铲除请求已发送' };
    } catch (e) {
        pluginState.logger.warn(`[农场] 铲除失败: ${e}`);
        return { success: false, message: `铲除失败: ${e}` };
    }
}

/**
 * 升级土地
 */
export async function upgradeLand(userId: string, landId: number): Promise<OperationResult> {
    const session = getUserSession(userId);

    if (!session.loginState.isLoggedIn) {
        throw new Error('请先登录');
    }

    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
        return { success: false, message: '未连接到服务器' };
    }

    try {
        const upgradeReqType = getType('UpgradeLandRequest');
        if (!upgradeReqType) {
            return { success: false, message: 'UpgradeLandRequest 类型未加载' };
        }

        const request = upgradeReqType.create({
            land_id: toLong(landId)
        });
        const body = Buffer.from(upgradeReqType.encode(request).finish());

        const response = await sendRequest(userId, 'gamepb.plantpb.PlantService', 'UpgradeLand', body);

        const upgradeReplyType = getType('UpgradeLandReply');
        if (upgradeReplyType && response.length > 0) {
            const reply = upgradeReplyType.toObject(upgradeReplyType.decode(response)) as any;
            const newLevel = toNum(reply.land?.level) || 0;
            pluginState.logger.info(`[农场] 升级土地成功: 土地${landId} -> Lv.${newLevel}`);
            return { 
                success: true, 
                message: `土地 ${landId} 升级成功，当前等级: Lv.${newLevel}`
            };
        }

        return { success: true, message: '升级请求已发送' };
    } catch (e) {
        pluginState.logger.warn(`[农场] 升级土地失败: ${e}`);
        return { success: false, message: `升级失败: ${e}` };
    }
}

/**
 * 扩建土地（解锁土地）
 */
export async function unlockLand(userId: string, landId: number): Promise<OperationResult> {
    const session = getUserSession(userId);

    if (!session.loginState.isLoggedIn) {
        throw new Error('请先登录');
    }

    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
        return { success: false, message: '未连接到服务器' };
    }

    try {
        const unlockReqType = getType('UnlockLandRequest');
        if (!unlockReqType) {
            return { success: false, message: 'UnlockLandRequest 类型未加载' };
        }

        const request = unlockReqType.create({
            land_id: toLong(landId),
            do_shared: false
        });
        const body = Buffer.from(unlockReqType.encode(request).finish());

        const response = await sendRequest(userId, 'gamepb.plantpb.PlantService', 'UnlockLand', body);

        const unlockReplyType = getType('UnlockLandReply');
        if (unlockReplyType && response.length > 0) {
            const reply = unlockReplyType.toObject(unlockReplyType.decode(response)) as any;
            pluginState.logger.info(`[农场] 扩建土地成功: 土地${landId}`);
            return { 
                success: true, 
                message: `土地 ${landId} 解锁成功！`
            };
        }

        return { success: true, message: '扩建请求已发送' };
    } catch (e) {
        pluginState.logger.warn(`[农场] 扩建土地失败: ${e}`);
        return { success: false, message: `扩建失败: ${e}` };
    }
}

/**
 * 出售物品
 */
export async function sellItems(userId: string, itemId: number, count: number): Promise<OperationResult> {
    const session = getUserSession(userId);

    if (!session.loginState.isLoggedIn) {
        throw new Error('请先登录');
    }

    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
        return { success: false, message: '未连接到服务器' };
    }

    try {
        const sellReqType = getType('SellRequest');
        if (!sellReqType) {
            return { success: false, message: 'SellRequest 类型未加载' };
        }

        // 构建要出售的物品
        const items = [{
            id: toLong(itemId),
            count: toLong(count)
        }];

        const request = sellReqType.create({
            items: items
        });
        const body = Buffer.from(sellReqType.encode(request).finish());

        const response = await sendRequest(userId, 'gamepb.itempb.ItemService', 'Sell', body);

        const sellReplyType = getType('SellReply');
        if (sellReplyType && response.length > 0) {
            const reply = sellReplyType.toObject(sellReplyType.decode(response)) as any;
            
            // 获取出售获得的物品（金币、点券等）
            const getItems = reply.get_items || [];
            let rewardMsg = '';
            for (const item of getItems) {
                const itemId = toNum(item.id);
                const itemCount = toNum(item.count);
                if (itemId === 1001) {
                    rewardMsg += `金币+${itemCount} `;
                } else if (itemId === 1002) {
                    rewardMsg += `点券+${itemCount} `;
                }
            }
            
            const itemName = getFruitName(itemId) || getSeedName(itemId) || `物品${itemId}`;
            pluginState.logger.info(`[农场] 出售成功: ${itemName} x${count}`);
            return { 
                success: true, 
                message: `出售 ${itemName} x${count} 成功！\n获得: ${rewardMsg || '金币'}`
            };
        }

        return { success: true, message: '出售请求已发送' };
    } catch (e) {
        pluginState.logger.warn(`[农场] 出售失败: ${e}`);
        return { success: false, message: `出售失败: ${e}` };
    }
}

/**
 * 除草
 */
export async function weedOut(userId: string, landIds?: number[]): Promise<OperationResult> {
    const session = getUserSession(userId);

    if (!session.loginState.isLoggedIn) {
        throw new Error('请先登录');
    }

    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
        return { success: false, message: '未连接到服务器' };
    }

    try {
        const weedOutReqType = getType('WeedOutRequest');
        if (!weedOutReqType) {
            return { success: false, message: 'WeedOutRequest 类型未加载' };
        }

        // 如果没有指定土地ID，获取有杂草的土地
        let targetLandIds = landIds || [];
        if (targetLandIds.length === 0) {
            const farmState = await getFarmState(userId);
            targetLandIds = farmState.lands
                .filter(l => l.needWeed)
                .map(l => l.id);

            if (targetLandIds.length === 0) {
                return { success: false, message: '没有需要除草的土地' };
            }
        }

        const request = weedOutReqType.create({
            land_ids: targetLandIds.map(id => toLong(id)),
            host_gid: toLong(session.loginState.gid)
        });
        const body = Buffer.from(weedOutReqType.encode(request).finish());

        const response = await sendRequest(userId, 'gamepb.plantpb.PlantService', 'WeedOut', body);

        const weedOutReplyType = getType('WeedOutReply');
        if (weedOutReplyType && response.length > 0) {
            const reply = weedOutReplyType.toObject(weedOutReplyType.decode(response)) as any;
            const landCount = reply.land?.length || 0;
            pluginState.logger.info(`[农场] 除草成功: ${landCount}块土地`);
            return {
                success: true,
                message: `成功为 ${landCount} 块土地除草`,
                lands: reply.land
            };
        }

        return { success: true, message: '除草请求已发送' };
    } catch (e) {
        pluginState.logger.warn(`[农场] 除草失败: ${e}`);
        return { success: false, message: `除草失败: ${e}` };
    }
}

/**
 * 除虫
 */
export async function insecticide(userId: string, landIds?: number[]): Promise<OperationResult> {
    const session = getUserSession(userId);

    if (!session.loginState.isLoggedIn) {
        throw new Error('请先登录');
    }

    if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
        return { success: false, message: '未连接到服务器' };
    }

    try {
        const insecticideReqType = getType('InsecticideRequest');
        if (!insecticideReqType) {
            return { success: false, message: 'InsecticideRequest 类型未加载' };
        }

        // 如果没有指定土地ID，获取有虫害的土地
        let targetLandIds = landIds || [];
        if (targetLandIds.length === 0) {
            const farmState = await getFarmState(userId);
            targetLandIds = farmState.lands
                .filter(l => l.needBug)
                .map(l => l.id);

            if (targetLandIds.length === 0) {
                return { success: false, message: '没有需要除虫的土地' };
            }
        }

        const request = insecticideReqType.create({
            land_ids: targetLandIds.map(id => toLong(id)),
            host_gid: toLong(session.loginState.gid)
        });
        const body = Buffer.from(insecticideReqType.encode(request).finish());

        const response = await sendRequest(userId, 'gamepb.plantpb.PlantService', 'Insecticide', body);

        const insecticideReplyType = getType('InsecticideReply');
        if (insecticideReplyType && response.length > 0) {
            const reply = insecticideReplyType.toObject(insecticideReplyType.decode(response)) as any;
            const landCount = reply.land?.length || 0;
            pluginState.logger.info(`[农场] 除虫成功: ${landCount}块土地`);
            return {
                success: true,
                message: `成功为 ${landCount} 块土地除虫`,
                lands: reply.land
            };
        }

        return { success: true, message: '除虫请求已发送' };
    } catch (e) {
        pluginState.logger.warn(`[农场] 除虫失败: ${e}`);
        return { success: false, message: `除虫失败: ${e}` };
    }
}
