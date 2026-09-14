/**
 * 数据初始化 —— 建集合 + 一键灌入词库。
 * 一次性工具页，数据跑通之后这段代码就没用了，留着也不占地方。
 */
import { callCloud } from '../../services/cloud';

const MAX_ROUNDS = 40; // 防死循环兜底（每轮约 2.2 秒，只写一部分）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 短错误描述，给日志用（超时/未部署是这台环境最常见两种）。 */
function shortErr(e) {
  const msg = String((e && e.message) || e);
  if (/-504003|TIME_LIMIT_EXCEEDED|timed out/i.test(msg)) return '云函数超时（被平台掐断）';
  if (/-501000|FUNCTION_NOT_FOUND/.test(msg)) return 'seed 云函数未部署';
  if (/-502005|collection|not exist/i.test(msg)) return '集合不存在';
  return msg.slice(0, 80);
}

/** 把云函数的底层报错翻译成人话 + 下一步该干什么。 */
function explain(e) {
  const msg = String((e && e.message) || e);
  if (/FUNCTION_NOT_FOUND|-501000/.test(msg)) {
    return 'seed 云函数没部署。执行 npm run deploy:cf -- seed 即可（或在开发者工具里对 cloudfunctions/seed 目录右键上传部署）';
  }
  if (/ENOENT|scandir|\/var\/user\/data/.test(msg)) {
    return '云端 seed 函数里找不到数据文件 —— 是旧版本（数据没随代码包落地）。执行 npm run deploy:cf -- seed 重新部署后，重进本页即可';
  }
  if (/seed-data|Cannot find module/.test(msg)) {
    return '云端 seed 函数缺内置数据文件。执行 npm run seed:build 后 npm run deploy:cf -- seed 重新部署';
  }
  if (/collection|not exist|-502005/i.test(msg)) {
    return '集合还不存在，先点上面的「① 建集合」';
  }
  if (/PERMISSION_DENIED|permission denied/i.test(msg)) {
    return '权限不足。请确认 seed 函数是用「云端安装依赖」方式部署的（服务端权限）';
  }
  return msg;
}

/** 数据源的中文说明，给用户看的（不暴露内部实现细节）。 */
const SOURCE_TEXT = {
  inline: '内置',
  files: '分片',
  'files-flat': '分片',
};

Page({
  data: {
    busy: false,
    loaded: false,
    total: 0,
    sourceText: '内置',
    cloudCount: -1,
    remaining: 0,
    extra: 0,
    progress: 0,
    countText: '未检测',
    canClear: false,
    log: [],
    error: '',
    // ---- 内容数据（真题 / 故事），来自 contentseed 云函数 ----
    contentTotal: 0,
    contentIndexed: -1,
    contentRemaining: 0,
    contentProgress: 0,
  },

  onShow() {
    if (!this.data.loaded) this.refresh();
  },

  pushLog(text) {
    this.setData({ log: [...this.data.log, text] });
  },

  async withBusy(fn) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      await fn();
    } catch (e) {
      const msg = explain(e);
      this.setData({ error: msg });
      this.pushLog(`✗ ${msg}`);
    } finally {
      this.setData({ busy: false });
    }
  },

  async refresh() {
    const info = await callCloud('seed', { action: 'info' });
    if (info.loadError) {
      // 数据文件没随代码上去，后面的导入必然失败，先把话说清楚
      this.setData({ loaded: true, countText: '数据缺失', error: `数据未随代码上传：${info.loadError}` });
    } else {
      const countable = info.cloudCount >= 0;
      const extra = countable && info.total > 0 ? Math.max(0, info.cloudCount - info.total) : 0;
      this.setData({
        loaded: true,
        total: info.total,
        sourceText: SOURCE_TEXT[info.source] || '内置',
        cloudCount: info.cloudCount,
        remaining: countable ? Math.max(0, info.total - info.cloudCount) : info.total,
        extra,
        countText: countable ? `${info.cloudCount} 条` : '集合不存在',
        canClear: countable && info.cloudCount > 0,
        progress: countable && info.total > 0 ? Math.min(100, Math.round((info.cloudCount / info.total) * 100)) : 0,
        error: countable ? '' : `worddict 集合不可访问${info.countError ? `：${info.countError}` : '，请先点「① 建集合」'}`,
      });
    }
    await this.refreshContent();
  },

  /** 内容数据状态（真题 / 故事）—— 与词库相互独立，失败不影响词库区块。 */
  async refreshContent() {
    try {
      const info = await callCloud('contentseed', { action: 'info' });
      const countable = info.indexed >= 0;
      this.setData({
        contentTotal: info.total || 0,
        contentIndexed: info.indexed,
        contentRemaining: countable ? Math.max(0, (info.total || 0) - info.indexed) : (info.total || 0),
        contentProgress:
          countable && info.total > 0 ? Math.min(100, Math.round((info.indexed / info.total) * 100)) : 0,
      });
      if (info.loadError) this.pushLog(`✗ 内容数据未随代码上传：${info.loadError}`);
    } catch (e) {
      // contentseed 还没部署：只提示，不打断词库流程
      this.pushLog(`✗ 内容数据检测失败（${shortErr(e)}）—— 若未部署请先执行 npm run deploy:cf -- contentseed`);
    }
  },

  onRefreshTap() {
    this.withBusy(() => this.refresh());
  },

  onEnsureCollections() {
    this.withBusy(async () => {
      const res = await callCloud('seed', { action: 'ensureCollections' });
      const failed = res.report.filter((r) => r.status === 'failed');
      this.pushLog(`✓ 集合已就位（新建 ${res.report.filter((r) => r.status === 'created').length} 个）`);
      if (failed.length) {
        failed.forEach((f) => this.pushLog(`✗ ${f.name}: ${f.msg}`));
        this.setData({ error: `建集合失败：${failed.map((f) => f.name).join('、')}` });
      }
    });
  },

  onImport() {
    this.withBusy(async () => {
      let from = 0;
      let stalls = 0;
      for (let round = 1; round <= MAX_ROUNDS; round += 1) {
        let res;
        try {
          // 2300ms 是给云函数留的「自收手」预算（默认超时只有 3 秒，必须自己先返回）
          res = await callCloud('seed', {
            action: 'importWorddict',
            from,
            concurrency: 20,
            timeBudgetMs: 2200,
          });
        } catch (e) {
          // 被平台掐断/网络抖动：这一轮没拿到断点，原地重试即可。
          // 导入是幂等的，已写进去的会被跳过，所以重试不会插重。
          stalls += 1;
          this.pushLog(`第 ${round} 轮中断（${shortErr(e)}），重试 ${stalls}/6`);
          if (stalls >= 6) throw e;
          await sleep(600);
          continue;
        }
        stalls = 0;
        this.pushLog(`第 ${round} 轮：新增 ${res.imported} 条${res.skipped ? `，已存在跳过 ${res.skipped} 条` : ''}${res.failed ? `，失败 ${res.failed} 条` : ''}，用时 ${(res.elapsedMs / 1000).toFixed(1)}s`);
        if (res.failed > 0) res.errors.forEach((e) => this.pushLog(`  ✗ ${e.word}: ${e.msg}`));
        this.setData({
          cloudCount: res.next,
          countText: `${res.next} 条`,
          canClear: res.next > 0,
          remaining: Math.max(0, res.total - res.next),
          progress: Math.round((res.next / res.total) * 100),
        });
        if (res.done) {
          this.pushLog(`✓ 全部完成，共 ${res.next}/${res.total} 条`);
          break;
        }
        from = res.next;
      }
      await this.refresh();
    });
  },

  onClear() {
    this.withBusy(async () => {
      const ok = await new Promise((r) => wx.showModal({
        title: '清空词库',
        content: `将删除 worddict 全部 ${this.data.cloudCount} 条数据，分几轮删完，之后可重新导入。确认？`,
        success: (res) => r(res.confirm),
        fail: () => r(false),
      }));
      if (!ok) return;
      let total = 0;
      for (let round = 1; round <= MAX_ROUNDS; round += 1) {
        // 3 秒超时下删不完几千条，函数会主动返回 done:false + left，这里续跑
        const res = await callCloud('seed', { action: 'clearWorddict', confirm: true, timeBudgetMs: 2200 });
        total += res.removed;
        this.pushLog(`第 ${round} 轮：删除 ${res.removed} 条，云端剩余 ${res.left < 0 ? '未知' : res.left}`);
        if (res.done) {
          this.pushLog(`✓ 已清空，共删除 ${total} 条`);
          break;
        }
      }
      await this.refresh();
    });
  },

  /** 去重：先体检出报告，再确认删除多余的副本（同一 word_id 只保留一条）。 */
  onDedupe() {
    this.withBusy(async () => {
      const pre = await callCloud('seed', { action: 'dedupeWorddict' });
      this.pushLog(`体检：云端共 ${pre.total} 条，去重后 ${pre.unique} 条，${pre.duplicateGroups} 组重复 / 多余 ${pre.extraDocs} 条`);
      if (pre.dupSamples.length) {
        this.pushLog(`  重复样例：${pre.dupSamples.map((d) => `${d.word_id}×${d.count}`).join('、')}`);
      }
      if (pre.notInSource > 0) {
        this.pushLog(`  注意：${pre.notInSource} 条不在内置词库中（${pre.orphanSamples.join('、')}），不会被删除`);
      }
      if (pre.noWordId > 0) {
        this.pushLog(`  注意：${pre.noWordId} 条缺 word_id 字段，不会被删除`);
      }
      if (pre.extraDocs === 0) {
        this.pushLog('✓ 没有重复数据，无需清理');
        return;
      }
      const ok = await new Promise((r) => wx.showModal({
        title: '清理重复数据',
        content: `将删除 ${pre.extraDocs} 条重复副本，每个词保留一条。清理后剩 ${pre.unique} 条。确认？`,
        success: (res) => r(res.confirm),
        fail: () => r(false),
      }));
      if (!ok) {
        this.pushLog('已取消，未做改动');
        return;
      }
      let total = 0;
      for (let round = 1; round <= 10; round += 1) {
        const res = await callCloud('seed', { action: 'dedupeWorddict', confirm: true, timeBudgetMs: 2200 });
        total += res.removed;
        this.pushLog(`第 ${round} 轮：删除 ${res.removed} 条重复，剩余 ${res.remainingDuplicates} 条`);
        if (res.done) {
          this.pushLog(`✓ 清理完成，共删除 ${total} 条重复`);
          break;
        }
      }
      await this.refresh();
    });
  },

  // ==================== 内容数据（真题 / 故事） ====================

  onEnsureContentCollection() {
    this.withBusy(async () => {
      const res = await callCloud('contentseed', { action: 'ensureCollection' });
      const created = res.report.filter((r) => r.status === 'created').length;
      const failed = res.report.filter((r) => r.status === 'failed');
      this.pushLog(`✓ 内容集合已就位（新建 ${created} 个）`);
      if (failed.length) {
        failed.forEach((f) => this.pushLog(`✗ ${f.name}: ${f.msg}`));
        this.setData({ error: `建内容集合失败：${failed.map((f) => f.name).join('、')}` });
      }
      await this.refreshContent();
    });
  },

  onImportContent() {
    this.withBusy(async () => {
      let from = 0;
      let stalls = 0;
      for (let round = 1; round <= MAX_ROUNDS; round += 1) {
        let res;
        try {
          res = await callCloud('contentseed', {
            action: 'import',
            from,
            timeBudgetMs: 2500,
          });
        } catch (e) {
          stalls += 1;
          this.pushLog(`第 ${round} 轮中断（${shortErr(e)}），重试 ${stalls}/6`);
          if (stalls >= 6) throw e;
          await sleep(600);
          continue;
        }
        stalls = 0;
        this.pushLog(
          `第 ${round} 轮：上传 ${res.uploaded} 个${res.failed ? `，失败 ${res.failed} 个` : ''}，用时 ${(res.elapsedMs / 1000).toFixed(1)}s`
        );
        if (res.failed > 0) res.errors.forEach((e) => this.pushLog(`  ✗ ${e.path}: ${e.msg}`));
        this.setData({
          contentIndexed: res.next,
          contentRemaining: Math.max(0, res.total - res.next),
          contentProgress: res.total > 0 ? Math.round((res.next / res.total) * 100) : 0,
        });
        if (res.done) {
          this.pushLog(`✓ 内容全部导入完成，共 ${res.total} 个文件`);
          break;
        }
        from = res.next;
      }
      await this.refreshContent();
    });
  },

  onVerifyContent() {
    this.withBusy(async () => {
      const res = await callCloud('contentseed', { action: 'verify', count: 6 });
      this.pushLog(`抽查 ${res.checked} 个：成功 ${res.ok}，失败 ${res.failed}`);
      res.results.forEach((r) => {
        this.pushLog(r.ok ? `  ✓ ${r.path}（${(r.bytes / 1024).toFixed(1)}KB）` : `  ✗ ${r.path}: ${r.msg}`);
      });
      if (res.failed > 0) this.setData({ error: '有内容文件读不出来，建议重新执行「⑤ 导入真题 / 故事」' });
    });
  },

  onClearContent() {
    this.withBusy(async () => {
      const ok = await new Promise((r) => wx.showModal({
        title: '清空内容数据',
        content: `将删除 content_files 索引与对应云存储文件（${this.data.contentIndexed} 条），之后可重新导入。确认？`,
        success: (res) => r(res.confirm),
        fail: () => r(false),
      }));
      if (!ok) return;
      let total = 0;
      for (let round = 1; round <= MAX_ROUNDS; round += 1) {
        const res = await callCloud('contentseed', { action: 'clear', confirm: true, timeBudgetMs: 2500 });
        total += res.removed;
        this.pushLog(`第 ${round} 轮：删除 ${res.removed} 个，剩余 ${res.left < 0 ? '未知' : res.left}`);
        if (res.done) {
          this.pushLog(`✓ 已清空内容，共删除 ${total} 个`);
          break;
        }
      }
      await this.refreshContent();
    });
  },
});
