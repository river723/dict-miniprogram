/**
 * 设计 token —— 移植自 memo-grad `src/theme/tokens.ts`（唯一真相源仍在原仓库，
 * 本文件为小程序版镜像，原仓库 token 变更后需同步）。
 *
 * 美学方向：Refined Utilitarian + 10% Dark Academia
 */
export const palette = {
  primary: '#2E5E4E',
  primaryDark: '#234B3E',
  primaryLight: '#E6EFEB',

  accent: '#C2603A',
  accentDark: '#9A4A2A',
  accentLight: '#F6E5DC',

  success: '#3F7A5C',
  danger: '#B5462E',
  dangerLight: '#F6E5DC',
  warning: '#C2603A',
  warningLight: '#F6E5DC',

  background: '#F4F0E8',
  surface: '#FFFFFF',
  surfaceAlt: '#FAF7F1',
  border: '#E0DDD4',
  hairline: '#E5E0D6',

  textPrimary: '#1A1D1B',
  textSecondary: '#5C605C',
  textTertiary: '#8A8E89',
  textDisabled: '#BCBEB9',

  onPrimary: '#FFFFFF',
  onAccent: '#FFFFFF',

  toastBg: '#1A1D1B',

  difficulty: ['#3F7A5C', '#7AA85F', '#D4A93A', '#C2603A', '#B5462E'],
};

export const typography = {
  caption: { size: 22, lineHeight: 32 }, // 单位 rpx
  bodySm: { size: 26, lineHeight: 40 },
  body: { size: 28, lineHeight: 44 },
  bodyLg: { size: 30, lineHeight: 48 },
  title: { size: 34, lineHeight: 52 },
  headline: { size: 44, lineHeight: 60 },
  display: { size: 64, lineHeight: 80 },
  numeralXl: { size: 112, lineHeight: 128 },
};

export const spacing = { xs: 8, sm: 16, md: 24, lg: 32, xl: 48, xxl: 64 }; // rpx

export const radius = { sm: 8, md: 16, lg: 24, xl: 32, pill: 999 };

export const DAILY_NEW_WORDS_LIMIT = 50;
export const UI_CONFIG = {
  WORDS_PER_PAGE: 20,
  DAILY_NEW_WORDS_LIMIT: 50,
  MIN_CORRECT_RATE_FOR_ADVANCE: 0.8,
};

export const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30]; // 艾宾浩斯复习间隔（天）

export const EXAM_CONFIG = {
  DEFAULT_QUESTION_COUNT: 10,
  MIN_QUESTION_COUNT: 5,
  MAX_QUESTION_COUNT: 20,
  AUTO_ADVANCE_DELAY: 2500,
};

export const WRONG_QUESTION_MASTERY_THRESHOLD = 3; // 错题做对 3 次后自动移出

/** 按难度 1-5 取对应颜色，越界回退到中性灰。 */
export const difficultyColor = (level) =>
  palette.difficulty[level - 1] ?? palette.textTertiary;
