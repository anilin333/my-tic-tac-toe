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

// 引き分け（“消える仕様”では実質ほぼ出ないが残しておく）
function isDraw(bd) {
  return bd.every(v => v !== '');
}

// 盤初期化
function resetGame() {
  board = Array(9).fill('');
  moveQueue = [];
  current = '〇';
  io.emit('clearMarks');                 // 薄さ全解除
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
    // ---- バリデーション ----
    if (!Number.isInteger(index)) index = parseInt(index, 10);
    if (index < 0 || index > 8) return;

    const symbol = players[socket.id];
    if (!symbol) return;
    if (symbol !== current) return;   // 手番でなければ無視
    if (board[index] !== '') return;  // 空マスのみ

    // ---- 着手反映 ----
    board[index] = symbol;
    moveQueue.push(index);
    io.emit('update', { index, player: symbol });

    // 置いた時点で「今の最古手」を薄く（= 次に消える候補）
    if (moveQueue.length >= MAX_STONES_ON_BOARD) {
      io.emit('markOldest', { index: moveQueue[0] });
    } else {
      io.emit('clearMarks');
    }

    // 8手目以降：最古手を自動消去
    if (moveQueue.length > MAX_STONES_ON_BOARD) {
      const oldest = moveQueue.shift();
      board[oldest] = '';
      io.emit('remove', { index: oldest });

      // 消した後の新しい最古を再度マーク
      if (moveQueue.length >= MAX_STONES_ON_BOARD) {
        io.emit('markOldest', { index: moveQueue[0] });
      } else {
        io.emit('clearMarks');
      }
    }

    // ---- 勝敗判定（消去後の状態で判定） ----
    const winLine = LINES.find(([a,b,c]) => board[a] && board[a] === board[b] && board[b] === board[c]);
    if (winLine) {
      io.emit('win', { winner: symbol, line: winLine }); // 勝者とラインを送る
      resetGame();
      return;
    }
    if (isDraw(board)) {
      io.emit('draw');
      resetGame();
      return;
    }

    // ---- 手番交代 ----
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