/**
 * mg-modal —— AppModal / ConfirmDialog 的小程序版：遮罩 + 居中卡片。
 *
 *   <mg-modal visible="{{show}}" title="确认删除" content="删除后无法恢复"
 *             confirm-text="删除" danger bind:confirm="onConfirm" bind:cancel="onCancel" />
 *
 * 支持默认插槽自定义正文（如退出确认里的统计卡）：
 *   <mg-modal visible="{{show}}" title="退出学习？" bind:confirm="onConfirm">
 *     <view>…自定义内容…</view>
 *   </mg-modal>
 */
Component({
  options: { addGlobalClass: true, multipleSlots: true },

  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '' },
    content: { type: String, value: '' },
    /** 标题上方图标气泡（可选） */
    icon: { type: String, value: '' },
    iconTone: { type: String, value: 'danger' }, // danger | primary | warning
    confirmText: { type: String, value: '确定' },
    cancelText: { type: String, value: '取消' },
    showCancel: { type: Boolean, value: true },
    showActions: { type: Boolean, value: true },
    /** 确认按钮是否用危险色 */
    danger: { type: Boolean, value: false },
    /** 点击遮罩是否关闭 */
    maskClosable: { type: Boolean, value: true },
    /** 是否纵向排列按钮（默认横排） */
    actionsVertical: { type: Boolean, value: false },
  },

  methods: {
    noop() {},

    onMaskTap() {
      if (!this.data.maskClosable) return;
      this.triggerEvent('cancel');
      this.triggerEvent('close');
    },

    onCancel() {
      this.triggerEvent('cancel');
      this.triggerEvent('close');
    },

    onConfirm() {
      this.triggerEvent('confirm');
    },
  },
});
