/** 云函数调用封装 —— 统一错误处理。 */
export const callCloud = async (name, data = {}, opt = {}) => {
  try {
    const res = await wx.cloud.callFunction({ name, data });
    if (res.result && res.result.ok === false) {
      throw new Error(res.result.error || '云函数执行失败');
    }
    return res.result;
  } catch (e) {
    if (!opt.silent) console.error(`[cloud:${name}]`, e);
    throw e;
  }
};
