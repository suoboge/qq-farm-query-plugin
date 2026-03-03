/**
 * 消息格式化模块
 * 生成美观的卡片消息
 */

import type { FarmState, BagState, QRLoginSession, BagItem } from '../types';
import type { ForwardNode } from '../handlers/message-handler';

// ==================== 种子ID数据 ====================

/** 种子ID列表 */
export const SEED_LIST: Record<number, { name: string; price: number; matureTime: string; yield: number }> = {
    20001: { name: '草莓', price: 50, matureTime: '3小时', yield: 2 },
    20002: { name: '西瓜', price: 80, matureTime: '6小时', yield: 3 },
    20003: { name: '胡萝卜', price: 20, matureTime: '1小时', yield: 2 },
    20004: { name: '玉米', price: 40, matureTime: '2小时', yield: 2 },
    20005: { name: '番茄', price: 30, matureTime: '1.5小时', yield: 2 },
    20006: { name: '茄子', price: 25, matureTime: '1.5小时', yield: 2 },
    20007: { name: '辣椒', price: 35, matureTime: '2小时', yield: 2 },
    20008: { name: '黄瓜', price: 28, matureTime: '1.5小时', yield: 2 },
    20009: { name: '豆角', price: 32, matureTime: '2小时', yield: 2 },
    20010: { name: '南瓜', price: 60, matureTime: '4小时', yield: 3 },
    20011: { name: '向日葵', price: 45, matureTime: '2.5小时', yield: 2 },
    20012: { name: '玫瑰', price: 100, matureTime: '5小时', yield: 2 },
    20013: { name: '郁金香', price: 80, matureTime: '4小时', yield: 2 },
    20014: { name: '百合', price: 120, matureTime: '6小时', yield: 2 },
    20015: { name: '康乃馨', price: 90, matureTime: '4.5小时', yield: 2 },
    20016: { name: '桃花', price: 150, matureTime: '8小时', yield: 2 },
    20017: { name: '樱花', price: 200, matureTime: '10小时', yield: 3 },
    20018: { name: '梅花', price: 180, matureTime: '9小时', yield: 2 },
    20019: { name: '牡丹', price: 250, matureTime: '12小时', yield: 3 },
    20020: { name: '兰花', price: 220, matureTime: '11小时', yield: 2 },
};

// ==================== 时间格式化 ====================

/**
 * 格式化剩余时间
 */
export function formatTime(seconds: number): string {
    if (seconds <= 0) return '已成熟';
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}小时${mins}分` : `${hours}小时`;
}

/**
 * 格式化数字（添加千分位）
 */
export function formatNumber(num: number): string {
    return num.toLocaleString('zh-CN');
}

// ==================== 登录二维码消息 ====================

/**
 * 生成登录二维码消息
 */
export function formatQRCodeMessage(qrSession: QRLoginSession): Array<{ type: string; data: Record<string, unknown> }> {
    const timeout = Math.floor((120000 - (Date.now() - qrSession.createdAt)) / 1000);
    
    // 检查二维码图片是否有效（data:image 开头或者是 http/https URL）
    const hasValidImage = qrSession.qrImage && 
        (qrSession.qrImage.startsWith('data:image') || qrSession.qrImage.startsWith('http'));
    
    const message: Array<{ type: string; data: Record<string, unknown> }> = [
        {
            type: 'text',
            data: { text: '━━━━━━━━━━━【QQ农场登录】━━━━━━━━━━━\n' }
        }
    ];

    // 如果有有效的二维码图片则发送图片
    if (hasValidImage) {
        message.push({
            type: 'image',
            data: { file: qrSession.qrImage }
        });
        message.push({
            type: 'text',
            data: { text: `\n━━━━━━━━━━━ 登录说明 ━━━━━━━━━━━\n📱 扫码上方二维码登录QQ农场\n🔗 或点击链接：${qrSession.qrUrl}\n\n⏰ 二维码有效期: ${Math.floor(timeout / 60)}分钟\n✅ 登录后即可查看农场状态\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` }
        });
    } else {
        // 如果没有图片，提供链接
        message.push({
            type: 'text',
            data: { text: `━━━━━━━━━━━【QQ农场登录】━━━━━━━━━━━\n\n📱 请扫码下方二维码登录\n🔗 或复制链接到手机QQ打开：\n${qrSession.qrUrl}\n\n⏰ 有效期: ${Math.floor(timeout / 60)}分钟\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` }
        });
    }

    return message;
}

// ==================== 农场状态消息 ====================

/**
 * 生成农场状态卡片消息
 */
export function formatFarmStateMessage(farmState: FarmState): Array<{ type: string; data: Record<string, unknown> }> {
    const { user, lands, summary } = farmState;
    
    // 构建状态文本
    const statusParts: string[] = [];
    if (summary.harvestable > 0) statusParts.push(`可收获: ${summary.harvestable}块`);
    if (summary.growing > 0) statusParts.push(`生长中: ${summary.growing}块`);
    if (summary.empty > 0) statusParts.push(`空地: ${summary.empty}块`);
    if (summary.dead > 0) statusParts.push(`枯萎: ${summary.dead}块`);
    
    const problemParts: string[] = [];
    if (summary.needWater > 0) problemParts.push(`需浇水: ${summary.needWater}`);
    if (summary.needWeed > 0) problemParts.push(`需除草: ${summary.needWeed}`);
    if (summary.needBug > 0) problemParts.push(`需除虫: ${summary.needBug}`);

    // 构建可收获作物列表
    const harvestableLands = lands.filter(l => l.status === 'harvestable');
    const harvestList = harvestableLands.length > 0 
        ? harvestableLands.slice(0, 5).map(l => l.plantName).join('、') + (harvestableLands.length > 5 ? '...' : '')
        : '无';

    // 构建即将成熟列表
    const growingLands = lands
        .filter(l => l.status === 'growing' && l.matureInSec > 0)
        .sort((a, b) => a.matureInSec - b.matureInSec)
        .slice(0, 3);
    const soonMature = growingLands.map(l => `${l.plantName}(${formatTime(l.matureInSec)})`).join('、') || '无';

    const message = [
        {
            type: 'text',
            data: { text: '╔══════════════════╗\n' }
        },
        {
            type: 'text',
            data: { text: `║  🌾 ${user.name} 的农场 🌾  ║\n` }
        },
        {
            type: 'text',
            data: { text: '╠══════════════════╣\n' }
        },
        {
            type: 'text',
            data: { text: `║ 👤 等级: Lv.${user.level}\n` }
        },
        {
            type: 'text',
            data: { text: `║ 💰 金币: ${formatNumber(user.gold)}\n` }
        },
        {
            type: 'text',
            data: { text: `║ ⭐ 经验: ${formatNumber(user.exp)}\n` }
        },
        {
            type: 'text',
            data: { text: '╠══════════════════╣\n' }
        },
        {
            type: 'text',
            data: { text: `║ 📊 农场状态:\n` }
        },
        {
            type: 'text',
            data: { text: `║   ${statusParts.join(' | ')}\n` }
        }
    ];

    if (problemParts.length > 0) {
        message.push({
            type: 'text',
            data: { text: `║ ⚠️ 待处理:\n` }
        });
        message.push({
            type: 'text',
            data: { text: `║   ${problemParts.join(' | ')}\n` }
        });
    }

    message.push({
        type: 'text',
        data: { text: '╠══════════════════╣\n' }
    });
    message.push({
        type: 'text',
        data: { text: `║ 🌱 可收获:\n` }
    });
    message.push({
        type: 'text',
        data: { text: `║   ${harvestList}\n` }
    });
    message.push({
        type: 'text',
        data: { text: `║ ⏰ 即将成熟:\n` }
    });
    message.push({
        type: 'text',
        data: { text: `║   ${soonMature}\n` }
    });
    message.push({
        type: 'text',
        data: { text: '╚══════════════════╝\n' }
    });
    message.push({
        type: 'text',
        data: { text: `\n📅 查询时间: ${new Date().toLocaleString('zh-CN')}` }
    });

    return message;
}

// ==================== 背包状态消息 ====================

/**
 * 生成背包状态卡片消息
 */
export function formatBagStateMessage(bagState: BagState): Array<{ type: string; data: Record<string, unknown> }> {
    const { items, gold, exp } = bagState;

    // 分类物品
    const seeds = items.filter(i => i.category === 'seed');
    const fruits = items.filter(i => i.category === 'fruit');
    const others = items.filter(i => !['gold', 'exp', 'seed', 'fruit'].includes(i.category));

    const message = [
        {
            type: 'text',
            data: { text: '╔══════════════════╗\n' }
        },
        {
            type: 'text',
            data: { text: `║  🎒 我的背包 🎒  ║\n` }
        },
        {
            type: 'text',
            data: { text: '╠══════════════════╣\n' }
        },
        {
            type: 'text',
            data: { text: `║ 💰 金币: ${formatNumber(gold)}\n` }
        },
        {
            type: 'text',
            data: { text: `║ ⭐ 经验: ${formatNumber(exp)}\n` }
        },
        {
            type: 'text',
            data: { text: '╠══════════════════╣\n' }
        }
    ];

    if (seeds.length > 0) {
        message.push({
            type: 'text',
            data: { text: `║ 🌱 种子 (${seeds.length}种):\n` }
        });
        seeds.slice(0, 5).forEach(s => {
            message.push({
                type: 'text',
                data: { text: `║   ${s.name} x${s.count}\n` }
            });
        });
        if (seeds.length > 5) {
            message.push({
                type: 'text',
                data: { text: `║   ...等${seeds.length}种\n` }
            });
        }
    }

    if (fruits.length > 0) {
        message.push({
            type: 'text',
            data: { text: `║ 🍎 果实 (${fruits.length}种):\n` }
        });
        fruits.slice(0, 5).forEach(f => {
            message.push({
                type: 'text',
                data: { text: `║   ${f.name} x${f.count}\n` }
            });
        });
        if (fruits.length > 5) {
            message.push({
                type: 'text',
                data: { text: `║   ...等${fruits.length}种\n` }
            });
        }
    }

    message.push({
        type: 'text',
        data: { text: '╚══════════════════╝\n' }
    });
    message.push({
        type: 'text',
        data: { text: `\n📦 共${items.length}种物品` }
    });

    return message;
}

// ==================== 成熟时间消息 ====================

/**
 * 生成成熟时间消息
 */
export function formatMatureTimeMessage(farmState: FarmState): Array<{ type: string; data: Record<string, unknown> }> {
    const { user, lands } = farmState;
    
    // 获取所有正在生长中的作物
    const growingLands = lands
        .filter(l => l.status === 'growing' && l.matureInSec > 0)
        .sort((a, b) => a.matureInSec - b.matureInSec);
    
    // 获取已成熟可收获的作物
    const harvestableLands = lands.filter(l => l.status === 'harvestable');
    
    // 获取枯萎的作物
    const deadLands = lands.filter(l => l.status === 'dead');
    
    const message: Array<{ type: string; data: Record<string, unknown> }> = [];
    
    // 标题
    message.push({
        type: 'text',
        data: { text: '╔════════════════════════════╗\n' }
    });
    message.push({
        type: 'text',
        data: { text: `║    ⏰ ${user.name} 的成熟时间    ║\n` }
    });
    message.push({
        type: 'text',
        data: { text: '╠════════════════════════════╣\n' }
    });
    
    // 已成熟可收获
    if (harvestableLands.length > 0) {
        message.push({
            type: 'text',
            data: { text: `║ ✅ 已成熟: ${harvestableLands.length}块\n` }
        });
        const harvestNames = harvestableLands.slice(0, 3).map(l => l.plantName).join('、');
        message.push({
            type: 'text',
            data: { text: `║    ${harvestNames}${harvestableLands.length > 3 ? '...' : ''}\n` }
        });
        message.push({
            type: 'text',
            data: { text: '╠════════════════════════════╣\n' }
        });
    }
    
    // 即将成熟（按时间排序）
    if (growingLands.length > 0) {
        message.push({
            type: 'text',
            data: { text: `║ 🌱 生长中: ${growingLands.length}块\n` }
        });
        message.push({
            type: 'text',
            data: { text: '╠════════════════════════════╣\n' }
        });
        
        // 按时间段分组
        const soonList: string[] = [];  // 5分钟内
        const hourList: string[] = [];  // 1小时内
        const laterList: string[] = []; // 1小时后
        
        for (const land of growingLands) {
            const timeStr = formatTime(land.matureInSec);
            const item = `${land.plantName}(${timeStr})`;
            
            if (land.matureInSec <= 300) {
                soonList.push(item);
            } else if (land.matureInSec <= 3600) {
                hourList.push(item);
            } else {
                laterList.push(item);
            }
        }
        
        if (soonList.length > 0) {
            message.push({
                type: 'text',
                data: { text: `║ 🔥 即将成熟(5分钟内):\n` }
            });
            message.push({
                type: 'text',
                data: { text: `║  ${soonList.slice(0, 4).join(' ')}${soonList.length > 4 ? '...' : ''}\n` }
            });
        }
        
        if (hourList.length > 0) {
            message.push({
                type: 'text',
                data: { text: `║ ⏳ 1小时内成熟:\n` }
            });
            message.push({
                type: 'text',
                data: { text: `║  ${hourList.slice(0, 4).join(' ')}${hourList.length > 4 ? '...' : ''}\n` }
            });
        }
        
        if (laterList.length > 0) {
            message.push({
                type: 'text',
                data: { text: `║ 📅 1小时后成熟:\n` }
            });
            message.push({
                type: 'text',
                data: { text: `║  ${laterList.slice(0, 4).join(' ')}${laterList.length > 4 ? '...' : ''}\n` }
            });
        }
    }
    
    // 枯萎警告
    if (deadLands.length > 0) {
        message.push({
            type: 'text',
            data: { text: '╠════════════════════════════╣\n' }
        });
        message.push({
            type: 'text',
            data: { text: `║ ⚠️ 枯萎: ${deadLands.length}块需铲除\n` }
        });
    }
    
    // 如果没有作物
    if (growingLands.length === 0 && harvestableLands.length === 0 && deadLands.length === 0) {
        message.push({
            type: 'text',
            data: { text: '║ 🌾 暂无作物，快去种植吧！\n' }
        });
    }
    
    message.push({
        type: 'text',
        data: { text: '╚════════════════════════════╝' }
    });
    
    return message;
}

// ==================== 仓库消息 ====================

/**
 * 生成仓库消息
 */
export function formatWarehouseMessage(
    userName: string,
    items: BagItem[],
    gold: number
): Array<{ type: string; data: Record<string, unknown> }> {
    const message: Array<{ type: string; data: Record<string, unknown> }> = [];

    // 筛选果实类物品（仓库主要存放收获的作物）
    const warehouseItems = items.filter(item => item.category === 'fruit');

    // 标题
    message.push({
        type: 'text',
        data: { text: '╔════════════════════════════╗\n' }
    });
    message.push({
        type: 'text',
        data: { text: `║    📦 ${userName} 的仓库      ║\n` }
    });
    message.push({
        type: 'text',
        data: { text: '╠════════════════════════════╣\n' }
    });

    // 金币显示
    message.push({
        type: 'text',
        data: { text: `║ 💰 金币: ${gold.toLocaleString()}\n` }
    });
    message.push({
        type: 'text',
        data: { text: '╠════════════════════════════╣\n' }
    });

    // 仓库物品列表
    if (warehouseItems.length > 0) {
        message.push({
            type: 'text',
            data: { text: `║ 🌾 库存作物 (${warehouseItems.length}种):\n` }
        });

        // 每行显示2个物品
        for (let i = 0; i < warehouseItems.length; i += 2) {
            const item1 = warehouseItems[i];
            const item2 = warehouseItems[i + 1];

            let line = '║  ';
            line += `${item1.name} x${item1.count}`;
            if (item2) {
                line += `    ${item2.name} x${item2.count}`;
            }
            line += '\n';

            message.push({
                type: 'text',
                data: { text: line }
            });
        }
    } else {
        message.push({
            type: 'text',
            data: { text: '║    仓库空空如也~\n' }
        });
        message.push({
            type: 'text',
            data: { text: '║  快去收获些作物吧！\n' }
        });
    }

    message.push({
        type: 'text',
        data: { text: '╚════════════════════════════╝' }
    });

    return message;
}

// ==================== 商店消息 ====================

/**
 * 生成商店消息
 */
export function formatShopMessage(
    userName: string,
    items: BagItem[],
    gold: number
): Array<{ type: string; data: Record<string, unknown> }> {
    const message: Array<{ type: string; data: Record<string, unknown> }> = [];

    // 筛选种子类物品（商店主要显示种子）
    const seedItems = items.filter(item => item.category === 'seed');

    // 标题
    message.push({
        type: 'text',
        data: { text: '╔════════════════════════════╗\n' }
    });
    message.push({
        type: 'text',
        data: { text: `║    🏪 ${userName} 的种子商店   ║\n` }
    });
    message.push({
        type: 'text',
        data: { text: '╠════════════════════════════╣\n' }
    });

    // 金币显示
    message.push({
        type: 'text',
        data: { text: `║ 💰 金币: ${gold.toLocaleString()}\n` }
    });
    message.push({
        type: 'text',
        data: { text: '╠════════════════════════════╣\n' }
    });

    // 种子列表
    if (seedItems.length > 0) {
        message.push({
            type: 'text',
            data: { text: `║ 🌱 可购买种子 (${seedItems.length}种):\n` }
        });

        // 每行显示1个物品，显示ID和价格
        for (const item of seedItems.slice(0, 8)) {
            message.push({
                type: 'text',
                data: { text: `║  ${item.name} 💰${item.price}\n` }
            });
        }

        if (seedItems.length > 8) {
            message.push({
                type: 'text',
                data: { text: `║  ...还有${seedItems.length - 8}种\n` }
            });
        }
    } else {
        message.push({
            type: 'text',
            data: { text: '║    暂无种子可购买\n' }
        });
    }

    message.push({
        type: 'text',
        data: { text: '╠════════════════════════════╣\n' }
    });
    message.push({
        type: 'text',
        data: { text: '║ 购买请使用: 购买 种子ID 数量 ║\n' }
    });
    message.push({
        type: 'text',
        data: { text: '╚════════════════════════════╝' }
    });

    return message;
}

// ==================== 登录成功消息 ====================

/**
 * 生成登录成功消息
 */
export function formatLoginSuccessMessage(nickname: string): Array<{ type: string; data: Record<string, unknown> }> {
    return [
        {
            type: 'text',
            data: { text: '╔══════════════════════════╗\n' }
        },
        {
            type: 'text',
            data: { text: '║    ✅ 登录成功 ✅        ║\n' }
        },
        {
            type: 'text',
            data: { text: '╠══════════════════════════╣\n' }
        },
        {
            type: 'text',
            data: { text: `║ 👤 欢迎, ${nickname}!\n` }
        },
        {
            type: 'text',
            data: { text: `║ 🌾 已成功登录QQ农场\n` }
        },
        {
            type: 'text',
            data: { text: '╠══════════════════════════╣\n' }
        },
        {
            type: 'text',
            data: { text: '║ 发送「我的农场」查看状态 ║\n' }
        },
        {
            type: 'text',
            data: { text: '║ 发送「我的背包」查看物品 ║\n' }
        },
        {
            type: 'text',
            data: { text: '╚══════════════════════════╝' }
        }
    ];
}

// ==================== 种子列表消息 ====================

/**
 * 生成种子列表消息
 */
export function formatSeedListMessage(): Array<{ type: string; data: Record<string, unknown> }> {
    const seeds = Object.entries(SEED_LIST);
    const message: Array<{ type: string; data: Record<string, unknown> }> = [];
    
    // 标题
    message.push({
        type: 'text',
        data: { text: '╔════════════════════════════════════╗\n' }
    });
    message.push({
        type: 'text',
        data: { text: '║       🌱 QQ农场种子ID列表 🌱       ║\n' }
    });
    message.push({
        type: 'text',
        data: { text: '╠════════════════════════════════════╣\n' }
    });
    
    // 分组显示
    const cheapSeeds = seeds.filter(([_, v]) => v.price <= 50);
    const midSeeds = seeds.filter(([_, v]) => v.price > 50 && v.price <= 150);
    const expensiveSeeds = seeds.filter(([_, v]) => v.price > 150);
    
    // 低价种子
    if (cheapSeeds.length > 0) {
        message.push({
            type: 'text',
            data: { text: '║ 💰 低价种子 (≤50金币):\n' }
        });
        for (const [id, seed] of cheapSeeds) {
            message.push({
                type: 'text',
                data: { text: `║   ${id}: ${seed.name} 💰${seed.price} ⏱${seed.matureTime}\n` }
            });
        }
        message.push({
            type: 'text',
            data: { text: '╠════════════════════════════════════╣\n' }
        });
    }
    
    // 中价种子
    if (midSeeds.length > 0) {
        message.push({
            type: 'text',
            data: { text: '║ 💰💰 中价种子 (51-150金币):\n' }
        });
        for (const [id, seed] of midSeeds) {
            message.push({
                type: 'text',
                data: { text: `║   ${id}: ${seed.name} 💰${seed.price} ⏱${seed.matureTime}\n` }
            });
        }
        message.push({
            type: 'text',
            data: { text: '╠════════════════════════════════════╣\n' }
        });
    }
    
    // 高价种子
    if (expensiveSeeds.length > 0) {
        message.push({
            type: 'text',
            data: { text: '║ 💰💰💰 高价种子 (>150金币):\n' }
        });
        for (const [id, seed] of expensiveSeeds) {
            message.push({
                type: 'text',
                data: { text: `║   ${id}: ${seed.name} 💰${seed.price} ⏱${seed.matureTime}\n` }
            });
        }
    }
    
    message.push({
        type: 'text',
        data: { text: '╠════════════════════════════════════╣\n' }
    });
    message.push({
        type: 'text',
        data: { text: '║ 📝 使用说明:\n' }
    });
    message.push({
        type: 'text',
        data: { text: '║   种植: 种植 种子ID\n' }
    });
    message.push({
        type: 'text',
        data: { text: '║   购买: 购买 种子ID 数量\n' }
    });
    message.push({
        type: 'text',
        data: { text: '╚════════════════════════════════════╝' }
    });
    
    return message;
}

// ==================== 错误消息 ====================

/**
 * 生成错误消息
 */
export function formatErrorMessage(error: string): Array<{ type: string; data: Record<string, unknown> }> {
    return [
        {
            type: 'text',
            data: { text: '╔══════════════════╗\n' }
        },
        {
            type: 'text',
            data: { text: `║  ❌ 操作失败 ❌  ║\n` }
        },
        {
            type: 'text',
            data: { text: '╠══════════════════╣\n' }
        },
        {
            type: 'text',
            data: { text: `║ ${error}\n` }
        },
        {
            type: 'text',
            data: { text: '╚══════════════════╝' }
        }
    ];
}

// ==================== 合并转发消息 ====================

/**
 * 创建合并转发消息节点
 */
export function createForwardNode(content: Array<{ type: string; data: Record<string, unknown> }>, nickname: string = 'QQ农场助手'): ForwardNode {
    return {
        type: 'node',
        data: {
            nickname,
            content
        }
    };
}
