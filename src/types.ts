/**
 * 类型定义文件
 * 定义插件内部使用的接口和类型
 *
 * 注意：OneBot 相关类型（OB11Message, OB11PostSendMsg 等）
 * 以及插件框架类型（NapCatPluginContext, PluginModule 等）
 * 均来自 napcat-types 包，无需在此重复定义。
 */

// ==================== 插件配置 ====================

/**
 * 插件主配置接口
 */
export interface PluginConfig {
    /** 全局开关：是否启用插件功能 */
    enabled: boolean;
    /** 调试模式：启用后输出详细日志 */
    debug: boolean;
    /** 触发命令前缀，默认为 "我的农场" */
    commandPrefix: string;
    /** 登录命令 */
    loginCommand: string;
    /** 背包查询命令前缀，默认为 "我的背包" */
    bagCommandPrefix: string;
    /** 收获命令 */
    harvestCommand: string;
    /** 铲除命令 */
    removeCommand: string;
    /** 种植命令 */
    plantCommand: string;
    /** 升级土地命令 */
    upgradeCommand: string;
    /** 扩建土地命令 */
    unlockCommand: string;
    /** 成熟时间查询命令 */
    matureCommand: string;
    /** 仓库命令 */
    warehouseCommand: string;
    /** 商店命令 */
    shopCommand: string;
    /** 种子列表命令 */
    seedListCommand: string;
    /** 出售命令 */
    sellCommand: string;
    /** 除草命令 */
    weedCommand: string;
    /** 除虫命令 */
    bugCommand: string;
    /** 菜单命令 */
    menuCommand: string;
    /** 同一命令请求冷却时间（秒），0 表示不限制 */
    cooldownSeconds: number;
    /** 按群的单独配置 */
    groupConfigs: Record<string, GroupConfig>;
    /** 农场服务器地址 */
    farmServerUrl: string;
    /** 登录超时时间（秒） */
    loginTimeout: number;
}

/**
 * 群配置
 */
export interface GroupConfig {
    /** 是否启用此群的功能 */
    enabled?: boolean;
}

// ==================== 农场数据类型 ====================

/** 用户登录状态 */
export interface UserLoginState {
    /** 是否已登录 */
    isLoggedIn: boolean;
    /** 用户GID */
    gid: number;
    /** 用户昵称 */
    name: string;
    /** 用户等级 */
    level: number;
    /** 金币 */
    gold: number;
    /** 经验 */
    exp: number;
    /** 登录时间 */
    loginTime: number;
    /** 认证码 */
    authCode: string;
}

/** 扫码登录会话 */
export interface QRLoginSession {
    /** 登录码 */
    code: string;
    /** 二维码图片（base64） */
    qrImage: string;
    /** 二维码URL */
    qrUrl: string;
    /** 创建时间 */
    createdAt: number;
    /** 关联的用户QQ号 */
    userId: string;
}

/** 土地信息 */
export interface LandInfo {
    /** 土地ID */
    id: number;
    /** 是否已解锁 */
    unlocked: boolean;
    /** 状态: locked/empty/growing/harvestable/dead */
    status: string;
    /** 植物名称 */
    plantName: string;
    /** 种子ID */
    seedId: number;
    /** 种子图片 */
    seedImage: string;
    /** 生长阶段名称 */
    phaseName: string;
    /** 距离成熟时间（秒） */
    matureInSec: number;
    /** 是否需要浇水 */
    needWater: boolean;
    /** 是否需要除草 */
    needWeed: boolean;
    /** 是否需要除虫 */
    needBug: boolean;
    /** 土地等级 */
    level: number;
}

/** 农场状态摘要 */
export interface FarmSummary {
    /** 可收获数量 */
    harvestable: number;
    /** 生长中数量 */
    growing: number;
    /** 空地数量 */
    empty: number;
    /** 枯萎数量 */
    dead: number;
    /** 需浇水数量 */
    needWater: number;
    /** 需除草数量 */
    needWeed: number;
    /** 需除虫数量 */
    needBug: number;
}

/** 农场完整状态 */
export interface FarmState {
    /** 用户信息 */
    user: UserLoginState;
    /** 土地列表 */
    lands: LandInfo[];
    /** 状态摘要 */
    summary: FarmSummary;
    /** 查询时间 */
    queryTime: number;
}

/** 背包物品 */
export interface BagItem {
    /** 物品ID */
    id: number;
    /** 数量 */
    count: number;
    /** 名称 */
    name: string;
    /** 图片URL */
    image: string;
    /** 分类: gold/exp/fruit/seed/item */
    category: string;
    /** 物品类型 */
    itemType: number;
    /** 价格 */
    price: number;
}

/** 背包状态 */
export interface BagState {
    /** 物品列表 */
    items: BagItem[];
    /** 物品种类数 */
    totalKinds: number;
    /** 金币 */
    gold: number;
    /** 经验 */
    exp: number;
    /** 查询时间 */
    queryTime: number;
}

// ==================== API 响应 ====================

/**
 * 统一 API 响应格式
 */
export interface ApiResponse<T = unknown> {
    /** 状态码，0 表示成功，-1 表示失败 */
    code: number;
    /** 错误信息（仅错误时返回） */
    message?: string;
    /** 响应数据（仅成功时返回） */
    data?: T;
}
