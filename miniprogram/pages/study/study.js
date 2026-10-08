/**
 * 背诵 / 复习页 —— 对齐 memo-grad StudyScreen + FlashcardStudy。
 *
 * 四种模式：单词卡(flashcard) / 听写(listening) / 释义(quiz) / 短文(article)
 * 队列语义与 App 一致：
 *   - 答对且首次过关 → 出队（并生成后续艾宾浩斯复习计划）
 *   - 答对但在重试中 → 计数 +1，满 2 次才过关，否则移到队尾
 *   - 答错 → 进入重试模式，移到队尾
 *   - 「太简单」→ 直接移出生词本
 */
import StorageService from '../../services/storage';
import { getDueReviewWords } from '../../services/studyPlan';
import { fillTodayIfNeeded } from '../../services/autoWord';
import { callCloud } from '../../services/cloud';
import { formatDate, addDays } from '../../utils/util';
import { REVIEW_INTERVALS } from '../../theme/tokens';
import { applyTheme } from '../../utils/theme';
import { createTtsPlayer, prefetch } from '../../utils/tts';

const MODES = [
  { key: 'flashcard', label: '单词卡', icon: 'book-open-page-variant' },
  { key: 'listening', label: '听写', icon: 'volume-high' },
  { key: 'quiz', label: '释义', icon: 'pencil' },
  { key: 'article', label: '短文', icon: 'creation' },
];

// ========== 跨实例缓存：真机调试重连防护 ==========
// 真机调试连接调试器时，微信偶发会把当前页面销毁再重建（新实例），
// 此时 this._inited 已失效（新实例），会再跑一次 load → 首张卡先闪现、被重建后又重现。
// 页面模块会被运行时缓存，故模块级变量在实例重建后仍然存在；用「最近构建的队列 + 时间戳」
// 在新实例 onLoad 时直接复用，既消除首卡闪两遍，也免去一次云调用。
let _lastQueue = null;
let _lastQueueAt = 0;
let _lastCustomIds = null;
const REUSE_WINDOW = 1500; // ms

/** 统一空态文案（两处构建分支共用，避免重复的长三元）。 */
function computeEmptyState(queue, isCustomReview) {
  const empty = queue.length === 0;
  const allStudiedToday = !isCustomReview && empty;
  return {
    isEmptyState: empty,
    emptyTitle: isCustomReview
      ? '暂无可复习单词'
      : allStudiedToday
        ? '今日任务已完成！'
        : '暂无单词',
    emptyText: isCustomReview
      ? '这些困难单词可能已被删除，请返回重新选择。'
      : allStudiedToday
        ? '你今天已经学完了所有可用单词。想继续可以点「继续学习」，也可以添加更多单词到生词本。'
        : '请先添加一些单词到生词本',
  };
}


function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 单词长度自适应字号（与 App 一致，单位 rpx = px × 2）。 */
function wordFontSize(word) {
  const n = (word || '').length;
  if (n <= 6) return 112;
  if (n <= 8) return 92;
  if (n <= 11) return 76;
  return 60;
}

Page({
  onShow() {
    applyTheme(this);
  },
  data: {
    modes: MODES,
    mode: 'flashcard',

    loading: true,
    current: null,
    total: 0,
    trulyCompleted: 0,
    progressPercent: 0,
    accuracyText: '0.0%',

    flipped: false,
    wordFontSize: 112,
    difficultyColor: '#2E5E4E',

    soundEnabled: true,
    autoPlaySound: true,
    playing: false,

    // 释义模式
    options: [],
    selectedAnswer: '',
    showQuizResult: false,

    // 听写模式
    listenStarted: false,
    listenAnswer: '',
    listenSubmitted: false,
    listenCorrect: false,

    // 短文模式
    articleLoading: false,
    articleError: '',
    articleSegments: [],
    articleTranslation: '',
    articleWords: [],
    showTranslation: false,

    // 完成 / 退出
    showCompletion: false,
    completionNew: 0,
    completionReview: 0,
    completionAccuracy: '0.0%',
    completionIcon: 'party-popper',
    completionTitle: '今日目标达成！',
    completionDetail: '0/0 正确',
    isEmptyState: false,
    emptyTitle: '',
    emptyText: '',
    showExitConfirm: false,

    exitLearned: 0,
    exitTotal: 0,
    exitAccuracy: '0.0%',

    modalWord: null,
    showWordModal: false,

    completed: 0,
    correct: 0,
    newDone: 0,
    reviewDone: 0,
  },

  onLoad(options) {
    console.log('[study] onLoad 调用, 重入(已初始化过)=', !!this._inited);

    // 真机调试重连 / 重复导航会把 study 页再 navigateTo 压一层 → 导航栈里出现两个 study 页，
    // 表现为「首卡闪两遍 + 左滑还能返回一层首卡」。检测到栈内已存在 study 页（当前之外），
    // 直接关闭自身，复用底下那层，彻底消除重复实例（正常导航图不会把 study 嵌套在 study 下）。
    const pages = getCurrentPages() || [];
    const dup = pages.slice(0, -1).some((p) => {
      const r = p && (p.route || p.__route__);
      return !!r && r.indexOf('pages/study/study') >= 0;
    });
    if (dup) {
      console.log('[study] 检测到栈内已有 study 页（重复实例），关闭自身以复用底层');
      this._loading = false;
      wx.navigateBack({ delta: 1 });
      return;
    }

    // 真机调试 / 重连时微信框架偶发 onLoad 重入：若已初始化则直接 return，
    // 否则会再次 load() → 队列重建 → 第一张卡先闪现、被重置后又重现（"出现两次"）。
    if (this._inited) return;
    this._inited = true;

    this.customIds = options && options.wordIds ? String(options.wordIds).split(',').filter(Boolean) : [];
    this.isCustomReview = this.customIds.length > 0;
    // 纯加练（今日回顾）：不写 StudyRecord、不推进复习计划，避免污染今日完成数/正确率/复习节奏。
    this.isPureReview = !!(options && options.pure && String(options.pure) === '1');
    this.queue = [];
    this.retry = {};
    this.removedCount = 0;
    this.newDone = 0;
    this.reviewDone = 0;
    this.tts = createTtsPlayer({
      onPlay: () => this.setData({ playing: true }),
      onEnd: () => this.setData({ playing: false }),
      onError: (err, opts) => {
        this.setData({ playing: false });
        console.warn('[study] 发音播放失败：', (err && err.errMsg) || err);
        if (!opts.silent) wx.showToast({ title: '发音播放失败', icon: 'none' });
      },
    });
    this.load(false);
  },

  onUnload() {
    if (this.tts) this.tts.destroy();
  },

  // ==================== 加载 ====================
  async load(force) {
    // 单飞：用布尔标志 + onLoad 的 _inited 守卫，双重防止「真机调试 onLoad 重入」导致
    // 队列被构建两次、首张卡闪两遍。
    // ⚠️ 本工具链把 async 转译成 generator，嵌套的「async 箭头 IIFE」经转译后返回的是
    // 生成器对象（无 .then/.finally），对其调用 Promise 方法会直接抛错。因此这里放弃
    // "持有内层 Promise"的写法，改用同步 try/finally 块（语句块 finally ≠ Promise.finally，
    // 前者所有环境都支持）来释放标志位。
    if (this._loading) return;
    this._loading = true;
    console.log('[study] load 开始（云调用已加超时兜底：callCloud 25s / fill 12s）');
    try {
      // —— 真机调试重连防护 ——（放在 setData(loading:true) 之前，确保复用分支绝不闪 loading）
      // 真机调试连上调试器时，微信可能把页面销毁重建（新实例，this._inited 失效），
      // 触发第二次 load → 首卡先闪现、被重建后又重现（用户看到的"闪两遍"）。
      // 若距上次成功构建队列 < 1.5s 且参数一致（几乎必是重连重建），直接复用上次队列，
      // 跳过 loading 遮罩与云调用，闪屏即可消失。（force=true 的"继续学习"不会命中。）
      const _now = Date.now();
      const _sameCustom = JSON.stringify(this.customIds) === JSON.stringify(_lastCustomIds);
      if (!force && _sameCustom && _lastQueue && _now - _lastQueueAt < REUSE_WINDOW) {
        console.log('[study] 命中重连重建防护：复用上次队列，跳过云调用与重建');
        const q = _lastQueue.slice();
        this.queue = q;
        this.retry = {};
        this.removedCount = 0;
        this.newDone = 0;
        this.reviewDone = 0;
        const empty = computeEmptyState(q, this.isCustomReview);
        this.setData({
          loading: false,
          total: q.length,
          trulyCompleted: 0,
          progressPercent: 0,
          accuracyText: '0.0%',
          current: q[0] || null,
          flipped: false,
          showCompletion: false,
          isEmptyState: empty.isEmptyState,
          emptyTitle: empty.emptyTitle,
          emptyText: empty.emptyText,
          completed: 0,
          correct: 0,
          newDone: 0,
          reviewDone: 0,
        });
        this.applyWord(q[0] || null);
        this.prepareMode();
        return;
      }

      this.setData({ loading: true });

      if (!this.isCustomReview) {
        // 真机调试首次云调用可能长期挂起：用 12s 局部兜底，超时则本轮跳过自动配词、
        // 直接用已有生词本进入，绝不阻塞学习页（cloud.js 另有 25s 全局兜底）。
        console.log('[study] → 开始自动配词(fillTodayIfNeeded)');
        const fillP = fillTodayIfNeeded(force ? { force: true } : {});
        const fillGuard = new Promise((_, rej) =>
          setTimeout(() => rej(new Error('fill 局部超时 12s')), 12000));
        await Promise.race([fillP, fillGuard]).catch((e) =>
          console.warn('[study] 自动配词本轮跳过：', e && e.message));
        console.log('[study] ← 自动配词结束');
      }
      console.log('[study] → 读取本地词库与设置');
      const settings = StorageService.getSettings();
      const words = StorageService.getWords();
      let queue = [];

      if (this.isCustomReview) {
        const set = {};
        this.customIds.forEach((id) => { set[id] = true; });
        queue = words.filter((w) => set[String(w.id)]);
      } else {
        const records = StorageService.getStudyRecords();
        const studied = {};
        records.forEach((r) => { studied[r.word_id] = true; });
        const dailyLimit = typeof settings.dailyNewWords === 'number' ? settings.dailyNewWords : 10;
        const newWords = words.filter((w) => !studied[w.id]).slice(0, dailyLimit);
        const dueWords = getDueReviewWords().slice(0, 30);
        queue = newWords.concat(dueWords);
      }

      this.queue = queue;
      this.retry = {};
      this.removedCount = 0;
      this.newDone = 0;
      this.reviewDone = 0;

      console.log('[study] 队列构建完成 count=', queue.length);

      // 缓存最近队列，供「真机调试重连导致页面重建」时新实例直接复用（见 load 顶部分支）。
      _lastQueue = queue;
      _lastQueueAt = Date.now();
      _lastCustomIds = this.customIds ? this.customIds.slice() : [];

      const empty = computeEmptyState(queue, this.isCustomReview);
      this.setData({
        loading: false,
        soundEnabled: settings.soundEnabled !== false,
        autoPlaySound: settings.autoPlaySound !== false,
        total: queue.length,
        trulyCompleted: 0,
        progressPercent: 0,
        accuracyText: '0.0%',
        current: queue[0] || null,
        flipped: false,
        showCompletion: false,
        isEmptyState: empty.isEmptyState,
        emptyTitle: empty.emptyTitle,
        emptyText: empty.emptyText,
        completed: 0,
        correct: 0,
        newDone: 0,
        reviewDone: 0,
      });
      this.applyWord(queue[0] || null);
      this.prepareMode();
      console.log('[study] ✅ 进入完成，loading=false，current=', this.data.current && this.data.current.word);
    } catch (e) {
      console.error('[study] 加载失败', e);
      this.setData({ loading: false, isEmptyState: true, emptyTitle: '加载失败', emptyText: '请稍后重试' });
    } finally {
      this._loading = false;
    }
  },

  /** 刷新当前词的派生字段。 */
  applyWord(word) {
    if (!word) {
      this.setData({ current: null });
      return;
    }
    const level = Math.max(1, Math.min(5, word.difficulty || 1));
    const freq = Math.max(0, Math.min(5, word.frequency || 0));
    const diffColors = ['#3F7A5C', '#7AA85F', '#D4A93A', '#C2603A', '#B5462E'];
    // 背面要展示该词全部信息：把难度/考频转成可直接渲染的星/方块字符串（对齐详情页）。
    const cur = Object.assign({}, word, {
      diffStars: '★'.repeat(level) + '☆'.repeat(5 - level),
      freqSquares: '■'.repeat(freq) + '□'.repeat(5 - freq),
      diffColor: diffColors[level - 1],
    });
    this.setData({
      current: cur,
      wordFontSize: wordFontSize(word.word),
      difficultyColor: diffColors[level - 1],
      flipped: false,
      selectedAnswer: '',
      showQuizResult: false,
      listenStarted: false,
      listenAnswer: '',
      listenSubmitted: false,
    });
  },

  // ==================== 模式 ====================
  switchMode(e) {
    const mode = e.currentTarget.dataset.key;
    if (mode === this.data.mode) return;
    this.setData({ mode, flipped: false, selectedAnswer: '', showQuizResult: false, listenStarted: false, listenAnswer: '', listenSubmitted: false, articleError: '' });
    this.prepareMode();
  },

  prepareMode() {
    const mode = this.data.mode;
    if (mode === 'quiz') this.buildQuizOptions();
    if (mode === 'flashcard') this.maybeAutoPlay();
  },

  buildQuizOptions() {
    const cur = this.data.current;
    if (!cur) return;
    const correct = ((cur.definitions || [])[0] || {}).meaning || '';
    if (!correct) {
      this.setData({ options: [] });
      return;
    }
    const pool = StorageService.getWords()
      .filter((w) => w.id !== cur.id)
      .map((w) => ((w.definitions || [])[0] || {}).meaning || '')
      .filter((m) => m && m !== correct);
    const uniq = Array.from(new Set(pool));
    const distractors = shuffle(uniq).slice(0, 3);
    const options = shuffle([correct].concat(distractors)).map((text, i) => ({
      key: `opt-${i}-${text.slice(0, 6)}`,
      text,
    }));
    this.setData({ options, selectedAnswer: '', showQuizResult: false });
  },

  // ==================== 单词卡 ====================
  flipCard() {
    if (this.data.flipped) return;
    this.setData({ flipped: true });
  },

  unflipCard() {
    this.setData({ flipped: false });
  },

  /** 翻到新词时自动朗读：需「发音功能」与「学新单词时自动朗读」两个开关都开。 */
  maybeAutoPlay() {
    if (!this.data.soundEnabled || !this.data.autoPlaySound) return;
    if (!this.data.current) return;
    this.doPlay(true);
    // 首次发音要走云函数（约 0.5~1.5s），提前把下一个词预热到本地，翻卡时就能立刻出声
    const next = this.queue && this.queue[1];
    if (next) prefetch(next.word);
  },

  /** 手动点击朗读（wxml: catchtap="playAudio"）。 */
  playAudio() {
    this.doPlay(false);
  },

  /**
   * 实际播放。
   * 自动播放走 silent=true —— 失败不弹 toast，否则每个词弹一次"播放失败"会烦死人，
   * 只写 console 便于真机调试定位（尤其音频域名未配置的情况）。
   */
  doPlay(silent) {
    const cur = this.data.current;
    if (!cur || !this.data.soundEnabled || !this.tts) return;
    this.tts.play(cur.word, { silent });
  },

  onKnown() {
    if (!this.data.flipped) return;
    this.handleResult(true);
  },

  onUnknown() {
    if (!this.data.flipped) return;
    this.handleResult(false);
  },

  async onTooEasy() {
    const cur = this.data.current;
    if (!cur) return;
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '移出生词本',
        content: `确定把「${cur.word}」移出生词本吗？`,
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false),
      });
    });
    if (!confirm) return;
    await StorageService.deleteWord(cur.id);
    this.removedCount += 1;
    this.setData({ total: Math.max(0, this.data.total - 1) });
    wx.showToast({ title: `已移出「${cur.word}」`, icon: 'none' });
    this.removeCurrent();
  },

  // ==================== 释义 ====================
  onSelectOption(e) {
    if (this.data.showQuizResult) return;
    const text = e.currentTarget.dataset.text;
    const cur = this.data.current;
    if (!cur) return;
    const correct = ((cur.definitions || [])[0] || {}).meaning || '';
    const isCorrect = text === correct;
    this.setData({ selectedAnswer: text, showQuizResult: true });
    setTimeout(() => {
      this.handleResult(isCorrect);
    }, 1500);
  },

  // ==================== 听写 ====================
  startListening() {
    this.playAudio();
    this.setData({ listenStarted: true });
  },

  onListenInput(e) {
    this.setData({ listenAnswer: e.detail.value });
  },

  submitListen() {
    const cur = this.data.current;
    if (!cur) return;
    const ok = this.data.listenAnswer.trim().toLowerCase() === String(cur.word).toLowerCase();
    this.setData({ listenSubmitted: true, listenCorrect: ok });
    setTimeout(() => this.handleResult(ok), 1200);
  },

  skipListen() {
    this.handleResult(false);
  },

  // ==================== 短文 ====================
  async generateArticle() {
    if (this.data.articleLoading) return;
    const words = this.queue.slice(0, 30).map((w) => w.word);
    if (words.length === 0) {
      this.setData({ articleError: '本轮暂无可用于生成短文的单词' });
      return;
    }
    this.setData({ articleLoading: true, articleError: '', showTranslation: false });
    try {
      const res = await callCloud('ai', { action: 'story', words });
      const content = res.content || '';
      const { segments, translation } = parseArticle(content, words);
      this.setData({ articleSegments: segments, articleTranslation: translation, articleLoading: false });
    } catch (e) {
      this.setData({ articleLoading: false, articleError: e.message || '生成失败，请稍后重试' });
    }
  },

  toggleTranslation() {
    this.setData({ showTranslation: !this.data.showTranslation });
  },

  onArticleWordTap(e) {
    const word = e.currentTarget.dataset.word;
    const found = StorageService.getWords().find((w) => w.word.toLowerCase() === String(word).toLowerCase());
    if (found) {
      this.setData({ modalWord: found, showWordModal: true });
    } else {
      wx.showToast({ title: '生词本中暂无该词释义', icon: 'none' });
    }
  },

  closeWordModal() {
    this.setData({ showWordModal: false });
  },

  // ==================== 结果处理 ====================
  async finishWord(word, isNew) {
    if (isNew) this.newDone += 1;
    else this.reviewDone += 1;
    const today = formatDate();
    const plans = StorageService.getStudyPlans();
    for (const p of plans) {
      if (p.word_id === word.id && p.plan_date === today && !p.completed) {
        await StorageService.completePlan(p.id);
      }
    }
    const latest = StorageService.getStudyPlans();
    for (const interval of REVIEW_INTERVALS) {
      const date = formatDate(addDays(new Date(), interval));
      const exists = latest.some((p) => p.word_id === word.id && p.plan_date === date);
      if (!exists) {
        await StorageService.addStudyPlan({
          word_id: word.id,
          plan_date: date,
          plan_type: 'review',
          completed: false,
        });
      }
    }
  },

  handleResult(correct) {
    const cur = this.data.current;
    if (!cur) return;

    const isNew = !StorageService.getStudyRecords().some((r) => r.word_id === cur.id);

    // 纯加练（今日回顾）：跳过「写学习记录」与「推进复习计划」两项持久化，
    // 这样本次加练不计入今日完成数 / 正确率，也不改变后续复习节奏。
    // 队列 / 重试 / 当次正确率反馈逻辑保持不变（仅内存态，关闭即消失）。
    if (!this.isPureReview) {
      StorageService.addStudyRecord({
        word_id: cur.id,
        result: correct ? 1 : 0,
        study_mode: this.data.mode,
      });
    }

    const completed = this.data.completed + 1;
    const correctCount = this.data.correct + (correct ? 1 : 0);
    this.setData({
      completed,
      correct: correctCount,
      accuracyText: `${((correctCount / completed) * 100).toFixed(1)}%`,
    });

    if (correct) {
      const c = this.retry[cur.id];
      if (c === undefined) {
        if (!this.isPureReview) this.finishWord(cur, isNew);
        this.removeCurrent();
      } else if (c + 1 >= 2) {
        delete this.retry[cur.id];
        if (!this.isPureReview) this.finishWord(cur, isNew);
        this.removeCurrent();
      } else {
        this.retry[cur.id] = c + 1;
        this.rotateQueue();
      }
    } else {
      this.retry[cur.id] = 0;
      this.rotateQueue();
    }
  },

  /** 过关：出队；队列空则进完成态。 */
  removeCurrent() {
    const done = this.data.trulyCompleted + 1;
    const q = this.queue.slice(1);
    this.queue = q;
    const percent = this.data.total > 0 ? Math.round((done / this.data.total) * 100) : 0;
    this.setData({ trulyCompleted: done, progressPercent: percent });

    if (q.length === 0) {
      this.showCompletion();
    } else {
      this.applyWord(q[0]);
      this.prepareMode();
    }
  },

  /** 未过关：移到队尾。 */
  rotateQueue() {
    if (this.queue.length > 0) {
      this.queue.push(this.queue.shift());
    }
    this.applyWord(this.queue[0] || null);
    this.prepareMode();
  },

  showCompletion() {
    const completed = this.data.completed;
    const correct = this.data.correct;
    const acc = completed > 0 ? correct / completed : 0;
    this.setData({
      current: null,
      showCompletion: true,
      completionIcon: acc >= 0.8 ? 'party-popper' : 'fire',
      completionTitle: this.isPureReview ? '今日回顾完成！' : (this.isCustomReview ? '强化复习完成！' : '今日目标达成！'),
      completionNew: this.newDone,
      completionReview: this.reviewDone,
      completionAccuracy: `${(acc * 100).toFixed(1)}%`,
      completionDetail: `${correct}/${completed} 正确`,
    });
  },

  newDoneInc() { this.newDone += 1; },
  reviewDoneInc() { this.reviewDone += 1; },

  // ==================== 完成态按钮 ====================
  onContinue() {
    this.load(true);
  },

  onBackFromCompletion() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) });
  },

  goAddWord() {
    wx.navigateTo({ url: '/pages/add-word/add-word' });
  },

  // ==================== 退出确认 ====================
  openExit() {
    const completed = this.data.completed;
    const correct = this.data.correct;
    this.setData({
      showExitConfirm: true,
      exitLearned: this.data.trulyCompleted,
      exitTotal: this.data.total,
      exitAccuracy: completed > 0 ? ((correct / completed) * 100).toFixed(0) : '0',
    });
  },

  closeExit() {
    this.setData({ showExitConfirm: false });
  },

  confirmExit() {
    this.setData({ showExitConfirm: false });
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) });
  },

  backFromEmpty() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/home' }) });
  },
});

/** 解析 AI 短文：把 **word** 标记切成可点击片段，并拆出中文翻译。 */
function parseArticle(content, words) {
  const idx = content.indexOf('中文翻译');
  let body = content;
  let translation = '';
  if (idx > 0) {
    body = content.slice(0, idx);
    translation = content.slice(idx).replace(/^[^：:]*[：:]\s*/, '').trim();
  }
  const lower = words.map((w) => w.toLowerCase());
  const segments = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m = re.exec(body);
  while (m) {
    if (m.index > last) segments.push({ text: body.slice(last, m.index), hit: false });
    const token = m[1];
    segments.push({ text: token, hit: lower.indexOf(token.toLowerCase()) >= 0 });
    last = m.index + m[0].length;
    m = re.exec(body);
  }
  if (last < body.length) segments.push({ text: body.slice(last), hit: false });
  return { segments: segments.filter((s) => s.text), translation };
}
