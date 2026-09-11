/**
 * mg-icon —— AppIcon 的小程序版。
 * 用 App 原字体（MaterialCommunityIcons 子集，见 theme/icons.wxss）渲染，形状与 App 完全一致。
 * 颜色/字号直接由 color / size 控制。
 *
 *   <mg-icon name="plus-box" size="40" color="#2E5E4E" />
 */
const { iconChar } = require('../../theme/icons');

Component({
  options: { addGlobalClass: true },

  properties: {
    name: { type: String, value: '' },
    /** 字号，单位 rpx（App 的 px × 2） */
    size: { type: null, value: 32 },
    /** 颜色；留空则继承父级 color */
    color: { type: String, value: '' },
    disabled: { type: Boolean, value: false },
  },

  data: { char: '' },

  observers: {
    name(v) {
      this.setData({ char: iconChar(v) });
    },
  },

  lifetimes: {
    attached() {
      this.setData({ char: iconChar(this.data.name) });
    },
  },
});
