const { Op } = require('sequelize');
const { getModels } = require('../sequelize');
let timer;
async function cleanupOrderUploads() {
  const model = getModels()?.OrderDocumentUpload;
  if (model) await model.destroy({ where: { expiresAt: { [Op.lte]: new Date() } } });
}
function startOrderUploadCleanupJob() {
  if (timer) return;
  const run = () => cleanupOrderUploads().catch(error => console.error('Order upload cleanup failed:', error.message));
  run();
  timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
}
function stopOrderUploadCleanupJob() { clearInterval(timer); timer = undefined; }
module.exports = { cleanupOrderUploads, startOrderUploadCleanupJob, stopOrderUploadCleanupJob };
