/**
 * mg-section-header —— SectionHeader 的小程序版：节标题 + 可选副标题/图标 + 右侧 action。
 *
 *   <mg-section-header title="最近添加" action-label="查看生词本" bind:action="onMore" />
 */
Component({
  options: { addGlobalClass: true },

  properties: {
    title: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    actionLabel: { type: String, value: '' },
    icon: { type: String, value: '' },
    compact: { type: Boolean, value: false },
  },

  methods: {
    onAction() {
      this.triggerEvent('action');
    },
  },
});
