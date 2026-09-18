/**
 * 主题 —— 受控三档：light / dark / system。
 *
 * 为什么不用 `@media (prefers-color-scheme: dark)`：
 *   媒体查询只看系统，不看用户在 App 内的设置 —— 真机系统深色时会无条件命中，
 *   导致"设置里选了浅色、界面却是深色"。且开发者工具默认不模拟深色，于是
 *   "工具里正常、真机上变深"，问题极难定位。
 *   所以深色变量改为作用域类 `.mg-theme-dark`（见 theme/theme.wxss），
 *   由本模块按「设置档位 + 系统主题」计算后挂到页面根 view 上。
 *
 * 用法：页面 WXML 根 view 带 `class="mg-page {{themeClass}}"`，页面 JS 在 onShow 里
 *       `applyTheme(this)`（切换主题后返回页面即生效）。
 */
import StorageService from '../services/storage';

const DARK_CLASS = 'mg-theme-dark';

/** 深色时的窗口级颜色（page 元素背景 / 导航栏），与 theme.wxss 的深色 token 对齐。 */
const DARK_WINDOW_BG = '#0F1110';
const DARK_NAV_BG = '#1E3A2D';
const LIGHT_WINDOW_BG = '#F4F0E8';
const LIGHT_NAV_BG = '#2E5E4E';

let lastApplied = null;

/** 读系统主题。每次调用都重读 —— 用户可能在后台改了系统外观再切回来。 */
function readSystemTheme() {
  try {
    const info = wx.getSystemInfoSync ? wx.getSystemInfoSync() : null;
    return !!(info && info.theme === 'dark');
  } catch (e) {
    return false;
  }
}

/**
 * 按设置档位判定是否深色。
 * light → 恒浅；dark → 恒深；system → 跟随系统。
 */
export function resolveDark(settings) {
  const mode = (settings && settings.theme) || 'light';
  if (mode === 'dark') return true;
  if (mode === 'system') return readSystemTheme();
  return false;
}

/** 同步窗口级颜色（下拉露出的底色 + 导航栏）。只在档位变化时调用，避免无谓渲染。 */
function syncWindow(dark) {
  if (lastApplied === dark) return;
  lastApplied = dark;
  try {
    if (wx.setBackgroundColor) {
      wx.setBackgroundColor({ backgroundColor: dark ? DARK_WINDOW_BG : LIGHT_WINDOW_BG });
    }
    if (wx.setNavigationBarColor) {
      wx.setNavigationBarColor({
        frontColor: '#ffffff',
        backgroundColor: dark ? DARK_NAV_BG : LIGHT_NAV_BG,
      });
    }
  } catch (e) {
    // 窗口色失败不影响页面内容，静默即可
  }
}

/**
 * 在页面 onShow 里调用：把当前主题写到页面 data。
 * @param {Object} ctx 页面 this
 */
export function applyTheme(ctx) {
  // ⚠️ 整个函数必须吞掉所有异常：onShow 早于页面首次渲染，
  //    这里抛异常会直接中断渲染 → 整页空白（只剩 tabBar），且极难定位。
  //    主题失效的后果只是"颜色不对"，不能拿页面白屏去换。
  try {
    if (!ctx || typeof ctx.setData !== 'function') return;
    let dark = false;
    try {
      dark = resolveDark(StorageService.getSettings());
    } catch (e) {
      dark = false;
    }
    syncWindow(dark);
    ctx.setData({ themeClass: dark ? DARK_CLASS : '', themeDark: dark });
  } catch (e) {
    console.error('[theme] applyTheme 失败（已忽略，页面继续渲染）：', e);
  }
}

/** 切主题后清掉窗口色缓存，强制下一次重新应用（用于设置页立即生效）。 */
export function invalidateTheme() {
  lastApplied = null;
}

/** App 启动时同步一次窗口色，避免深色下首屏先闪一下浅色底。 */
export function initThemeWindow() {
  let dark = false;
  try {
    dark = resolveDark(StorageService.getSettings());
  } catch (e) {
    dark = false;
  }
  syncWindow(dark);
}

export default { applyTheme, resolveDark, invalidateTheme, initThemeWindow };
