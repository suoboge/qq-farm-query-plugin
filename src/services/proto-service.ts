/**
 * Proto 服务模块
 * 加载 proto 文件并提供消息编解码
 */

import protobuf from 'protobufjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pluginState } from '../core/state';

// 导出 protobuf 实例供其他模块使用
export { protobuf };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Proto 文件目录
// 开发时: src/services -> ../../proto
// 构建后: dist -> ./proto
const PROTO_DIR = fs.existsSync(path.join(__dirname, '../../proto/game.proto'))
    ? path.join(__dirname, '../../proto')  // 开发环境
    : path.join(__dirname, 'proto');        // 构建后环境

let root: protobuf.Root | null = null;
const types: Record<string, protobuf.Type> = {};

// Proto 类型映射
const typeMappings = [
    // 网关
    ['GateMessage', 'gatepb.Message'],
    ['GateMeta', 'gatepb.Meta'],
    ['EventMessage', 'gatepb.EventMessage'],
    // 核心
    ['ItemBag', 'corepb.ItemBag'],
    ['Item', 'corepb.Item'],
    // 用户
    ['LoginRequest', 'gamepb.userpb.LoginRequest'],
    ['LoginReply', 'gamepb.userpb.LoginReply'],
    ['HeartbeatRequest', 'gamepb.userpb.HeartbeatRequest'],
    ['HeartbeatReply', 'gamepb.userpb.HeartbeatReply'],
    ['BasicNotify', 'gamepb.userpb.BasicNotify'],
    // 农场
    ['AllLandsRequest', 'gamepb.plantpb.AllLandsRequest'],
    ['AllLandsReply', 'gamepb.plantpb.AllLandsReply'],
    ['HarvestRequest', 'gamepb.plantpb.HarvestRequest'],
    ['HarvestReply', 'gamepb.plantpb.HarvestReply'],
    ['PlantRequest', 'gamepb.plantpb.PlantRequest'],
    ['PlantReply', 'gamepb.plantpb.PlantReply'],
    ['RemovePlantRequest', 'gamepb.plantpb.RemovePlantRequest'],
    ['RemovePlantReply', 'gamepb.plantpb.RemovePlantReply'],
    ['UpgradeLandRequest', 'gamepb.plantpb.UpgradeLandRequest'],
    ['UpgradeLandReply', 'gamepb.plantpb.UpgradeLandReply'],
    ['UnlockLandRequest', 'gamepb.plantpb.UnlockLandRequest'],
    ['UnlockLandReply', 'gamepb.plantpb.UnlockLandReply'],
    // 除草/除虫
    ['WeedOutRequest', 'gamepb.plantpb.WeedOutRequest'],
    ['WeedOutReply', 'gamepb.plantpb.WeedOutReply'],
    ['InsecticideRequest', 'gamepb.plantpb.InsecticideRequest'],
    ['InsecticideReply', 'gamepb.plantpb.InsecticideReply'],
    // 背包
    ['BagRequest', 'gamepb.itempb.BagRequest'],
    ['BagReply', 'gamepb.itempb.BagReply'],
    // 商店
    ['ShopInfoRequest', 'gamepb.shoppb.ShopInfoRequest'],
    ['ShopInfoReply', 'gamepb.shoppb.ShopInfoReply'],
];

/**
 * 加载 proto 文件
 */
export async function loadProtos(): Promise<void> {
    if (root) return;
    
    try {
        root = new protobuf.Root();
        
        // 设置文件系统适配器，让 protobufjs 使用 fs 模块
        root.resolvePath = function(origin, target) {
            // 解析 import 路径
            const resolved = path.resolve(PROTO_DIR, target);
            if (fs.existsSync(resolved)) {
                return resolved;
            }
            return target;
        };
        
        // 获取所有 proto 文件
        const protoFiles = fs.readdirSync(PROTO_DIR)
            .filter(f => f.endsWith('.proto'))
            .map(f => path.join(PROTO_DIR, f));
        
        // 同步读取并解析每个 proto 文件
        for (const filePath of protoFiles) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                protobuf.parse(content, root, { 
                    keepCase: true,
                    filename: filePath 
                });
            } catch (parseErr) {
                pluginState.logger.debug(`[Proto] 解析 ${path.basename(filePath)}: ${parseErr}`);
            }
        }
        
        // 注册类型
        let loadedCount = 0;
        for (const [name, fullName] of typeMappings) {
            try {
                const type = root!.lookupType(fullName);
                if (type) {
                    types[name] = type;
                    loadedCount++;
                }
            } catch (e) {
                pluginState.logger.warn(`[Proto] 类型未找到: ${fullName}`);
            }
        }
        
        pluginState.logger.info(`[Proto] Proto 加载完成 (${loadedCount} 个类型)`);
    } catch (e) {
        pluginState.logger.error('[Proto] 加载失败:', e);
    }
}

/**
 * 获取类型
 */
export function getType(name: string): protobuf.Type | null {
    return types[name] || null;
}

/**
 * 编码消息
 */
export function encode(typeName: string, obj: Record<string, unknown>): Buffer {
    const type = types[typeName];
    if (!type) {
        throw new Error(`未知类型: ${typeName}`);
    }
    const message = type.create(obj);
    return Buffer.from(type.encode(message).finish());
}

/**
 * 解码消息
 */
export function decode(typeName: string, data: Buffer): Record<string, unknown> {
    const type = types[typeName];
    if (!type) {
        throw new Error(`未知类型: ${typeName}`);
    }
    const decoded = type.decode(data);
    return type.toObject(decoded) as Record<string, unknown>;
}

// 工具函数
export function toLong(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return parseInt(value, 10);
    if (value && typeof value === 'object') {
        const v = value as { low?: number; high?: number; unsigned?: boolean };
        if (typeof v.low === 'number') return v.low;
    }
    return 0;
}

export function toNum(value: unknown): number {
    if (typeof value === 'number') return Math.floor(value);
    if (typeof value === 'string') return parseInt(value, 10) || 0;
    return 0;
}
