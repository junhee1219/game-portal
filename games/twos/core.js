// 2048 — 순수 로직 (DOM 없음, node test.js로 검증 가능)
// 한 줄(4칸)을 "앞(index 0)"으로 밀어 같은 수를 합치는 게 핵심.
// slideIndices: 값 배열을 받아 결과값 + 점수 + 타일별 이동(애니메이션용 from→to)을 돌려준다.
(function (root) {
  'use strict';

  // 한 줄을 index 0 방향으로 밀고 합친다.
  //   vals: [n,n,n,n] (0 = 빈칸)
  //   반환: { result:[...], gained, moves:[{from,to,merged,survivor?}], moved }
  //     merged 한 쌍은 두 from이 같은 to로 이동(survivor=true가 살아남아 값 2배+팝).
  function slideIndices(vals) {
    var n = vals.length;
    var src = [];                       // 비어있지 않은 칸의 원래 index (앞에서부터)
    for (var i = 0; i < n; i++) if (vals[i]) src.push(i);

    var result = new Array(n).fill(0);
    var moves = [];
    var gained = 0;
    var dst = 0, k = 0;
    while (k < src.length) {
      var a = src[k];
      if (k + 1 < src.length && vals[src[k + 1]] === vals[a]) {
        var b = src[k + 1];
        var v = vals[a] * 2;
        result[dst] = v; gained += v;
        moves.push({ from: a, to: dst, merged: true, survivor: true });
        moves.push({ from: b, to: dst, merged: true, survivor: false });
        k += 2;
      } else {
        result[dst] = vals[a];
        moves.push({ from: a, to: dst, merged: false, survivor: false });
        k += 1;
      }
      dst++;
    }

    var moved = false;
    for (var j = 0; j < n; j++) { if (result[j] !== vals[j]) { moved = true; break; } }
    return { result: result, gained: gained, moves: moves, moved: moved };
  }

  // 한 방향에서 각 줄의 좌표를 "앞→뒤" 순서로 만든다 (size×size 보드).
  //   dir: 'left'|'right'|'up'|'down' → [[ [r,c],... ] × size]
  function lines(size, dir) {
    var out = [];
    for (var p = 0; p < size; p++) {
      var line = [];
      for (var q = 0; q < size; q++) {
        var r, c;
        if (dir === 'left')  { r = p; c = q; }
        else if (dir === 'right') { r = p; c = size - 1 - q; }
        else if (dir === 'up')    { r = q; c = p; }
        else /* down */           { r = size - 1 - q; c = p; }
        line.push([r, c]);
      }
      out.push(line);
    }
    return out;
  }

  // 숫자 보드 한 번 이동 (테스트/판정용). board: size×size 2D 배열(0=빈칸).
  //   반환: { board:새보드, gained, moved }
  function move(board, dir) {
    var size = board.length;
    var nb = board.map(function (row) { return row.slice(); });
    var gained = 0, moved = false;
    var ls = lines(size, dir);
    for (var i = 0; i < ls.length; i++) {
      var coords = ls[i];
      var vals = coords.map(function (rc) { return board[rc[0]][rc[1]]; });
      var res = slideIndices(vals);
      gained += res.gained;
      if (res.moved) moved = true;
      for (var j = 0; j < coords.length; j++) {
        nb[coords[j][0]][coords[j][1]] = res.result[j];
      }
    }
    return { board: nb, gained: gained, moved: moved };
  }

  // 빈칸 좌표 목록
  function emptyCells(board) {
    var out = [];
    for (var r = 0; r < board.length; r++)
      for (var c = 0; c < board[r].length; c++)
        if (!board[r][c]) out.push([r, c]);
    return out;
  }

  // 움직일 수 있는 수가 남았는가 (빈칸 또는 인접 같은 값)
  function hasMoves(board) {
    var size = board.length;
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        var v = board[r][c];
        if (!v) return true;
        if (c + 1 < size && board[r][c + 1] === v) return true;
        if (r + 1 < size && board[r + 1][c] === v) return true;
      }
    }
    return false;
  }

  // 보드 최대 타일
  function maxTile(board) {
    var m = 0;
    for (var r = 0; r < board.length; r++)
      for (var c = 0; c < board[r].length; c++)
        if (board[r][c] > m) m = board[r][c];
    return m;
  }

  var api = { slideIndices: slideIndices, lines: lines, move: move, emptyCells: emptyCells, hasMoves: hasMoves, maxTile: maxTile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TwosCore = api;
})(typeof self !== 'undefined' ? self : this);
