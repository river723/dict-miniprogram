/**
 * content 云函数 —— 真题 / 故事内容分发（按篇存储于云存储，见 scripts/upload-content.mjs）。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  try {
    switch (event.action) {
      case 'examList': {
        const idx = await readJson('content/exams/index.json');
        return { ok: true, list: idx.exams };
      }
      case 'examDetail': {
        const exam = await readJson(`content/exams/${event.id}.json`);
        return { ok: true, exam };
      }
      case 'storyList': {
        const idx = await readJson('content/stories/index.json');
        return { ok: true, series: { series_title: idx.series_title, total_chapters: idx.total_chapters }, list: idx.chapters };
      }
      case 'storyDetail': {
        const story = await readJson(`content/stories/${event.id}.json`);
        return { ok: true, story };
      }
      default:
        return { ok: false, error: `unknown action: ${event.action}` };
    }
  } catch (e) {
    console.error('[content]', e);
    return { ok: false, error: e.message };
  }
};

async function readJson(cloudPath) {
  const res = await cloud.downloadFile({ fileID: `cloud:///${cloudPath}` });
  return JSON.parse(res.fileContent.toString('utf-8'));
}
