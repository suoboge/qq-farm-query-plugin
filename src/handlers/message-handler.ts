/**
 * 消息处理器
 *
 * 处理接收到的 QQ 消息事件，包含：
 * - 命令解析与分发
 * - CD 冷却管理
 * - 消息发送工具函数
 * - 农场查询命令处理
 */

import type { OB11Message, OB11PostSendMsg } from 'napcat-types/napcat-onebot';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin/types';
import { pluginState } from '../core/state';
import {
    startQRLogin,
    waitForScan,
    getFarmState,
    getBagState,
    getWarehouseState,
    getShopState,
    isLoggedIn,
    getLoginState,
    logout,
    harvest,
    plant,
    removePlant,
    upgradeLand,
    unlockLand,
    sellItems,
    weedOut,
    insecticide,
    OperationResult
} from '../services/farm-service';
import {
    formatQRCodeMessage,
    formatFarmStateMessage,
    formatBagStateMessage,
    formatLoginSuccessMessage,
    formatMatureTimeMessage,
    formatWarehouseMessage,
    formatShopMessage,
    formatSeedListMessage,
    formatErrorMessage,
    formatTime
} from '../services/message-formatter';

// ==================== CD 冷却管理 ====================

/** CD 冷却记录 key: `${groupId}:${command}`, value: 过期时间戳 */
const cooldownMap = new Map<string, number>();

/**
 * 检查是否在 CD 中
 * @returns 剩余秒数，0 表示可用
 */
function getCooldownRemaining(groupId: number | string, command: string): number {
    const cdSeconds = pluginState.config.cooldownSeconds ?? 30;
    if (cdSeconds <= 0) return 0;

    const key = `${groupId}:${command}`;
    const expireTime = cooldownMap.get(key);
    if (!expireTime) return 0;

    const remaining = Math.ceil((expireTime - Date.now()) / 1000);
    if (remaining <= 0) {
        cooldownMap.delete(key);
        return 0;
    }
    return remaining;
}

/** 设置 CD 冷却 */
function setCooldown(groupId: number | string, command: string): void {
    const cdSeconds = pluginState.config.cooldownSeconds ?? 30;
    if (cdSeconds <= 0) return;
    cooldownMap.set(`${groupId}:${command}`, Date.now() + cdSeconds * 1000);
}

// ==================== 消息发送工具 ====================

/**
 * 发送消息（通用）
 */
export async function sendReply(
    ctx: NapCatPluginContext,
    event: OB11Message,
    message: OB11PostSendMsg['message']
): Promise<boolean> {
    try {
        const params: OB11PostSendMsg = {
            message,
            message_type: event.message_type,
            ...(event.message_type === 'group' && event.group_id
                ? { group_id: String(event.group_id) }
                : {}),
            ...(event.message_type === 'private' && event.user_id
                ? { user_id: String(event.user_id) }
                : {}),
        };
        await ctx.actions.call('send_msg', params, ctx.adapterName, ctx.pluginManager.config);
        return true;
    } catch (error) {
        pluginState.logger.error('发送消息失败:', error);
        return false;
    }
}

/**
 * 发送群消息
 */
export async function sendGroupMessage(
    ctx: NapCatPluginContext,
    groupId: number | string,
    message: OB11PostSendMsg['message']
): Promise<boolean> {
    try {
        const params: OB11PostSendMsg = {
            message,
            message_type: 'group',
            group_id: String(groupId),
        };
        await ctx.actions.call('send_msg', params, ctx.adapterName, ctx.pluginManager.config);
        return true;
    } catch (error) {
        pluginState.logger.error('发送群消息失败:', error);
        return false;
    }
}

/**
 * 发送私聊消息
 */
export async function sendPrivateMessage(
    ctx: NapCatPluginContext,
    userId: number | string,
    message: OB11PostSendMsg['message']
): Promise<boolean> {
    try {
        const params: OB11PostSendMsg = {
            message,
            message_type: 'private',
            user_id: String(userId),
        };
        await ctx.actions.call('send_msg', params, ctx.adapterName, ctx.pluginManager.config);
        return true;
    } catch (error) {
        pluginState.logger.error('发送私聊消息失败:', error);
        return false;
    }
}

// ==================== 合并转发消息 ====================

/** 合并转发消息节点 */
export interface ForwardNode {
    type: 'node';
    data: {
        nickname: string;
        user_id?: string;
        content: Array<{ type: string; data: Record<string, unknown> }>;
    };
}

/**
 * 发送合并转发消息
 */
export async function sendForwardMsg(
    ctx: NapCatPluginContext,
    target: number | string,
    isGroup: boolean,
    nodes: ForwardNode[],
): Promise<boolean> {
    try {
        const actionName = isGroup ? 'send_group_forward_msg' : 'send_private_forward_msg';
        const params: Record<string, unknown> = { message: nodes };
        if (isGroup) {
            params.group_id = String(target);
        } else {
            params.user_id = String(target);
        }
        await ctx.actions.call(
            actionName as 'send_group_forward_msg',
            params as never,
            ctx.adapterName,
            ctx.pluginManager.config,
        );
        return true;
    } catch (error) {
        pluginState.logger.error('发送合并转发消息失败:', error);
        return false;
    }
}

// ==================== 权限检查 ====================

/**
 * 检查群聊中是否有管理员权限
 */
export function isAdmin(event: OB11Message): boolean {
    if (event.message_type !== 'group') return true;
    const role = (event.sender as Record<string, unknown>)?.role;
    return role === 'admin' || role === 'owner';
}

// ==================== 登录等待队列 ====================

/** 正在等待扫码的用户 */
const pendingLogins = new Map<string, boolean>();

// ==================== 消息处理主函数 ====================

/**
 * 消息处理主函数
 */
export async function handleMessage(ctx: NapCatPluginContext, event: OB11Message): Promise<void> {
    try {
        const rawMessage = event.raw_message || '';
        const messageType = event.message_type;
        const groupId = event.group_id;
        const userId = String(event.user_id);

        pluginState.ctx.logger.debug(`收到消息: ${rawMessage} | 类型: ${messageType}`);

        // 群消息：检查该群是否启用
        if (messageType === 'group' && groupId) {
            if (!pluginState.isGroupEnabled(String(groupId))) return;
        }

        // 获取命令配置
        const loginPrefix = pluginState.config.loginCommand || '登录';
        const farmPrefix = pluginState.config.commandPrefix || '我的农场';
        const bagPrefix = pluginState.config.bagCommandPrefix || '我的背包';
        const harvestPrefix = pluginState.config.harvestCommand || '收获';
        const removePrefix = pluginState.config.removeCommand || '铲除';
        const plantPrefix = pluginState.config.plantCommand || '种植';
        const upgradePrefix = pluginState.config.upgradeCommand || '升级土地';
        const unlockPrefix = pluginState.config.unlockCommand || '扩建土地';
        const maturePrefix = pluginState.config.matureCommand || '成熟时间';
        const warehousePrefix = pluginState.config.warehouseCommand || '我的仓库';
        const shopPrefix = pluginState.config.shopCommand || '购买种子';
        const seedListPrefix = pluginState.config.seedListCommand || '种子列表';
        const sellPrefix = pluginState.config.sellCommand || '出售';
        const weedPrefix = pluginState.config.weedCommand || '除草';
        const bugPrefix = pluginState.config.bugCommand || '除虫';
        const menuPrefix = pluginState.config.menuCommand || '菜单';

        // 判断命令类型
        let commandType: 'login' | 'farm' | 'bag' | 'harvest' | 'remove' | 'plant' | 'upgrade' | 'unlock' | 'mature' | 'warehouse' | 'shop' | 'seedlist' | 'sell' | 'weed' | 'bug' | 'menu' | null = null;

        if (rawMessage.includes(loginPrefix)) commandType = 'login';
        else if (rawMessage.includes(farmPrefix)) commandType = 'farm';
        else if (rawMessage.includes(bagPrefix)) commandType = 'bag';
        else if (rawMessage.includes(warehousePrefix)) commandType = 'warehouse';
        else if (rawMessage.includes(shopPrefix)) commandType = 'shop';
        else if (rawMessage.includes(seedListPrefix)) commandType = 'seedlist';
        else if (rawMessage.includes(sellPrefix)) commandType = 'sell';
        else if (rawMessage.includes(harvestPrefix)) commandType = 'harvest';
        else if (rawMessage.includes(removePrefix)) commandType = 'remove';
        else if (rawMessage.includes(plantPrefix)) commandType = 'plant';
        else if (rawMessage.includes(upgradePrefix)) commandType = 'upgrade';
        else if (rawMessage.includes(unlockPrefix)) commandType = 'unlock';
        else if (rawMessage.includes(maturePrefix)) commandType = 'mature';
        else if (rawMessage.includes(weedPrefix)) commandType = 'weed';
        else if (rawMessage.includes(bugPrefix)) commandType = 'bug';
        else if (rawMessage.includes(menuPrefix)) commandType = 'menu';
        
        if (!commandType) return;

        // 群消息检查 CD
        if (messageType === 'group' && groupId) {
            const remaining = getCooldownRemaining(groupId, commandType);
            if (remaining > 0) {
                await sendReply(ctx, event, `操作太频繁啦，请等待 ${remaining} 秒后再试`);
                return;
            }
        }

        // 根据命令类型分发处理
        switch (commandType) {
            case 'login':
                await handleLoginCommand(ctx, event, userId, groupId);
                break;
            case 'bag':
                await handleBagCommand(ctx, event, userId, groupId);
                break;
            case 'harvest':
                await handleHarvestCommand(ctx, event, userId, groupId);
                break;
            case 'remove':
                await handleRemoveCommand(ctx, event, userId, groupId);
                break;
            case 'plant':
                await handlePlantCommand(ctx, event, userId, groupId, rawMessage);
                break;
            case 'upgrade':
                await handleUpgradeCommand(ctx, event, userId, groupId, rawMessage);
                break;
            case 'unlock':
                await handleUnlockCommand(ctx, event, userId, groupId, rawMessage);
                break;
            case 'mature':
                await handleMatureCommand(ctx, event, userId, groupId);
                break;
            case 'warehouse':
                await handleWarehouseCommand(ctx, event, userId, groupId);
                break;
            case 'shop':
                await handleShopCommand(ctx, event, userId, groupId);
                break;
            case 'seedlist':
                await handleSeedListCommand(ctx, event);
                break;
            case 'sell':
                await handleSellCommand(ctx, event, userId, groupId, rawMessage);
                break;
            case 'weed':
                await handleWeedCommand(ctx, event, userId, groupId);
                break;
            case 'bug':
                await handleBugCommand(ctx, event, userId, groupId);
                break;
            case 'menu':
                await handleMenuCommand(ctx, event);
                break;
            default:
                await handleFarmCommand(ctx, event, userId, groupId);
        }

    } catch (error) {
        pluginState.logger.error('处理消息时出错:', error);
    }
}

/**
 * 处理农场命令
 */
async function handleFarmCommand(
    ctx: NapCatPluginContext, 
    event: OB11Message, 
    userId: string, 
    groupId: number | undefined
): Promise<void> {
    try {
        // 检查是否已登录
        if (!isLoggedIn(userId)) {
            await sendReply(ctx, event, '请先发送"登录"完成登录后再查询农场');
            return;
        }

        // 已登录，直接查询农场状态（不显示提示）
        const farmState = await getFarmState(userId);

        // 发送农场状态
        const farmMessage = formatFarmStateMessage(farmState);
        await sendReply(ctx, event, farmMessage);

        // 设置CD
        if (groupId) setCooldown(groupId, 'farm');
        pluginState.incrementProcessed();

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        pluginState.logger.error('农场命令处理失败:', error);
        const errorMessage = formatErrorMessage(errorMsg);
        await sendReply(ctx, event, errorMessage);
    }
}

/**
 * 处理成熟时间命令
 */
async function handleMatureCommand(
    ctx: NapCatPluginContext, 
    event: OB11Message, 
    userId: string, 
    groupId: number | undefined
): Promise<void> {
    try {
        // 检查是否已登录
        if (!isLoggedIn(userId)) {
            await sendReply(ctx, event, '请先发送"登录"完成登录后再查询成熟时间');
            return;
        }

        // 获取农场状态
        const farmState = await getFarmState(userId);

        // 发送成熟时间消息
        const matureMessage = formatMatureTimeMessage(farmState);
        await sendReply(ctx, event, matureMessage);

        // 设置CD
        if (groupId) setCooldown(groupId, 'mature');
        pluginState.incrementProcessed();

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        pluginState.logger.error('成熟时间命令处理失败:', error);
        const errorMessage = formatErrorMessage(errorMsg);
        await sendReply(ctx, event, errorMessage);
    }
}

/**
 * 处理仓库命令
 */
async function handleWarehouseCommand(
    ctx: NapCatPluginContext, 
    event: OB11Message, 
    userId: string, 
    groupId: number | undefined
): Promise<void> {
    try {
        // 检查是否已登录
        if (!isLoggedIn(userId)) {
            await sendReply(ctx, event, '请先发送"登录"完成登录后再查看仓库');
            return;
        }

        // 获取仓库状态
        const warehouseState = await getWarehouseState(userId);
        const loginState = getLoginState(userId);

        // 发送仓库消息
        const warehouseMessage = formatWarehouseMessage(loginState.name, warehouseState.items, warehouseState.gold);
        await sendReply(ctx, event, warehouseMessage);

        // 设置CD
        if (groupId) setCooldown(groupId, 'warehouse');
        pluginState.incrementProcessed();

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        pluginState.logger.error('仓库命令处理失败:', error);
        const errorMessage = formatErrorMessage(errorMsg);
        await sendReply(ctx, event, errorMessage);
    }
}

/**
 * 处理商店命令
 */
async function handleShopCommand(
    ctx: NapCatPluginContext, 
    event: OB11Message, 
    userId: string, 
    groupId: number | undefined
): Promise<void> {
    try {
        // 检查是否已登录
        if (!isLoggedIn(userId)) {
            await sendReply(ctx, event, '请先发送"登录"完成登录后再查看商店');
            return;
        }

        // 获取商店状态
        const shopState = await getShopState(userId);
        const loginState = getLoginState(userId);

        // 发送商店消息
        const shopMessage = formatShopMessage(loginState.name, shopState.items, shopState.gold);
        await sendReply(ctx, event, shopMessage);

        // 设置CD
        if (groupId) setCooldown(groupId, 'shop');
        pluginState.incrementProcessed();

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        pluginState.logger.error('商店命令处理失败:', error);
        const errorMessage = formatErrorMessage(errorMsg);
        await sendReply(ctx, event, errorMessage);
    }
}

/**
 * 处理种子列表命令（无需登录）
 */
async function handleSeedListCommand(
    ctx: NapCatPluginContext, 
    event: OB11Message
): Promise<void> {
    try {
        // 发送种子列表（无需登录）
        const seedListMessage = formatSeedListMessage();
        await sendReply(ctx, event, seedListMessage);

        pluginState.incrementProcessed();

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        pluginState.logger.error('种子列表命令处理失败:', error);
        const errorMessage = formatErrorMessage(errorMsg);
        await sendReply(ctx, event, errorMessage);
    }
}

/**
 * 处理出售命令
 * 格式: 出售 物品ID 数量
 */
async function handleSellCommand(
    ctx: NapCatPluginContext, 
    event: OB11Message, 
    userId: string, 
    groupId: number | undefined,
    rawMessage: string
): Promise<void> {
    try {
        // 检查是否已登录
        if (!isLoggedIn(userId)) {
            await sendReply(ctx, event, '请先发送"登录"完成登录后再出售物品');
            return;
        }

        // 解析命令参数
        const parts = rawMessage.replace(/^出售\s*/, '').trim().split(/\s+/);
        if (parts.length < 2) {
            await sendReply(ctx, event, '格式错误！请使用: 出售 物品ID 数量\n例如: 出售 30001 10');
            return;
        }

        const itemId = parseInt(parts[0], 10);
        const count = parseInt(parts[1], 10);

        if (isNaN(itemId) || isNaN(count) || itemId <= 0 || count <= 0) {
            await sendReply(ctx, event, '物品ID和数量必须是正整数');
            return;
        }

        // 发送出售请求
        const result = await sellItems(userId, itemId, count);

        if (result.success) {
            await sendReply(ctx, event, `✅ ${result.message}`);
        } else {
            await sendReply(ctx, event, `❌ ${result.message}`);
        }

        // 设置CD
        if (groupId) setCooldown(groupId, 'sell');
        pluginState.incrementProcessed();

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        pluginState.logger.error('出售命令处理失败:', error);
        const errorMessage = formatErrorMessage(errorMsg);
        await sendReply(ctx, event, errorMessage);
    }
}

/**
 * 处理登录命令
 */
async function handleLoginCommand(
    ctx: NapCatPluginContext, 
    event: OB11Message, 
    userId: string, 
    groupId: number | undefined
): Promise<void> {
    try {
        // 检查是否已登录
        if (isLoggedIn(userId)) {
            const loginState = getLoginState(userId);
            await sendReply(ctx, event, `您已登录为 ${loginState.name}，无需重复登录`);
            return;
        }

        // 检查是否正在登录中
        if (pendingLogins.get(userId)) {
            await sendReply(ctx, event, '您正在等待扫码登录中，请先完成扫码或等待超时');
            return;
        }

        pendingLogins.set(userId, true);

        try {
            // 发送二维码
            const qrSession = await startQRLogin(userId);
            const qrMessage = formatQRCodeMessage(qrSession);
            await sendReply(ctx, event, qrMessage);

            // 等待扫码
            const loginState = await waitForScan(userId, pluginState.config.loginTimeout * 1000);

            // 扫码成功
            const successMessage = formatLoginSuccessMessage(loginState.name);
            await sendReply(ctx, event, successMessage);

            // 设置CD
            if (groupId) setCooldown(groupId, 'login');
            pluginState.incrementProcessed();

        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : '登录失败';
            const errorMessage = formatErrorMessage(errorMsg);
            await sendReply(ctx, event, errorMessage);
        } finally {
            pendingLogins.delete(userId);
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        pluginState.logger.error('登录命令处理失败:', error);
        const errorMessage = formatErrorMessage(errorMsg);
        await sendReply(ctx, event, errorMessage);
    }
}

/**
 * 处理背包命令
 */
async function handleBagCommand(
    ctx: NapCatPluginContext, 
    event: OB11Message, 
    userId: string, 
    groupId: number | undefined
): Promise<void> {
    try {
        // 检查是否已登录
        if (!isLoggedIn(userId)) {
            await sendReply(ctx, event, '请先发送"登录"完成登录后再查询背包');
            return;
        }

        // 已登录，直接查询背包状态
        await sendReply(ctx, event, '正在查询背包数据...');

        const bagState = await getBagState(userId);

        // 发送背包状态
        const bagMessage = formatBagStateMessage(bagState);
        await sendReply(ctx, event, bagMessage);

        // 设置CD
        if (groupId) setCooldown(groupId, 'bag');
        pluginState.incrementProcessed();

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        pluginState.logger.error('背包命令处理失败:', error);
        const errorMessage = formatErrorMessage(errorMsg);
        await sendReply(ctx, event, errorMessage);
    }
}

/**
 * 处理收获命令
 */
async function handleHarvestCommand(
    ctx: NapCatPluginContext, 
    event: OB11Message, 
    userId: string, 
    groupId: number | undefined
): Promise<void> {
    try {
        if (!isLoggedIn(userId)) {
            await sendReply(ctx, event, '请先发送"登录"完成登录');
            return;
        }

        await sendReply(ctx, event, '正在收获作物...');
        const result = await harvest(userId);

        if (result.success) {
            await sendReply(ctx, event, `✅ ${result.message}`);
        } else {
            await sendReply(ctx, event, `❌ ${result.message}`);
        }

        if (groupId) setCooldown(groupId, 'harvest');
        pluginState.incrementProcessed();
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        await sendReply(ctx, event, formatErrorMessage(errorMsg));
    }
}

/**
 * 处理铲除命令
 */
async function handleRemoveCommand(
    ctx: NapCatPluginContext, 
    event: OB11Message, 
    userId: string, 
    groupId: number | undefined
): Promise<void> {
    try {
        if (!isLoggedIn(userId)) {
            await sendReply(ctx, event, '请先发送"登录"完成登录');
            return;
        }

        await sendReply(ctx, event, '正在铲除枯萎植物...');
        const result = await removePlant(userId);

        if (result.success) {
            await sendReply(ctx, event, `✅ ${result.message}`);
        } else {
            await sendReply(ctx, event, `❌ ${result.message}`);
        }

        if (groupId) setCooldown(groupId, 'remove');
        pluginState.incrementProcessed();
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        await sendReply(ctx, event, formatErrorMessage(errorMsg));
    }
}

/**
 * 处理种植命令
 * 格式: 种植 种子ID
 */
async function handlePlantCommand(
    ctx: NapCatPluginContext, 
    event: OB11Message, 
    userId: string, 
    groupId: number | undefined,
    rawMessage: string
): Promise<void> {
    try {
        if (!isLoggedIn(userId)) {
            await sendReply(ctx, event, '请先发送"登录"完成登录');
            return;
        }

        const plantPrefix = pluginState.config.plantCommand || '种植';
        const parts = rawMessage.split(/\s+/);
        const prefixIndex = parts.findIndex(p => p.includes(plantPrefix));
        
        let seedId = 0;
        if (prefixIndex >= 0 && parts.length > prefixIndex + 1) {
            seedId = parseInt(parts[prefixIndex + 1]) || 0;
        }

        if (!seedId) {
            await sendReply(ctx, event, '请指定种子ID，格式: 种植 种子ID\n例如: 种植 20001\n\n💡 可先发送"我的背包"查看拥有的种子');
            return;
        }

        await sendReply(ctx, event, `正在种植种子(${seedId})...`);
        const result = await plant(userId, seedId);

        if (result.success) {
            await sendReply(ctx, event, `✅ ${result.message}`);
        } else {
            await sendReply(ctx, event, `❌ ${result.message}`);
        }

        if (groupId) setCooldown(groupId, 'plant');
        pluginState.incrementProcessed();
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        await sendReply(ctx, event, formatErrorMessage(errorMsg));
    }
}

/**
 * 处理升级土地命令
 * 格式: 升级土地 土地ID
 */
async function handleUpgradeCommand(
    ctx: NapCatPluginContext, 
    event: OB11Message, 
    userId: string, 
    groupId: number | undefined,
    rawMessage: string
): Promise<void> {
    try {
        if (!isLoggedIn(userId)) {
            await sendReply(ctx, event, '请先发送"登录"完成登录');
            return;
        }

        const upgradePrefix = pluginState.config.upgradeCommand || '升级土地';
        const parts = rawMessage.split(/\s+/);
        const prefixIndex = parts.findIndex(p => p.includes(upgradePrefix));
        
        let landId = 0;
        if (prefixIndex >= 0 && parts.length > prefixIndex + 1) {
            landId = parseInt(parts[prefixIndex + 1]) || 0;
        }

        if (!landId) {
            await sendReply(ctx, event, '请指定土地ID，格式: 升级土地 土地ID\n例如: 升级土地 1\n\n💡 发送"我的农场"可查看土地信息');
            return;
        }

        await sendReply(ctx, event, `正在升级土地 ${landId}...`);
        const result = await upgradeLand(userId, landId);

        if (result.success) {
            await sendReply(ctx, event, `✅ ${result.message}`);
        } else {
            await sendReply(ctx, event, `❌ ${result.message}`);
        }

        if (groupId) setCooldown(groupId, 'upgrade');
        pluginState.incrementProcessed();
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        await sendReply(ctx, event, formatErrorMessage(errorMsg));
    }
}

/**
 * 处理扩建土地命令
 * 格式: 扩建土地 土地ID
 */
async function handleUnlockCommand(
    ctx: NapCatPluginContext, 
    event: OB11Message, 
    userId: string, 
    groupId: number | undefined,
    rawMessage: string
): Promise<void> {
    try {
        if (!isLoggedIn(userId)) {
            await sendReply(ctx, event, '请先发送"登录"完成登录');
            return;
        }

        const unlockPrefix = pluginState.config.unlockCommand || '扩建土地';
        const parts = rawMessage.split(/\s+/);
        const prefixIndex = parts.findIndex(p => p.includes(unlockPrefix));
        
        let landId = 0;
        if (prefixIndex >= 0 && parts.length > prefixIndex + 1) {
            landId = parseInt(parts[prefixIndex + 1]) || 0;
        }

        if (!landId) {
            await sendReply(ctx, event, '请指定土地ID，格式: 扩建土地 土地ID\n例如: 扩建土地 7\n\n💡 发送"我的农场"可查看可解锁的土地');
            return;
        }

        await sendReply(ctx, event, `正在扩建土地 ${landId}...`);
        const result = await unlockLand(userId, landId);

        if (result.success) {
            await sendReply(ctx, event, `✅ ${result.message}`);
        } else {
            await sendReply(ctx, event, `❌ ${result.message}`);
        }

        if (groupId) setCooldown(groupId, 'unlock');
        pluginState.incrementProcessed();
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        await sendReply(ctx, event, formatErrorMessage(errorMsg));
    }
}

/**
 * 处理除草命令
 */
async function handleWeedCommand(
    ctx: NapCatPluginContext,
    event: OB11Message,
    userId: string,
    groupId: number | undefined
): Promise<void> {
    try {
        if (!isLoggedIn(userId)) {
            await sendReply(ctx, event, '请先发送"登录"完成登录');
            return;
        }

        await sendReply(ctx, event, '正在除草...');
        const result = await weedOut(userId);

        if (result.success) {
            await sendReply(ctx, event, `✅ ${result.message}`);
        } else {
            await sendReply(ctx, event, `❌ ${result.message}`);
        }

        if (groupId) setCooldown(groupId, 'weed');
        pluginState.incrementProcessed();
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        await sendReply(ctx, event, formatErrorMessage(errorMsg));
    }
}

/**
 * 处理除虫命令
 */
async function handleBugCommand(
    ctx: NapCatPluginContext,
    event: OB11Message,
    userId: string,
    groupId: number | undefined
): Promise<void> {
    try {
        if (!isLoggedIn(userId)) {
            await sendReply(ctx, event, '请先发送"登录"完成登录');
            return;
        }

        await sendReply(ctx, event, '正在除虫...');
        const result = await insecticide(userId);

        if (result.success) {
            await sendReply(ctx, event, `✅ ${result.message}`);
        } else {
            await sendReply(ctx, event, `❌ ${result.message}`);
        }

        if (groupId) setCooldown(groupId, 'bug');
        pluginState.incrementProcessed();
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        await sendReply(ctx, event, formatErrorMessage(errorMsg));
    }
}

/**
 * 处理菜单命令
 */
async function handleMenuCommand(
    ctx: NapCatPluginContext,
    event: OB11Message
): Promise<void> {
    try {
        const menuMessage = `📋 QQ农场插件菜单

🔐 登录相关：
  · 登录 - 扫码登录农场

🔍 查询功能：
  · 我的农场 - 查看农场状态
  · 我的背包 - 查看背包物品
  · 我的仓库 - 查看仓库作物
  · 成熟时间 - 查看作物成熟时间
  · 种子列表 - 查看所有种子ID

🌾 操作功能：
  · 收获 - 收获所有成熟作物
  · 种植 种子ID - 在空地种植
  · 铲除 - 铲除枯萎植物
  · 除草 - 清除杂草
  · 除虫 - 清除虫害

🏠 土地管理：
  · 升级土地 土地ID - 升级土地等级
  · 扩建土地 土地ID - 解锁新土地

💰 交易功能：
  · 购买种子 - 查看种子商店
  · 出售 物品ID 数量 - 出售物品

💡 提示：部分功能需要先登录才能使用`;

        await sendReply(ctx, event, menuMessage);
        pluginState.incrementProcessed();
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '未知错误';
        pluginState.logger.error('菜单命令处理失败:', error);
        await sendReply(ctx, event, formatErrorMessage(errorMsg));
    }
}
