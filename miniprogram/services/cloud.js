/** 云函数调用封装 —— 统一错误处理 + 超时兜底。
 *
 * 关键修复（2026-10-08）：wx.cloud.callFunction 在真机调试 / 弱网下
 * 经常「回调迟迟不来、也不 reject」，导致调用方 `await` 永久挂起
 * （典型表现：学习页一直「加载中」、首张卡闪一下后卡死）。
 * 这里用 Promise.race 包一层超时，超时即 reject，让上层 catch/降级逻辑能跑通。
 */
const DEFAULT_TIMEOUT = 25000;

function withTimeout(promise, ms, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`云函数 ${name} 调用超时（${ms}ms，疑似网络/调试通道不稳）`));
    }, ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export const callCloud = async (name, data = {}, opt = {}) => {
  const timeoutMs = typeof opt.timeout === 'number' ? opt.timeout : DEFAULT_TIMEOUT;
  try {
    const task = wx.cloud.callFunction({ name, data });
    const res = await withTimeout(task, timeoutMs, name);
    if (res.result && res.result.ok === false) {
      throw new Error(res.result.error || '云函数执行失败');
    }
    return res.result;
  } catch (e) {
    if (!opt.silent) console.error(`[cloud:${name}]`, e);
    throw e;
  }
};
