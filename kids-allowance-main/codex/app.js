/*
  Rich UI Shogi (将棋) - Vanilla JS
  - 9x9 board SVG rendering
  - Drag & drop or click-to-move
  - Legal move generation incl. drops & promotion
  - Komadai (hands), move list, undo/redo
  - Optional simple CPU (random legal move)
*/

(() => {
  const BOARD_SIZE = 9;
  const ORIGIN = 50; // board inner top-left in SVG units
  const B = 'b'; // Sente
  const W = 'w'; // Gote

  const TYPES = ['K','R','B','G','S','N','L','P'];
  const PROMOTES_TO_GOLD = new Set(['S','N','L','P']);
  const PROMOTABLE = new Set(['R','B','S','N','L','P']);

  const KANJI = {
    K: '玉', R: '飛', B: '角', G: '金', S: '銀', N: '桂', L: '香', P: '歩',
    '+R': '龍', '+B': '馬', '+S': '全', '+N': '圭', '+L': '杏', '+P': 'と',
  };

  // Directions for Sente (B) facing up (row decreases). Gote is mirrored.
  const DIRS = {
    K: [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]],
    G: [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,0]],
    S: [[-1,-1],[-1,0],[-1,1],[1,-1],[1,1]],
    N: [[-2,-1],[-2,1]], // leaper
    L: [[-1,0]], // slider forward only
    P: [[-1,0]],
    R: [[-1,0],[1,0],[0,-1],[0,1]], // slider orthogonal
    B: [[-1,-1],[-1,1],[1,-1],[1,1]], // slider diagonal
    '+S': [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,0]],
    '+N': [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,0]],
    '+L': [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,0]],
    '+P': [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,0]],
  };
  const SLIDERS = new Set(['R','B','L','+R','+B']);

  function deepClone(o){ return JSON.parse(JSON.stringify(o)); }
  function inBounds(r,c){ return r>=0 && r<BOARD_SIZE && c>=0 && c<BOARD_SIZE; }
  function enemy(of){ return of===B ? W : B; }

  function startPosition(){
    const b = Array.from({length: BOARD_SIZE}, () => Array(BOARD_SIZE).fill(null));
    // Gote (W) at top rows 0..2
    b[0] = [ 'L','N','S','G','K','G','S','N','L' ].map(t => ({t, p: W, pr:false}));
    b[1] = [ null, 'R', null, null, null, null, null, 'B', null ].map(x => x?({t:x,p:W,pr:false}):null);
    b[2] = Array.from({length:9}, () => ({t:'P', p: W, pr:false}));
    // Sente (B) at bottom rows 6..8
    b[8] = [ 'L','N','S','G','K','G','S','N','L' ].map(t => ({t, p: B, pr:false}));
    b[7] = [ null, 'B', null, null, null, null, null, 'R', null ].map(x => x?({t:x,p:B,pr:false}):null);
    b[6] = Array.from({length:9}, () => ({t:'P', p: B, pr:false}));
    return b;
  }

  function cloneBoard(board){
    return board.map(row => row.map(cell => cell? {...cell}: null));
  }

  function rotateFor(player, dr, dc){
    return player===B ? [dr, dc] : [-dr, -dc];
  }

  function pieceLabel(piece){
    const key = piece.pr ? '+'+piece.t : piece.t;
    return KANJI[key];
  }

  function isPromotionZone(player, row){
    return player===B ? row<=2 : row>=6;
  }

  function mustPromote(piece, toRow){
    if(piece.t==='P' || piece.t==='L'){
      return (piece.p===B && toRow===0) || (piece.p===W && toRow===8);
    }
    if(piece.t==='N'){
      return (piece.p===B && toRow<=1) || (piece.p===W && toRow>=7);
    }
    return false;
  }

  function promotePiece(piece){
    if(!PROMOTABLE.has(piece.t)) return piece;
    if(piece.t==='R') return {...piece, pr:true}; // +R
    if(piece.t==='B') return {...piece, pr:true}; // +B
    if(PROMOTES_TO_GOLD.has(piece.t)) return {...piece, pr:true};
    return piece;
  }

  function demote(piece){
    // When captured, demote and change owner.
    return { t: piece.t, p: enemy(piece.p), pr: false };
  }

  function goldLikeDirs(){ return DIRS.G; }

  function dirsFor(piece){
    if(piece.pr){
      if(piece.t==='R') return [...DIRS.R]; // dragon: rook sliders + king-diagonals (handled later)
      if(piece.t==='B') return [...DIRS.B]; // horse: bishop sliders + king-orthogonals
      return goldLikeDirs();
    }
    return DIRS[piece.t] || [];
  }

  function isSlider(piece){
    if(piece.pr && (piece.t==='R' || piece.t==='B')) return true;
    return SLIDERS.has(piece.t);
  }

  function genPseudoMoves(board, r, c){
    const piece = board[r][c];
    if(!piece) return [];
    const moves = [];
    const baseDirs = dirsFor(piece).map(([dr,dc]) => rotateFor(piece.p, dr, dc));

    const tryPush = (rr,cc) => {
      if(!inBounds(rr,cc)) return false;
      const target = board[rr][cc];
      if(!target){ moves.push({from:[r,c], to:[rr,cc]}); return true; }
      if(target.p !== piece.p){ moves.push({from:[r,c], to:[rr,cc]}); }
      return false; // cannot pass through
    };

    // Sliders & leapers
    const sliding = isSlider(piece);
    for(const [dr,dc] of baseDirs){
      if(sliding){
        let rr=r+dr, cc=c+dc;
        while(true){ if(!tryPush(rr,cc)) break; rr+=dr; cc+=dc; }
      } else {
        const rr=r+dr, cc=c+dc; tryPush(rr,cc);
      }
    }

    // For +R (dragon) add king-diagonals; for +B (horse) add king-orthogonals
    if(piece.pr && piece.t==='R'){
      for(const [dr,dc] of [[-1,-1],[-1,1],[1,-1],[1,1]].map(v=>rotateFor(piece.p, ...v))){
        const rr=r+dr, cc=c+dc; if(inBounds(rr,cc) && (!board[rr][cc] || board[rr][cc].p!==piece.p)) moves.push({from:[r,c], to:[rr,cc]});
      }
    }
    if(piece.pr && piece.t==='B'){
      for(const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]].map(v=>rotateFor(piece.p, ...v))){
        const rr=r+dr, cc=c+dc; if(inBounds(rr,cc) && (!board[rr][cc] || board[rr][cc].p!==piece.p)) moves.push({from:[r,c], to:[rr,cc]});
      }
    }

    // Add promotion choices (flag only), decision later
    const out = [];
    for(const m of moves){
      const piece0 = board[r][c];
      const [tr,tc] = m.to;
      if(piece0 && PROMOTABLE.has(piece0.t)){
        const enters = isPromotionZone(piece0.p, tr) || isPromotionZone(piece0.p, r);
        const forced = mustPromote(piece0, tr);
        if(forced){ out.push({...m, promote:true}); }
        else if(enters){ out.push({...m, promote:true}); out.push({...m, promote:false}); }
        else { out.push({...m, promote:false}); }
      } else {
        out.push({...m, promote:false});
      }
    }
    return out;
  }

  function findKing(board, player){
    for(let r=0;r<BOARD_SIZE;r++){
      for(let c=0;c<BOARD_SIZE;c++){
        const pc = board[r][c];
        if(pc && pc.p===player && pc.t==='K') return [r,c];
      }
    }
    return null;
  }

  function attacksSquare(board, attacker, tr, tc){
    // generate all pseudo moves of attacker side and see if any hits [tr,tc]
    for(let r=0;r<BOARD_SIZE;r++){
      for(let c=0;c<BOARD_SIZE;c++){
        const pc = board[r][c];
        if(pc && pc.p===attacker){
          const list = genPseudoMoves(board, r, c);
          for(const m of list){ if(m.to[0]===tr && m.to[1]===tc) return true; }
        }
      }
    }
    return false;
  }

  function isCheck(board, player){
    const kpos = findKing(board, player);
    if(!kpos) return false;
    return attacksSquare(board, enemy(player), kpos[0], kpos[1]);
  }

  function makeMove(state, move){
    const ns = deepClone(state);
    const {board, hands, turn} = ns;
    if(move.drop){
      const t = move.dropType;
      const [r,c] = move.to;
      board[r][c] = { t, p: turn, pr:false };
      hands[turn][t] = (hands[turn][t]||0) - 1;
    } else {
      const [fr,fc] = move.from; const [tr,tc] = move.to;
      const piece = board[fr][fc];
      let moving = {...piece};
      const captured = board[tr][tc];
      if(captured){
        const d = demote(captured);
        hands[turn][d.t] = (hands[turn][d.t]||0) + 1;
      }
      if(move.promote){ moving = promotePiece(moving); }
      board[tr][tc] = moving;
      board[fr][fc] = null;
    }
    ns.turn = enemy(turn);
    return ns;
  }

  function equalMove(a,b){
    return a.drop===b.drop &&
      (a.drop ? (a.dropType===b.dropType && a.to[0]===b.to[0] && a.to[1]===b.to[1])
              : (a.from[0]===b.from[0] && a.from[1]===b.from[1] && a.to[0]===b.to[0] && a.to[1]===b.to[1] && !!a.promote===!!b.promote));
  }

  function genAllPseudo(state){
    const {board, turn} = state;
    const list = [];
    for(let r=0;r<BOARD_SIZE;r++){
      for(let c=0;c<BOARD_SIZE;c++){
        const pc = board[r][c];
        if(pc && pc.p===turn){ list.push(...genPseudoMoves(board, r, c)); }
      }
    }
    // Drops
    list.push(...genDrops(state));
    return list;
  }

  function hasUnpromotedPawnOnFile(board, player, file){
    for(let r=0;r<BOARD_SIZE;r++){
      const pc = board[r][file];
      if(pc && pc.p===player && pc.t==='P' && !pc.pr) return true;
    }
    return false;
  }

  function genDrops(state){
    const {board, hands, turn} = state;
    const list = [];
    for(const t of TYPES){
      const count = hands[turn][t]||0;
      if(!count) continue;
      for(let r=0;r<BOARD_SIZE;r++){
        for(let c=0;c<BOARD_SIZE;c++){
          if(board[r][c]) continue;
          // piece-specific drop restrictions
          if(t==='P'){
            // nifu & last rank
            if(hasUnpromotedPawnOnFile(board, turn, c)) continue;
            if((turn===B && r===0) || (turn===W && r===8)) continue;
          }
          if(t==='L' && ((turn===B && r===0) || (turn===W && r===8))) continue;
          if(t==='N' && ((turn===B && r<=1) || (turn===W && r>=7))) continue;
          list.push({drop:true, dropType:t, to:[r,c]});
        }
      }
    }
    return list;
  }

  function legalMoves(state){
    const pseudo = genAllPseudo(state);
    const legals = [];
    for(const m of pseudo){
      const ns = makeMove(state, m);
      if(!isCheck(ns.board, enemy(ns.turn))) legals.push(m); // after move, if my king is safe
    }
    return legals;
  }

  function initialState(){
    return {
      board: startPosition(),
      hands: { [B]:{}, [W]:{} },
      turn: B,
    };
  }

  // --- UI ---
  const elBoard = document.getElementById('board');
  const elMoves = document.getElementById('movesList');
  const elKomadaiB = document.getElementById('komadaiB');
  const elKomadaiW = document.getElementById('komadaiW');
  const elTurnText = document.getElementById('turnText');
  const elStatus = document.getElementById('statusText');
  // We avoid <template> for SVG because of namespace issues on some browsers.

  const BTN = {
    newGame: document.getElementById('newGameBtn'),
    undo: document.getElementById('undoBtn'),
    redo: document.getElementById('redoBtn'),
    flip: document.getElementById('flipBtn'),
    cpu: document.getElementById('playCpuChk'),
  };

  const state = {
    cur: initialState(),
    past: [],
    future: [],
    flipped: false,
    selected: null, // {from:[r,c]} or {drop:t}
    legal: [],
    cpuPlays: W, // CPU will move as Gote when enabled
  };

  // Render board grid and defs once
  function drawStatic(){
    elBoard.innerHTML = '';
    const defs = svg('defs');
    const grad = svg('linearGradient',{id:'pieceGradient',x1:'0',y1:'0',x2:'0',y2:'1'});
    grad.append(
      svg('stop',{offset:'0%','stop-color':'#ffe2a9'}),
      svg('stop',{offset:'100%','stop-color':'#e7b769'})
    );
    const boardGrad = svg('linearGradient',{id:'boardGrad',x1:'0',y1:'0',x2:'0',y2:'1'});
    boardGrad.append(
      svg('stop',{offset:'0%','stop-color':'#e7c088'}),
      svg('stop',{offset:'100%','stop-color':'#caa064'})
    );
    defs.append(grad);
    defs.append(boardGrad);
    elBoard.append(defs);

    const bg = svg('rect',{x:ORIGIN-10,y:ORIGIN-10,width:CELL*9+20,height:CELL*9+20, fill:'url(#boardGrad)', stroke:'#6f4d1d','stroke-width':'2', rx:'8', ry:'8'});
    elBoard.append(bg);

    const group = svg('g',{class:'grid'});
    // squares highlight layer
    const hl = svg('g',{id:'hl'});
    elBoard.append(hl);

    // grid lines
    for(let i=0;i<BOARD_SIZE;i++){
      group.append(svg('line',{x1:ORIGIN, y1:ORIGIN+i*CELL, x2:ORIGIN+CELL*8, y2:ORIGIN+i*CELL, class:'grid-line'}));
      group.append(svg('line',{x1:ORIGIN+i*CELL, y1:ORIGIN, x2:ORIGIN+i*CELL, y2:ORIGIN+CELL*8, class:'grid-line'}));
    }
    // outer border
    group.append(svg('rect',{x:ORIGIN, y:ORIGIN, width:CELL*8, height:CELL*8, fill:'none', class:'grid-line'}));
    elBoard.append(group);

    // coordinates (1..9 / 一..九)
    const nums = ['９','８','７','６','５','４','３','２','１'];
    const kans = ['一','二','三','四','五','六','七','八','九'];
    const coord = svg('g');
    for(let i=0;i<9;i++){
      coord.append(svg('text',{x:ORIGIN+i*CELL, y:ORIGIN-15, class:'coord', 'text-anchor':'middle'}, nums[i]));
      coord.append(svg('text',{x:ORIGIN+CELL*8+15, y:ORIGIN+i*CELL+6, class:'coord'}, kans[i]));
    }
    elBoard.append(coord);

    // pieces layer
    const pcs = svg('g',{id:'pieces'});
    elBoard.append(pcs);
  }

  function svg(tag, attrs={}, text){
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for(const [k,v] of Object.entries(attrs)) el.setAttribute(k, v);
    if(text!=null) el.textContent = text;
    el.append = (...nodes)=>nodes.forEach(n=>el.appendChild(n));
    return el;
  }

  const CELL = 100;
  const MARGIN_X = 10; // piece left/right margin inside a cell
  const MARGIN_Y = 6;  // piece top margin inside a cell

  function boardToScreen(r,c){
    // Return top-left anchor within cell with margins
    const rr = state.flipped ? 8-r : r;
    const cc = state.flipped ? 8-c : c;
    const x = 50 + cc*CELL + MARGIN_X;
    const y = 50 + rr*CELL + MARGIN_Y;
    return [x,y];
  }

  function screenToBoard(x,y){
    const cc = Math.floor((x-50)/100);
    const rr = Math.floor((y-50)/100);
    const r = state.flipped ? 8-rr : rr;
    const c = state.flipped ? 8-cc : cc;
    if(rr<0||rr>8||cc<0||cc>8) return null;
    return [r,c];
  }

  function render(){
    const {board, hands, turn} = state.cur;
    elTurnText.textContent = turn===B?'先手（▲）':'後手（△）';
    // Clear highlights
    const hl = elBoard.querySelector('#hl');
    hl.innerHTML = '';

    // Render pieces
    const pcs = elBoard.querySelector('#pieces');
    pcs.innerHTML = '';
    for(let r=0;r<BOARD_SIZE;r++){
      for(let c=0;c<BOARD_SIZE;c++){
        const pc = board[r][c];
        if(!pc) continue;
        const g = buildPiece(pc, r, c);
        pcs.appendChild(g);
      }
    }

    // Render hands
    renderHands(elKomadaiB, hands[B], B);
    renderHands(elKomadaiW, hands[W], W);

    renderMovesList();
    bindPieceEvents();
  }

  function buildPiece(pc, r, c){
    const g = svg('g', { class: `piece ${pc.p}`, tabindex: '0' });
    const inner = svg('g');
    // Piece shape designed to fit within 80x90 box (0..80 x 0..90)
    const body = svg('polygon', { class: 'piece-body', points: '0,6 80,6 78,26 40,90 2,26' });
    const text = svg('text', { class: 'piece-text', x: '40', y: '55', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, pieceLabel(pc));
    inner.append(body, text);
    if(pc.p===W){ inner.setAttribute('transform', 'rotate(180 40 50)'); }
    g.append(inner);
    const [x,y]=boardToScreen(r,c);
    g.setAttribute('transform', `translate(${x},${y})`);
    g.dataset.r = r; g.dataset.c = c;
    return g;
  }

  function renderHands(el, hand, player){
    el.innerHTML = '';
    const order = ['R','B','G','S','N','L','P'];
    for(const t of order){
      const n = hand[t]||0; if(!n) continue;
      const div = document.createElement('button');
      div.className = 'hand-piece';
      div.dataset.player = player; div.dataset.type = t;
      div.title = `${player===B?'先手':'後手'}の${KANJI[t]}打ち`;
      div.innerHTML = `<span class="k">${KANJI[t]}</span> <span class="count">x${n}</span>`;
      div.addEventListener('click', ()=>{
        if(state.cur.turn!==player){ flashStatus('手番ではありません'); return; }
        state.selected = {drop:true, t};
        state.legal = legalMoves(state.cur).filter(m=>m.drop && m.dropType===t);
        paintLegalTargets();
      });
      el.appendChild(div);
    }
  }

  function bindPieceEvents(){
    const pcs = elBoard.querySelectorAll('.piece');
    pcs.forEach(el=>{
      el.addEventListener('mousedown', pieceDown);
      el.addEventListener('touchstart', pieceDown, {passive:false});
      el.addEventListener('click', pieceClick);
    });
    document.addEventListener('mousemove', pieceMove);
    document.addEventListener('mouseup', pieceUp);
    document.addEventListener('touchmove', pieceMove, {passive:false});
    document.addEventListener('touchend', pieceUp);
  }

  let dragging = null; // {el, from:[r,c], offset:[dx,dy]}

  function pieceClick(e){
    const g = e.currentTarget;
    const r = +g.dataset.r, c = +g.dataset.c;
    const pc = state.cur.board[r][c];
    if(!pc) return;
    if(pc.p!==state.cur.turn){ flashStatus('手番ではありません'); return; }
    state.selected = {from:[r,c]};
    state.legal = legalMoves(state.cur).filter(m=>!m.drop && m.from[0]===r && m.from[1]===c);
    paintLegalTargets();
  }

  function pieceDown(e){
    e.preventDefault();
    const g = e.currentTarget;
    const r = +g.dataset.r, c = +g.dataset.c;
    const pc = state.cur.board[r][c];
    if(!pc || pc.p!==state.cur.turn) return;
    const [x0,y0] = pointerXY(e);
    const [gx,gy] = g.getCTM().f ? [g.getCTM().e, g.getCTM().f] : [parseFloat(g.getAttribute('transform').split(/[(),]/)[1]), parseFloat(g.getAttribute('transform').split(/[(),]/)[2])];
    dragging = { el:g, from:[r,c], offset:[x0-gx, y0-gy] };
    state.selected = {from:[r,c]};
    state.legal = legalMoves(state.cur).filter(m=>!m.drop && m.from[0]===r && m.from[1]===c);
    paintLegalTargets();
  }

  function pieceMove(e){
    if(!dragging) return;
    const [x,y] = pointerXY(e);
    const [dx,dy] = dragging.offset;
    dragging.el.setAttribute('transform', `translate(${x-dx},${y-dy})`);
  }

  function pieceUp(e){
    if(!dragging) return;
    const [x,y] = pointerXY(e);
    const target = screenToBoard(x,y);
    const from = dragging.from;
    const g = dragging.el;
    dragging = null;
    if(!target){ render(); return; }
    const move = chooseBestMatch(state.legal, {from, to:target});
    if(!move){ render(); return; }
    doMoveWithPromotion(move);
  }

  function pointerXY(e){
    const pt = elBoard.createSVGPoint();
    if(e.touches && e.touches[0]){ pt.x = e.touches[0].clientX; pt.y = e.touches[0].clientY; }
    else { pt.x = e.clientX; pt.y = e.clientY; }
    const m = elBoard.getScreenCTM().inverse();
    return [pt.x*m.a + pt.y*m.c + m.e, pt.x*m.b + pt.y*m.d + m.f];
  }

  function paintLegalTargets(){
    const hl = elBoard.querySelector('#hl');
    hl.innerHTML = '';
    for(const m of state.legal){
      const [r,c] = m.to;
      const rr = state.flipped ? 8-r : r;
      const cc = state.flipped ? 8-c : c;
      const x = 50 + cc*100 - 50;
      const y = 50 + rr*100 - 50;
      const rect = svg('rect',{x, y, width:100, height:100, rx:8, ry:8, class:'square-move'});
      rect.addEventListener('click', ()=>{ doMoveWithPromotion(m); });
      hl.append(rect);
    }
  }

  function chooseBestMatch(candidates, pattern){
    // Prefercing same to square and promotion if forced
    const sameTo = candidates.filter(m=>m.to[0]===pattern.to[0] && m.to[1]===pattern.to[1]);
    if(!sameTo.length) return null;
    // if multiple (promote or not), ask later in doMoveWithPromotion
    // pick a default (no promote preferred except forced)
    const forced = sameTo.find(m=>m.promote && mustPromote(state.cur.board[pattern.from[0]][pattern.from[1]], m.to[0]));
    if(forced) return forced;
    const noProm = sameTo.find(m=>!m.promote);
    return noProm || sameTo[0];
  }

  function doMoveWithPromotion(move){
    // If this is a drop, just play
    if(move.drop){ commitMove(move); return; }
    // If both promote:true/false exist for same from-to, confirm
    const twins = state.legal.filter(m=>!m.drop && m.from[0]===move.from[0] && m.from[1]===move.from[1] && m.to[0]===move.to[0] && m.to[1]===move.to[1]);
    const both = twins.length>=2 && twins.some(m=>m.promote) && twins.some(m=>!m.promote);
    const pc = state.cur.board[move.from[0]][move.from[1]];
    if(both){
      const yes = confirm(`${KANJI[pc.pr?('+'+pc.t):pc.t]} を成りますか？`);
      move = twins.find(m=>!!m.promote===!!yes) || move;
    }
    commitMove(move);
  }

  function commitMove(move){
    state.past.push(state.cur);
    state.future = [];
    state.cur = makeMove(state.cur, move);
    pushKifu(move);
    state.selected = null; state.legal=[];
    render();
    checkGameEnd();
    maybeCpuMove();
  }

  function pushKifu(move){
    const s = formatMove(state.past[state.past.length-1], move);
    const li = document.createElement('li');
    li.textContent = s;
    elMoves.appendChild(li);
    elMoves.querySelectorAll('li').forEach(n=>n.classList.remove('current'));
    li.classList.add('current');
    elMoves.scrollTop = elMoves.scrollHeight;
  }

  function formatMove(before, move){
    const to = move.to; const [tr,tc]=to;
    const files = ['９','８','７','６','５','４','３','２','１'];
    const ranks = ['一','二','三','四','五','六','七','八','九'];
    if(move.drop){
      return `${before.turn===B?'▲':'△'}${files[tc]}${ranks[tr]} ${KANJI[move.dropType]}打`;
    }
    const pc = before.board[move.from[0]][move.from[1]];
    const cap = before.board[tr][tc] ? 'x' : '';
    const prom = move.promote ? '成' : '';
    return `${before.turn===B?'▲':'△'}${files[tc]}${ranks[tr]} ${KANJI[pc.pr?('+'+pc.t):pc.t]}${cap}${prom}`;
  }

  function renderMovesList(){
    // no-op here; list grows on commit
  }

  function flashStatus(msg){
    elStatus.textContent = msg;
    setTimeout(()=>{ elStatus.textContent=''; }, 1200);
  }

  function checkGameEnd(){
    const moves = legalMoves(state.cur);
    if(moves.length===0){
      const winner = enemy(state.cur.turn);
      alert(`${winner===B?'先手':'後手'}の勝ち（詰み）`);
    }
  }

  // Controls
  BTN.newGame.addEventListener('click', ()=>{
    state.cur = initialState();
    state.past = []; state.future = []; state.selected=null; state.legal=[];
    elMoves.innerHTML='';
    render();
  });
  BTN.undo.addEventListener('click', ()=>{
    if(!state.past.length) return;
    state.future.push(state.cur);
    state.cur = state.past.pop();
    // remove last kifu
    const last = elMoves.lastElementChild; if(last) last.remove();
    render();
  });
  BTN.redo.addEventListener('click', ()=>{
    if(!state.future.length) return;
    state.past.push(state.cur);
    state.cur = state.future.pop();
    // cannot reconstruct move text easily; leave as-is
    render();
  });
  BTN.flip.addEventListener('click', ()=>{ state.flipped=!state.flipped; render(); });
  BTN.cpu.addEventListener('change', ()=>{ maybeCpuMove(true); });

  function maybeCpuMove(justChanged){
    const enabled = BTN.cpu.checked;
    if(!enabled) return;
    const cpuSide = state.cpuPlays;
    if(state.cur.turn!==cpuSide) return;
    // small delay for UX
    setTimeout(()=>{
      const moves = legalMoves(state.cur);
      if(!moves.length) return;
      const mv = pickCpuMove(moves);
      doMoveWithPromotion(mv);
    }, justChanged?0:250);
  }

  function pickCpuMove(moves){
    // Very naive: prefer capture; else random
    const caps = moves.filter(m=>!m.drop && m);
    const sorted = moves.slice().sort((a,b)=>{
      const av = moveValue(a), bv = moveValue(b);
      return bv-av;
    });
    return sorted[0];
  }

  function moveValue(m){
    if(m.drop) return 0;
    // quick heuristic: capture value + promotion bonus
    const before = state.cur.board;
    const trg = before[m.to[0]][m.to[1]];
    const valTable = {K:1000,R:9,B:8,G:5,S:4,N:3,L:3,P:1};
    let v = 0;
    if(trg) v += valTable[trg.t]||0;
    if(m.promote) v += 0.5;
    return v + Math.random()*0.1;
  }

  // Click on board to complete drop or deselect
  elBoard.addEventListener('click', (e)=>{
    if(!state.selected) return;
    const [x,y] = pointerXY(e);
    const target = screenToBoard(x,y);
    if(!target){ state.selected=null; state.legal=[]; render(); return; }
    if(state.selected.drop){
      const mv = state.legal.find(m=>m.to[0]===target[0] && m.to[1]===target[1]);
      if(mv) commitMove(mv);
    }
  });

  // Init
  drawStatic();
  render();
})();
