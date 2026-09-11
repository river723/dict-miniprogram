/**
 * mg-stat-strip —— StatStrip 的小程序版：横向 metric 行。
 *
 *   <mg-stat-strip metrics="{{[{value:3,label:'今日已完成'},{value:'78%',label:'今日正确率',trend:'up'}]}}" />
 *
 * trend: up | down | flat（up/down 会在数值右侧显示细箭头）
 */
Component({
  options: { addGlobalClass: true },

  properties: {
    metrics: { type: Array, value: [] },
    compact: { type: Boolean, value: false },
  },

  data: { items: [] },

  observers: {
    metrics(list) {
      const items = (list || []).map((m) => {
        const trend = m.trend || 'flat';
        return {
          value: m.value,
          label: m.label,
          trendValue: m.trendValue || '',
          tint: m.tint || '',
          trendIcon: trend === 'up' ? 'arrow-up-thin' : trend === 'down' ? 'arrow-down-thin' : '',
          trendColor: trend === 'up' ? '#3F7A5C' : trend === 'down' ? '#B5462E' : '#8A8E89',
          showTrend: trend === 'up' || trend === 'down',
        };
      });
      this.setData({ items });
    },
  },
});
