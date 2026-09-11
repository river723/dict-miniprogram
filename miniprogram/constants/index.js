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

// ======================  练习域常量（与 App 一致）  ======================

/** AI 出题参数（对齐 App EXAM_CONFIG）。 */
export const EXAM_CONFIG = {
  DEFAULT_QUESTION_COUNT: 10,
  MIN_QUESTION_COUNT: 5,
  MAX_QUESTION_COUNT: 20,
  /** 答完最后一题后自动跳转的延迟（毫秒） */
  AUTO_ADVANCE_DELAY: 2500,
};

/** 错题答对多少次后自动移出错题本。 */
export const WRONG_QUESTION_MASTERY_THRESHOLD = 3;

/** AI 出题题型标签。 */
export const QUESTION_TYPE_LABEL = {
  definition: '释义单选',
  cloze: '完形选词',
};

/** 真题「新题型」子类型标签。 */
export const REAL_EXAM_SUBTYPE_LABEL = {
  ordering: '段落排序',
  heading: '段落小标题（7选5）',
  sentence: '选句填空（7选5）',
  matching: '多项对应（信息匹配）',
  truefalse: '正误判断（T/F）',
};

/** 真题列表页的题型条目元数据（图标 / 标题 / 角标）。 */
export const REAL_EXAM_ENTRY_META = {
  reading: { icon: 'book-open-variant', title: '阅读理解' },
  cloze: { icon: 'format-letter-matches', title: '完形填空' },
  newtype: { icon: 'sort-variant', title: '新题型' },
  translation: { icon: 'translate', title: '翻译', badge: '阅览' },
  writing: { icon: 'pencil-outline', title: '写作', badge: '阅览' },
};

/** 故事 / 文章的主题标签。 */
export const THEME_LABELS = {
  adventure: '冒险',
  mystery: '悬疑',
  fantasy: '奇幻',
  sciFi: '科幻',
  romance: '浪漫',
  history: '历史',
  nature: '自然',
  random: '随机',
  technology: '科技',
  life: '生活',
  science: '科学',
};

/** 主题分段选择的选项（设置页用）。 */
export const THEME_OPTIONS = [
  { value: 'light', label: '浅色', icon: 'white-balance-sunny' },
  { value: 'dark', label: '深色', icon: 'weather-night' },
  { value: 'system', label: '跟随系统', icon: 'theme-light-dark' },
];
