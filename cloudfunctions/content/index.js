/**
 * content 云函数 —— 真题 / 故事内容分发（按篇存储于云存储，见 scripts/upload-content.mjs）。
 *
 * 路径 → fileID 的映射来自 content_files 集合：downloadFile 只认完整 fileID
 * （cloud://<env>.<bucket>/<path>），bucket 段因环境而异无法推导，
 * 所以上传脚本把真实 fileID 落库，这里按路径查出再下载。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COL_FILES = 'content_files';

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
  const { data } = await db.collection(COL_FILES).where({ path: cloudPath }).limit(1).get();
  if (!data || data.length === 0) {
    throw new Error(`内容未就绪：${cloudPath}（请先执行 npm run upload:content，并确认已建 content_files 集合）`);
  }
  const res = await cloud.downloadFile({ fileID: data[0].fileID });
  return JSON.parse(res.fileContent.toString('utf-8'));
}
