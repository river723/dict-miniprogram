// app.js —— 云开发初始化 + 启动自检（openid 由云函数侧自动注入，免自建鉴权）
import { CLOUD_ENV } from './constants/index';
import { initThemeWindow } from './utils/theme';

App({
  globalData: {
    cloudReady: false,
    cloudError: '',
  },

  onLaunch() {
    initThemeWindow(); // 先落窗口色（深色下避免首屏闪浅色），再跑其余初始化
    this.setupUpdateManager();
    this.setupErrorHandler();
    this.initCloud();
  },

  /** 版本更新：新包下次冷启动生效，用户确认后立即重启。 */
  setupUpdateManager() {
    if (!wx.canIUse('getUpdateManager')) return;
    const um = wx.getUpdateManager();
    um.onUpdateReady(() => {
      wx.showModal({
        title: '更新提示',
        content: '新版本已就绪，是否重启应用？',
        success: (res) => { if (res.confirm) um.applyUpdate(); },
      });
    });
  },

  /** 未捕获异常兜底：云环境没配好时不至于白屏卡加载。 */
  setupErrorHandler() {
    wx.onError?.((msg) => {
      console.error('[app] 未捕获错误：', msg);
    });
    wx.onUnhandledRejection?.(({ reason }) => {
      // 云函数报错多为 Promise rejection，静默吞掉会让 UI 一直转圈
      console.error('[app] 未处理的 Promise 拒绝：', reason);
    });
  },

  async initCloud() {
    if (!wx.cloud) {
      this.globalData.cloudError = '基础库过低，请升级微信版本以支持云开发';
      wx.showModal({ title: '无法启动', content: this.globalData.cloudError, showCancel: false });
      return;
    }
    try {
      wx.cloud.init({ env: CLOUD_ENV, traceUser: true });
      this.globalData.cloudReady = true;
    } catch (e) {
      this.globalData.cloudError = `云环境初始化失败：${e.message}`;
      console.error('[app]', e);
      wx.showToast({ title: '云服务连接失败', icon: 'none' });
    }
  },
});
