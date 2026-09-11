/**
 * 设计 token —— 移植自 memo-grad `src/theme/tokens.ts` + `src/theme/theme.ts`（唯一真相源在
 * 原仓库，本文件为小程序版镜像，原仓库 token 变更后需同步）。
 *
 * 美学方向：Refined Utilitarian + 10% Dark Academia 学院骨血
 *   主色  墨绿 #2E5E4E（替代 MD3 默认蓝）
 *   强调  赭石 #C2603A（待复习 / 警告 / 不认识的唯一彩色 hot spot）
 *   成功  #3F7A5C    危险 #B5462E
 *   浅色底 羊皮纸 #F4F0E8（替代纯白）  暗色 #0F1110
 *   描边  1px hairline #E5E0D6
 *
 * ⚠️ 单位约定：App 用 dp/px，小程序用 rpx（750rpx = 屏宽）。
 *    换算规则 **rpx = px × 2**，本文件所有数值均已按此规则换算成 rpx，
 *    与 App 的 typography/spacing/radius 数值语义一一对应。
 */

// ======================  色彩  ======================
export const palette = {
  // 主色（墨绿 — 替代 MD3 默认蓝）
  primary: '#2E5E4E',
  primaryDark: '#234B3E',
  primaryLight: '#E6EFEB',

  // 强调（赭石 — 替代 MD3 默认橙）
  accent: '#C2603A',
  accentDark: '#9A4A2A',
  accentLight: '#F6E5DC',

  // 语义色
  success: '#3F7A5C',
  successDark: '#2E5E4E',
  successLight: '#E6EFEB',
  danger: '#B5462E',
  dangerDark: '#8E3522',
  dangerLight: '#F6E5DC',
  warning: '#C2603A',
  warningLight: '#F6E5DC',

  // 中性
  background: '#F4F0E8', // 羊皮纸
  surface: '#FFFFFF',
  surfaceAlt: '#FAF7F1',
  border: '#E0DDD4',
  hairline: '#E5E0D6',

  // 暗色中性
  backgroundDark: '#0F1110',
  surfaceDark: '#161819',
  surfaceAltDark: '#1E2120',
  borderDark: '#2A2D2B',
  hairlineDark: '#1F2220',

  // 文本层级
  textPrimary: '#1A1D1B',
  textSecondary: '#5C605C',
  textTertiary: '#8A8E89',
  textDisabled: '#BCBEB9',
  textPrimaryDark: '#EAE6DD',
  textSecondaryDark: '#B0ACA3',
  textTertiaryDark: '#807C74',

  // MD3 角色
  onSurface: '#1A1D1B',
  onSurfaceVariant: '#5C605C',
  error: '#B5462E',

  // 语义色上的文字（primary/success/danger/warning 背景上的白字）
  onPrimary: '#FFFFFF',
  onAccent: '#FFFFFF',

  // Toast 专属深色底（无论主题，toast 恒为深底白字）
  toastBg: '#1A1D1B',
  toastBgDark: '#262A28',

  // 难度 1→5 渐变（绿→黄→橙→红）
  difficulty: ['#3F7A5C', '#7AA85F', '#D4A93A', '#C2603A', '#B5462E'],
};

// ======================  状态配色（6 状态 × light+dark）  ======================
export const statusLight = {
  active: { bg: '#E6EFEB', fg: '#234B3E', border: '#BFD3C9' },
  pending: { bg: '#F6E5DC', fg: '#9A4A2A', border: '#E5C8B6' },
  expired: { bg: '#EFEAE0', fg: '#7A6A4A', border: '#D8CFB7' },
  refunded: { bg: '#F1E4E1', fg: '#8E3522', border: '#D9BDB7' },
  closed: { bg: '#E8E5DD', fg: '#5C605C', border: '#CFCBC2' },
  banned: { bg: '#F1E4E1', fg: '#8E3522', border: '#D9BDB7' },
};

export const statusDark = {
  active: { bg: '#1E2D26', fg: '#9CC4AE', border: '#2C4438' },
  pending: { bg: '#3A271F', fg: '#E5B89E', border: '#5A3D32' },
  expired: { bg: '#332D24', fg: '#C9B98D', border: '#4D4536' },
  refunded: { bg: '#3A241F', fg: '#E0A89A', border: '#5A3830' },
  closed: { bg: '#2A2C29', fg: '#A5A29A', border: '#3F413E' },
  banned: { bg: '#3A241F', fg: '#E0A89A', border: '#5A3830' },
};

// ======================  主题色（对应 App useAppTheme().colors）  ======================
/** 浅色主题结构色 —— 与 memo-grad theme.ts 的 lightColors 一一对应。 */
export const lightColors = {
  background: palette.background,
  surface: palette.surface,
  surfaceVariant: palette.surfaceAlt,
  primary: palette.primary,
  primaryContainer: palette.primaryLight,
  onPrimaryContainer: palette.primaryDark,
  secondary: palette.accent,
  secondaryContainer: palette.accentLight,
  error: palette.danger,
  errorContainer: palette.dangerLight,
  onSurface: palette.textPrimary,
  onSurfaceVariant: palette.textSecondary,
  tertiary: palette.textTertiary,
  outline: palette.border,
  hairline: palette.hairline,
  accent: palette.accent,
  success: palette.success,
  danger: palette.danger,
  warning: palette.warning,
  onPrimary: palette.onPrimary,
  onSuccess: palette.onPrimary,
  onDanger: palette.onPrimary,
  onWarning: palette.onPrimary,
  status: statusLight,
  dark: false,
};

/** 暗色主题结构色 —— 与 memo-grad theme.ts 的 darkColors 一一对应。 */
export const darkColors = {
  background: palette.backgroundDark,
  surface: palette.surfaceDark,
  surfaceVariant: palette.surfaceAltDark,
  primary: '#6FA08C', // 墨绿亮化（暗色下保持可读）
  primaryContainer: '#1E3A2D',
  onPrimaryContainer: '#9CC4AE',
  secondary: '#D8895C',
  secondaryContainer: '#3A271F',
  error: '#D26A52',
  errorContainer: '#3A241F',
  onSurface: palette.textPrimaryDark,
  onSurfaceVariant: palette.textSecondaryDark,
  tertiary: palette.textTertiaryDark,
  outline: palette.borderDark,
  hairline: palette.hairlineDark,
  accent: palette.accent,
  success: palette.success,
  danger: palette.danger,
  warning: palette.warning,
  onPrimary: palette.onPrimary,
  onSuccess: palette.onPrimary,
  onDanger: palette.onPrimary,
  onWarning: palette.onPrimary,
  status: statusDark,
  dark: true,
};

// ======================  字号 / 行高（rpx）  ======================
/** 与 App typography 对应：caption 11px→22rpx、body 14px→28rpx … */
export const typography = {
  caption: { size: 22, lineHeight: 32 }, // 11 / 16
  bodySm: { size: 26, lineHeight: 40 }, // 13 / 20
  body: { size: 28, lineHeight: 44 }, // 14 / 22
  bodyLg: { size: 30, lineHeight: 48 }, // 15 / 24
  title: { size: 34, lineHeight: 52 }, // 17 / 26
  headline: { size: 44, lineHeight: 60 }, // 22 / 30
  display: { size: 64, lineHeight: 80 }, // 32 / 40
  numeralXl: { size: 112, lineHeight: 128 }, // 56 / 64
};

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

// ======================  字体族  ======================
/**
 * App 用思源宋体/黑体 + Source Serif 4。小程序不打包字体文件（体积），
 * 用系统字体族近似：衬线（学院骨血）走 serif，正文走系统默认。
 */
export const fontFamily = {
  serif: 'Georgia, "Times New Roman", "Songti SC", "STSong", serif',
  sans: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif',
  serifLatin: 'Georgia, "Times New Roman", serif',
  mono: 'Menlo, Consolas, monospace',
};

// ======================  间距（rpx，= App px × 2）  ======================
export const spacing = {
  xs: 8, // 4
  sm: 16, // 8
  md: 24, // 12
  lg: 32, // 16
  xl: 48, // 24
  xxl: 64, // 32
  xxxl: 96, // 48
};

// ======================  圆角（rpx）  ======================
export const radius = {
  sm: 8, // 4
  md: 16, // 8
  lg: 24, // 12
  xl: 32, // 16
  pill: 999,
};

// ======================  阴影（WXSS box-shadow 字符串）  ======================
export const shadow = {
  none: 'none',
  hairline: '0 2rpx 2rpx rgba(26, 29, 27, 0.04)',
  card: '0 4rpx 8rpx rgba(26, 29, 27, 0.06)',
  raised: '0 8rpx 24rpx rgba(26, 29, 27, 0.1)',
  overlay: '0 16rpx 48rpx rgba(26, 29, 27, 0.16)',
};

// ======================  命中 / 触控尺寸（rpx）  ======================
export const controlHeight = {
  sm: 64, // 32
  md: 80, // 40
  lg: 96, // 48
  xl: 112, // 56
};

// ======================  工具函数  ======================
/** 按难度 1-5 取对应颜色，越界回退到中性灰。 */
export const difficultyColor = (level) =>
  palette.difficulty[level - 1] ?? palette.textTertiary;

/** 按 StatusKind 取当前主题对应的状态色。 */
export const statusColor = (kind, dark) => (dark ? statusDark[kind] : statusLight[kind]);

/** 传入主题标记，取整套结构色（页面/组件统一入口）。 */
export const themeColors = (dark) => (dark ? darkColors : lightColors);

// ======================  业务常量（与 App 一致）  ======================
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

/** 一次最多处理的单词数（AddWord 用）。 */
export const MAX_ADD_WORDS = 30;
