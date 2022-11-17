const { Server } = require('socket.io');
const { createServer } = require('http');
const Config = require('./config.json');

let dawClient = null;
let devKitClient = null;
const httpServer = createServer();

const server = new Server(httpServer, {
  pingTimeout: 300000,
  // Setting a high limit so that we don't get disconnected accidentally,
  // in reality these heavy duty work should be handled through shared memory.
  maxHttpBufferSize: 1024 * 1000 * 20, // 10MB
  cors: {
    origin: '*',
  },
});

server.of('/daw').on('connection', socket => {
  console.log('new daw connection');
  dawClient = socket;
  socket.on('error', e => {
    console.error(e);
  });
  socket.on('disconnect', reason => {
    dawClient = null;
    console.error('daw disconnected');
  });
  for(const messageType of ['set-song','init-plugin','run-plugin']) {
    socket.on(messageType, (payload, callback) => {
      if (!devKitClient) {
        return;
      }
      devKitClient.emit(messageType, payload, ack => {
        callback(ack);
      });
    });
  }
  
});

server.of('/devKit').on('connection', socket => {
  console.log('new dev kit connection');
  devKitClient = socket;
  socket.on('error', e => {
    console.error(e);
  });
  socket.on('disconnect', reason => {
    devKitClient = null;
    console.error('dev kit disconnected');
  });
});

httpServer.on('listening', () => {
  console.log('starting dev proxy server on port', Config.DevProxyPort);
});

httpServer.listen(Config.DevProxyPort);
