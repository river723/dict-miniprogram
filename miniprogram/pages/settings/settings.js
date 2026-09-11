import StorageService from '../../services/storage';
import { DAILY_NEW_WORDS_LIMIT } from '../../theme/tokens';

Page({
  data: { settings: null, dailyOptions: [] },

  onShow() { this.refresh(); },

  refresh() {
    const dailyOptions = [];
    for (let n = 5; n <= DAILY_NEW_WORDS_LIMIT; n += 5) dailyOptions.push(n);
    this.setData({ settings: StorageService.getSettings(), dailyOptions });
  },

  async onDailyChange(e) {
    await StorageService.saveSettings({ dailyNewWords: this.data.dailyOptions[Number(e.detail.value)] });
    this.refresh();
  },

  async onAutoAddChange(e) {
    await StorageService.saveSettings({ autoAddNewWords: e.detail.value });
    this.refresh();
  },
});
