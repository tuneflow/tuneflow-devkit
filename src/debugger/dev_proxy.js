const { Server } = require('socket.io');
const { createServer } = require('http');
const Config = require('./config.json');
const fs = require('fs');

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

  for(const messageType of ['call-api']) {
    socket.on(messageType, (payload, callback) => {
      // Resolve the request if it can be done here.
      if(messageType === 'call-api') {
        const apiName = payload[0];
        if(apiName === 'readAudioBuffer') {
          const filePath = payload[1];
          const fileContent = fs.readFileSync(filePath);
          console.log('reading audio buffer file, length', fileContent.length);
          callback(fileContent);
          return;
        } else  if(apiName === 'readFile') {
          const filePath = payload[1];
          const fileBuffer = fs.readFileSync(filePath);
          console.log('reading file', filePath, 'length', fileBuffer.length);
          callback(fileBuffer);
          return;
        }
      }
      // Try to call the DAW to resolve this request.
      if (!dawClient) {
        return;
      }
      dawClient.emit(messageType, payload, ack => {
        callback(ack);
      });
    });
  }
});

httpServer.on('listening', () => {
  console.log('starting dev proxy server on port', Config.DevProxyPort);
});

httpServer.listen(Config.DevProxyPort);
