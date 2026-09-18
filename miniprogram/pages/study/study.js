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

const MODES = [
  { key: 'flashcard', label: '单词卡', icon: 'book-open-page-variant' },
  { key: 'listening', label: '听写', icon: 'volume-high' },
  { key: 'quiz', label: '释义', icon: 'pencil' },
  { key: 'article', label: '短文', icon: 'creation' },
];

const AUDIO_BASE = 'https://dict.youdao.com/dictvoice?type=2&audio=';

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
    this.customIds = options && options.wordIds ? String(options.wordIds).split(',').filter(Boolean) : [];
    this.isCustomReview = this.customIds.length > 0;
    this.queue = [];
    this.retry = {};
    this.removedCount = 0;
    this.newDone = 0;
    this.reviewDone = 0;
    this.audioCtx = null;
    this.load(false);
  },

  onUnload() {
    if (this.audioCtx) {
      try { this.audioCtx.destroy(); } catch (e) { /* noop */ }
    }
  },

  // ==================== 加载 ====================
  async load(force) {
    this.setData({ loading: true });
    try {
      if (!this.isCustomReview) {
        await fillTodayIfNeeded(force ? { force: true } : {});
      }
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

      const allStudiedToday = !this.isCustomReview && queue.length === 0;
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
        isEmptyState: queue.length === 0,
        emptyTitle: this.isCustomReview
          ? '暂无可复习单词'
          : allStudiedToday
            ? '今日任务已完成！'
            : '暂无单词',
        emptyText: this.isCustomReview
          ? '这些困难单词可能已被删除，请返回重新选择。'
          : allStudiedToday
            ? '你今天已经学完了所有可用单词。想继续可以点「继续学习」，也可以添加更多单词到生词本。'
            : '请先添加一些单词到生词本',
        completed: 0,
        correct: 0,
        newDone: 0,
        reviewDone: 0,
      });
      this.applyWord(queue[0] || null);
      this.prepareMode();
    } catch (e) {
      console.error('[study] 加载失败', e);
      this.setData({ loading: false, isEmptyState: true, emptyTitle: '加载失败', emptyText: '请稍后重试' });
    }
  },

  /** 刷新当前词的派生字段。 */
  applyWord(word) {
    if (!word) {
      this.setData({ current: null });
      return;
    }
    const level = Math.max(1, Math.min(5, word.difficulty || 1));
    const diffColors = ['#3F7A5C', '#7AA85F', '#D4A93A', '#C2603A', '#B5462E'];
    this.setData({
      current: word,
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
    if (!cur || !this.data.soundEnabled) return;
    try {
      if (this.audioCtx) {
        try { this.audioCtx.destroy(); } catch (e) { /* noop */ }
      }
      const ctx = wx.createInnerAudioContext();
      this.audioCtx = ctx;
      ctx.src = AUDIO_BASE + encodeURIComponent(cur.word);
      ctx.onPlay(() => this.setData({ playing: true }));
      ctx.onEnded(() => this.setData({ playing: false }));
      ctx.onError((err) => {
        this.setData({ playing: false });
        console.warn('[study] 发音播放失败：', (err && err.errMsg) || err);
        if (!silent) wx.showToast({ title: '发音播放失败', icon: 'none' });
      });
      ctx.play();
    } catch (e) {
      console.warn('[study] 当前环境不支持发音：', e);
      if (!silent) wx.showToast({ title: '当前环境不支持发音', icon: 'none' });
    }
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
    StorageService.addStudyRecord({
      word_id: cur.id,
      result: correct ? 1 : 0,
      study_mode: this.data.mode,
    });

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
        this.finishWord(cur, isNew);
        this.removeCurrent();
      } else if (c + 1 >= 2) {
        delete this.retry[cur.id];
        this.finishWord(cur, isNew);
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
      completionTitle: this.isCustomReview ? '强化复习完成！' : '今日目标达成！',
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
