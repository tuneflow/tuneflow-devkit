const pbjs = require('protobufjs-cli/pbjs');
const pbts = require('protobufjs-cli/pbts');
const path = require('path');
const fs = require('fs');

const outputDirectory = path.resolve(__dirname, '../src/debugger/pbjs');
if (!fs.existsSync(outputDirectory)) {
  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
  } catch (e) {}
}

pbjs.main(
  [
    '--target',
    'static-module',
    '-w',
    'es6',
    '-o',
    path.resolve(outputDirectory, 'song.js'),
    path.resolve(__dirname, '../protos/src/song.proto'),
  ],
  function (err) {
    if (err) throw err;
  },
);

pbts.main(
  ['-o', path.resolve(outputDirectory, 'song.d.ts'), path.resolve(outputDirectory, 'song.js')],
  function (err) {
    if (err) throw err;
  },
);
