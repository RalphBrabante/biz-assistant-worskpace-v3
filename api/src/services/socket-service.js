let io = null;

function setSocketServer(server) {
  io = server || null;
}

function getSocketServer() {
  return io;
}

module.exports = {
  setSocketServer,
  getSocketServer,
};

