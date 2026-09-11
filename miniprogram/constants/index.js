/** 微信云开发环境 ID（云函数/数据库/云存储都用它）。换环境只需改这里。 */
export const CLOUD_ENV = 'cloud1-d6gfdnelqf7478e85';

/** AI 供应商配置 —— 与 memo-grad src/constants 保持一致。密钥只放云端环境变量。 */
export const AI_PROVIDERS = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-v4-flash',
  },
};

export const API_CONFIG = {
  TIMEOUT: 120000,
  BATCH_SIZE: 5,
};
