/**
 * mg-empty —— EmptyState 的小程序版。
 *
 *   <mg-empty icon="book-open-page-variant" title="添加你的第一个生词"
 *             description="添加 → 学习 → 复习 → 掌握" action-label="添加生词" bind:action="onAdd" />
 */
Component({
  options: { addGlobalClass: true },

  properties: {
    icon: { type: String, value: 'inbox-outline' },
    title: { type: String, value: '' },
    description: { type: String, value: '' },
    actionLabel: { type: String, value: '' },
    variant: { type: String, value: 'primary' },
    compact: { type: Boolean, value: false },
  },

  methods: {
    onAction() {
      this.triggerEvent('action');
    },
  },
});
