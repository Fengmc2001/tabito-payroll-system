const maintenanceWorker = {
  fetch() {
    return new Response('系统正在更新，请稍后再试。', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '60' },
    });
  },
  scheduled() {},
};

export default maintenanceWorker;
