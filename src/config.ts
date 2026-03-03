/**
 * 插件配置模块
 * 定义默认配置值和 WebUI 配置 Schema
 */

import type { NapCatPluginContext, PluginConfigSchema } from 'napcat-types/napcat-onebot/network/plugin/types';
import type { PluginConfig } from './types';

/** 默认配置 */
export const DEFAULT_CONFIG: PluginConfig = {
    enabled: true,
    debug: false,
    commandPrefix: '我的农场',
    loginCommand: '登录',
    bagCommandPrefix: '我的背包',
    harvestCommand: '收获',
    removeCommand: '铲除',
    plantCommand: '种植',
    upgradeCommand: '升级土地',
    unlockCommand: '扩建土地',
    matureCommand: '成熟时间',
    warehouseCommand: '我的仓库',
    shopCommand: '购买种子',
    seedListCommand: '种子列表',
    sellCommand: '出售',
    weedCommand: '除草',
    bugCommand: '除虫',
    menuCommand: '菜单',
    cooldownSeconds: 30,
    groupConfigs: {},
    farmServerUrl: 'wss://gate-obt.nqf.qq.com:443/websocket',
    loginTimeout: 120,
};

/**
 * 构建 WebUI 配置 Schema
 */
export function buildConfigSchema(ctx: NapCatPluginContext): PluginConfigSchema {
    return ctx.NapCatConfig.combine(
        // 插件信息头部
        ctx.NapCatConfig.html(`
            <div style="padding: 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; margin-bottom: 20px; color: white;">
                <h3 style="margin: 0 0 6px 0; font-size: 18px; font-weight: 600;">QQ农场查询插件</h3>
                <p style="margin: 0; font-size: 13px; opacity: 0.85;">扫码登录后查看农场状态、背包物品、成熟时间等</p>
                <p style="margin: 4px 0 0 0; font-size: 12px; opacity: 0.7;">作者：鲁班</p>
            </div>
        `),
        // 全局开关
        ctx.NapCatConfig.boolean('enabled', '启用插件', true, '是否启用此插件的功能'),
        // 调试模式
        ctx.NapCatConfig.boolean('debug', '调试模式', false, '启用后将输出详细的调试日志'),
        // 登录命令
        ctx.NapCatConfig.text('loginCommand', '登录命令', '登录', '发送此命令扫码登录农场'),
        // 命令前缀
        ctx.NapCatConfig.text('commandPrefix', '农场命令', '我的农场', '发送此命令触发农场查询'),
        // 背包命令前缀
        ctx.NapCatConfig.text('bagCommandPrefix', '背包命令', '我的背包', '发送此命令触发背包查询'),
        // 操作命令
        ctx.NapCatConfig.text('harvestCommand', '收获命令', '收获', '收获所有成熟作物'),
        ctx.NapCatConfig.text('removeCommand', '铲除命令', '铲除', '铲除枯萎的植物'),
        ctx.NapCatConfig.text('plantCommand', '种植命令', '种植', '格式: 种植 种子ID (在所有空地种植)'),
        ctx.NapCatConfig.text('upgradeCommand', '升级命令', '升级土地', '格式: 升级土地 土地ID'),
        ctx.NapCatConfig.text('unlockCommand', '扩建命令', '扩建土地', '格式: 扩建土地 土地ID'),
        ctx.NapCatConfig.text('matureCommand', '成熟时间命令', '成熟时间', '查询作物成熟时间'),
        ctx.NapCatConfig.text('warehouseCommand', '仓库命令', '我的仓库', '查看仓库存储的作物'),
        ctx.NapCatConfig.text('shopCommand', '商店命令', '购买种子', '查看种子商店'),
        ctx.NapCatConfig.text('seedListCommand', '种子列表命令', '种子列表', '查看所有种子ID'),
        ctx.NapCatConfig.text('sellCommand', '出售命令', '出售', '格式: 出售 物品ID 数量'),
        ctx.NapCatConfig.text('weedCommand', '除草命令', '除草', '清除所有土地的杂草'),
        ctx.NapCatConfig.text('bugCommand', '除虫命令', '除虫', '清除所有土地的虫害'),
        ctx.NapCatConfig.text('menuCommand', '菜单命令', '菜单', '显示所有可用命令'),
        // 冷却时间
        ctx.NapCatConfig.number('cooldownSeconds', '冷却时间（秒）', 30, '同一命令请求冷却时间，0 表示不限制'),
        // 登录超时
        ctx.NapCatConfig.number('loginTimeout', '登录超时（秒）', 120, '扫码登录的超时时间')
    );
}
