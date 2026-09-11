// app.js —— 云开发初始化 + 登录（openid 由云函数侧自动注入，免自建鉴权）
App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('基础库过低，请升级微信版本以支持云开发');
      return;
    }
    wx.cloud.init({
      // env 取值见 README：开发 env-dev / 生产 env-prod，此处留空用默认环境
      traceUser: true,
    });
  },
});
