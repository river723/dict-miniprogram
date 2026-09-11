/**
 * mg-button —— AppButton 的小程序版。
 *
 * variant: primary 墨绿实底 / secondary 白底墨绿描边 / ghost 透明墨绿字 /
 *          danger 赭石实底 / success / warning
 * size:    sm 64rpx / md 80rpx（默认）/ lg 96rpx
 *
 *   <mg-button title="开始学习" variant="primary" size="lg" block icon="book-open-page-variant" bind:tap="onTap" />
 */
Component({
  options: { addGlobalClass: true },

  properties: {
    title: { type: String, value: '' },
    variant: { type: String, value: 'primary' },
    size: { type: String, value: 'md' },
    block: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
    /** 左侧图标名（MaterialCommunityIcons 名，同 App） */
    icon: { type: String, value: '' },
    iconSize: { type: null, value: 36 },
  },

  data: {
    iconColor: '#FFFFFF',
  },

  observers: {
    'variant'() {
      this.setData({ iconColor: this.computeIconColor() });
    },
  },

  lifetimes: {
    attached() {
      this.setData({ iconColor: this.computeIconColor() });
    },
  },

  methods: {
    computeIconColor() {
      const v = this.data.variant;
      if (v === 'secondary' || v === 'ghost') return '#2E5E4E';
      return '#FFFFFF';
    },

    onTap() {
      if (this.data.disabled || this.data.loading) return;
      this.triggerEvent('tap');
    },
  },
});
