// 1) 必要モジュール
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// 2) 基盤
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 3) 静的配信（同フォルダの index.html を配る）
app.use(express.static(__dirname));

// 4) ゲーム状態
const MAX_STONES_ON_BOARD = 7; // ← 8手目以降は最古手を消す
const LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

let players = {};              // socket.id -> '〇' | '×'
let seats = [];                // 参加順（最大2人）
let current = '〇';            // 手番
let board = Array(9).fill(''); // '', '〇', '×'
let moveQueue = [];            // 打たれたセルindexのFIFO（最古管理）

// 勝利判定
function checkWin(bd) {
  return LINES.some(([a,b,c]) => bd[a] && bd[a] === bd[b] && bd[b] === bd[c]);
}
// 引き分け（“消える仕様”では通常発生しにくい）
function isDraw(bd) {
  return bd.every(v => v !== '');
}
// 盤初期化
function resetGame() {
  board = Array(9).fill('');
  moveQueue = [];
  current = '〇';
  io.emit('reset', { board, current });
}

io.on('connection', (socket) => {
  // 3人目以降は入室拒否
  if (seats.length >= 2) {
    socket.emit('roomFull');
    socket.disconnect(true);
    return;
  }

  // 記号割り当て
  seats.push(socket.id);
  const symbol = seats.length === 1 ? '〇' : '×';
  players[socket.id] = symbol;

  // 自分に現状通知
  socket.emit('assigned', symbol);
  socket.emit('board', { board, current });

  // 2人そろったら手番告知
  if (seats.length === 2) io.emit('turn', current);

  // クライアントからの着手
  socket.on('move', (index) => {
    // バリデーション
    if (!Number.isInteger(index)) index = parseInt(index, 10);
    if (index < 0 || index > 8) return;

    const symbol = players[socket.id];
    if (!symbol) return;
    if (symbol !== current) return;   // 手番でなければ無視
    if (board[index] !== '') return;  // 空マスのみ

    // 置く
    board[index] = symbol;
    moveQueue.push(index);
    io.emit('update', { index, player: symbol });

    // 8手目以降：最古手を自動消去
    if (moveQueue.length > MAX_STONES_ON_BOARD) {
      const oldest = moveQueue.shift();
      board[oldest] = '';
      io.emit('remove', { index: oldest }); // クライアントはここでセルを空に
    }

    // 勝敗判定（消去後の状態で判定）
    if (checkWin(board)) {
      io.emit('win', symbol);
      resetGame();
      return;
    }
    if (isDraw(board)) {
      io.emit('draw');
      resetGame();
      return;
    }

    // 手番交代
    current = current === '〇' ? '×' : '〇';
    io.emit('turn', current);
  });

  // 任意：クライアントから明示リセット要請
  socket.on('requestReset', () => resetGame());

  // 切断処理
  socket.on('disconnect', () => {
    seats = seats.filter(id => id !== socket.id);
    delete players[socket.id];
    io.emit('system', 'player left');
    resetGame();
  });
});

// 5) 起動
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`listening on http://localhost:${PORT}`);
});