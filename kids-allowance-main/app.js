// キッズぽけっと｜お小遣い管理
// 依存なしのバニラJS。データは localStorage に保存。

(function(){
  const LS_KEY = 'kid-allowance-v1';
  const $ = (q, el=document) => el.querySelector(q);
  const $$ = (q, el=document) => Array.from(el.querySelectorAll(q));

  // ----- State -----
  const initialState = () => ({
    childName: '',
    avatar: '🐻',
    currency: '¥',
    theme: 'cute', // 'cute' | 'adventure'
    transactions: [], // {id, type:income|expense|goal|chore, amount, note, dateISO}
    goals: [], // {id, name, target, saved}
    chores: [
      { id: id(), name:'ベッドをととのえる', reward:100, lastDone:'' },
      { id: id(), name:'しょるいをかたづける', reward:100, lastDone:'' },
      { id: id(), name:'しょくだい', reward:150, lastDone:'' },
    ],
  });

  let state = load() || seed();

  // ----- Utils -----
  function id(){ return Math.random().toString(36).slice(2,9) }
  function today(){ return new Date().toISOString().slice(0,10) }
  function format(n){
    const sign = n < 0 ? '-' : '';
    const v = Math.abs(Math.round(n));
    return sign + v.toLocaleString('ja-JP');
  }
  function money(n){ return `${state.currency}${format(n)}` }
  function save(){ localStorage.setItem(LS_KEY, JSON.stringify(state)); }
  function load(){ try{ return JSON.parse(localStorage.getItem(LS_KEY) || ''); }catch{ return null } }
  function seed(){
    const st = initialState();
    st.childName = 'なまえ';
    st.transactions = [
      { id:id(), type:'income', amount:300, note:'はじめてのおこづかい', dateISO:new Date().toISOString() },
      { id:id(), type:'expense', amount:120, note:'おやつ', dateISO:new Date().toISOString() },
    ];
    st.goals = [ { id:id(), name:'レゴ', target:2000, saved:300 } ];
    localStorage.setItem(LS_KEY, JSON.stringify(st));
    return st;
  }

  function computeBalance(){
    return state.transactions.reduce((sum, t)=>{
      if(t.type==='income' || t.type==='chore') return sum + t.amount;
      if(t.type==='expense' || t.type==='goal') return sum - t.amount;
      return sum;
    }, 0);
  }

  // ----- Rendering -----
  function renderAll(){
    applyTheme();
    renderHeader();
    renderTabs();
    renderHome();
    renderTransactions();
    renderGoals();
    renderChores();
    renderSettings();
  }

  function renderHeader(){
    $('#avatarButton').textContent = state.avatar;
    $('#childName').value = state.childName || '';
    $('#balance').textContent = money(computeBalance());
  }

  function renderTabs(){
    $$('.tab').forEach(btn=>{
      btn.onclick = ()=>{
        $$('.tab').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        $$('.view').forEach(v=>v.classList.remove('active'));
        $(`#view-${tab}`).classList.add('active');
      };
    });
    // Controller/keyboard: left/right to switch tabs (skip when typing)
    document.addEventListener('keydown', (e)=>{
      const t = e.target;
      if(t && ['INPUT','TEXTAREA','SELECT'].includes(t.tagName)) return;
      if(e.key==='ArrowLeft' || e.key==='ArrowRight'){
        const tabs = $$('.tab');
        const idx = tabs.findIndex(b=>b.classList.contains('active'));
        if(idx>=0){
          const next = (idx + (e.key==='ArrowRight'?1:-1) + tabs.length) % tabs.length;
          tabs[next].click();
          tabs[next].focus();
          e.preventDefault();
        }
      }
      if(e.key==='Escape'){
        // close any open fallback dialog
        const openDlg = $('.dialog.open');
        if(openDlg){ closeModal(openDlg); }
      }
    }, { once:true });
  }

  function renderHome(){
    // recent
    const recent = [...state.transactions].sort((a,b)=>b.dateISO.localeCompare(a.dateISO)).slice(0,6);
    const ul = $('#recentList');
    ul.innerHTML = '';
    if(recent.length===0){ ul.innerHTML = '<li>まだないよ</li>'; }
    recent.forEach(t=>{
      const li = document.createElement('li');
      const icon = t.type==='income' || t.type==='chore' ? '＋' : '−';
      const col = t.type==='income' || t.type==='chore' ? 'good' : 'bad';
      li.innerHTML = `
        <div>
          <div class="note">${escapeHtml(t.note||labelForType(t.type))}</div>
          <div class="meta">${dateJa(t.dateISO)}</div>
        </div>
        <div class="amount ${col}">${icon}${money(t.amount)}</div>
      `;
      ul.appendChild(li);
    });

    // quick buttons
    $('#quickAdd100').onclick = ()=> addTx('income', 100, 'プチおこづかい', true);
    $('#quickAdd300').onclick = ()=> addTx('income', 300, 'おこづかい', true);
    $('#quickSnack').onclick = ()=> addTx('expense', 150, 'おやつ', true);

    $('#quickForm').onsubmit = (e)=>{
      e.preventDefault();
      const type = $('#quickType').value;
      const amount = parseAmount($('#quickAmount').value);
      const note = $('#quickNote').value.trim();
      if(!validAmount(amount)) return toast('金額を正しく入れてね');
      addTx(type, amount, note || labelForType(type), true);
      $('#quickAmount').value = '';
      $('#quickNote').value = '';
    };
  }

  function renderTransactions(){
    const list = $('#txList');
    const filter = $('#filterType');
    function paint(){
      list.innerHTML = '';
      let items = [...state.transactions].sort((a,b)=>b.dateISO.localeCompare(a.dateISO));
      if(filter.value!=='all') items = items.filter(t=>t.type===filter.value);
      if(items.length===0){ list.innerHTML = '<li>まだないよ</li>'; return; }
      items.forEach(t=>{
        const li = document.createElement('li');
        const isPlus = t.type==='income' || t.type==='chore';
        li.innerHTML = `
          <div>
            <div class="note">${escapeHtml(t.note||labelForType(t.type))}</div>
            <div class="meta">${dateJa(t.dateISO)}</div>
          </div>
          <div class="amount ${isPlus?'good':'bad'}">${isPlus?'+':'−'}${money(t.amount)}</div>
        `;
        list.appendChild(li);
      });
    }
    paint();
    filter.onchange = paint;

    $('#addTransactionBtn').onclick = ()=> openModal($('#txDialog'));
    $('#txForm').onsubmit = (e)=>{
      e.preventDefault();
      const type = $('#txType').value;
      const amount = parseAmount($('#txAmount').value);
      const note = $('#txNote').value.trim();
      if(!validAmount(amount)) return toast('金額を正しく入れてね');
      addTx(type, amount, note || labelForType(type), true);
      closeModal($('#txDialog'));
      e.target.reset();
      renderTransactions();
    };
  }

  function renderGoals(){
    const wrap = $('#goalList');
    wrap.innerHTML = '';
    if(state.goals.length===0){
      const empty = document.createElement('div');
      empty.className='card';
      empty.textContent = 'まだもくひょうがないよ。つくってみよう！';
      wrap.appendChild(empty);
    } else {
      state.goals.forEach(g=>{
        const p = Math.min(100, Math.round((g.saved / Math.max(1,g.target))*100));
        const card = document.createElement('div');
        card.className = 'goal-card';
        card.innerHTML = `
          <div class="ring" style="background: conic-gradient(var(--brand) 0 ${p}%, #eee ${p}% 100%)">
            <div class="inner"></div>
          </div>
          <div>
            <div class="goal-name">${escapeHtml(g.name)}</div>
            <div class="meta">${money(g.saved)} / ${money(g.target)}</div>
            <div class="goal-actions">
              <button class="btn primary" data-act="save">ちょきんする</button>
              <button class="btn" data-act="edit">変更</button>
              <button class="btn danger" data-act="delete">けす</button>
            </div>
          </div>
        `;
        wrap.appendChild(card);

        const [saveBtn, editBtn, delBtn] = $$('button', card);
        saveBtn.onclick = ()=> contributeToGoal(g);
        editBtn.onclick = ()=> editGoal(g);
        delBtn.onclick = ()=> deleteGoal(g);

        if(g.saved >= g.target){
          // 完了バッジ
          const done = document.createElement('div');
          done.className = 'meta';
          done.textContent = 'おめでとう！ もくひょう たっせい！';
          card.appendChild(done);
        }
      });
    }

    $('#addGoalBtn').onclick = ()=> openModal($('#goalDialog'));
    $('#goalForm').onsubmit = (e)=>{
      e.preventDefault();
      const name = $('#goalName').value.trim();
      const target = parseAmount($('#goalTarget').value);
      if(!name) return toast('なまえをいれてね');
      if(!validAmount(target)) return toast('目標金額を正しく入れてね');
      state.goals.push({ id:id(), name, target, saved:0 });
      save();
      closeModal($('#goalDialog'));
      e.target.reset();
      renderGoals();
    };
  }

  function renderChores(){
    const ul = $('#choreList');
    ul.innerHTML = '';
    if(state.chores.length===0){ ul.innerHTML = '<li>まだないよ</li>'; return; }
    state.chores.forEach(ch=>{
      const doneToday = ch.lastDone === today();
      const li = document.createElement('li');
      li.className = doneToday ? 'done' : '';
      li.innerHTML = `
        <div>
          <div class="note">${escapeHtml(ch.name)}</div>
          <div class="meta">ごほうび: ${money(ch.reward)} ${doneToday ? '（きょうはOK！）' : ''}</div>
        </div>
        <button ${doneToday?'disabled':''}>やった！</button>
      `;
      const btn = $('button', li);
      btn.onclick = ()=>{
        if(ch.lastDone === today()) return;
        ch.lastDone = today();
        addTx('chore', ch.reward, `おてつだい: ${ch.name}`, true);
        save();
        renderChores();
      };
      ul.appendChild(li);
    });
  }

  function renderSettings(){
    $('#settingsName').value = state.childName;
    $('#currency').value = state.currency;
    $('#themeSelect').value = state.theme || 'cute';
    const wrap = $('#avatarChoices');
    const choices = getAvatarChoices();
    wrap.innerHTML = '';
    choices.forEach(em=>{
      const b = document.createElement('button');
      b.type='button'; b.className='avatar'; b.textContent=em;
      b.onclick=()=>{ state.avatar = em; save(); renderHeader(); };
      wrap.appendChild(b);
    });

    $('#settingsName').oninput = (e)=>{ state.childName = e.target.value; save(); $('#childName').value = state.childName; };
    $('#currency').onchange = (e)=>{ state.currency = e.target.value; save(); renderHeader(); renderGoals(); renderChores(); renderTransactions(); renderHome(); };
    $('#themeSelect').onchange = (e)=>{
      state.theme = e.target.value;
      save();
      applyTheme();
      renderHeader();
      renderHome();
      renderTransactions();
      renderGoals();
      renderChores();
      renderSettings(); // refresh avatar pack
    };
    $('#resetData').onclick = ()=>{
      if(confirm('データをぜんぶけします。よろしいですか？')){
        localStorage.removeItem(LS_KEY);
        state = seed();
        renderAll();
        toast('リセットしました');
      }
    };
    // Export / Import
    $('#exportData').onclick = async ()=>{
      const json = JSON.stringify(state, null, 2);
      $('#ioTitle').textContent = 'エクスポート';
      $('#ioOk').textContent = 'コピー';
      $('#ioText').value = json;
      openModal($('#ioDialog'));
      $('#ioOk').onclick = (ev)=>{
        ev.preventDefault();
        try{ navigator.clipboard.writeText($('#ioText').value); toast('クリップボードにコピーしました'); }catch{ toast('コピーできない場合は手動で選択してください'); }
        closeModal($('#ioDialog'));
      };
    };
    $('#importData').onclick = ()=>{
      $('#ioTitle').textContent = 'インポート';
      $('#ioOk').textContent = '読み込み';
      $('#ioText').value = '';
      openModal($('#ioDialog'));
      $('#ioOk').onclick = (ev)=>{
        ev.preventDefault();
        try{
          const obj = JSON.parse($('#ioText').value);
          if(!obj || typeof obj !== 'object') throw new Error('bad');
          state = { ...initialState(), ...obj };
          save();
          renderAll();
          toast('インポートしました');
          closeModal($('#ioDialog'));
        }catch{ toast('JSONを確認してください'); }
      };
    };

    // Header quick edits
    $('#childName').oninput = (e)=>{ state.childName = e.target.value; save(); $('#settingsName').value = state.childName; };
    $('#avatarButton').onclick = ()=>{
      // cycle avatar
      const choices = getAvatarChoices();
      const idx = (choices.indexOf(state.avatar)+1) % choices.length;
      state.avatar = choices[idx]; save(); renderHeader();
    };
  }

  // ----- Actions -----
  function addTx(type, amount, note, animateCoin=false){
    const t = { id:id(), type, amount:Math.round(amount), note, dateISO:new Date().toISOString() };
    state.transactions.push(t);
    save();
    $('#balance').textContent = money(computeBalance());
    renderHome();
    renderTransactions();
    if(type==='income' || type==='chore'){
      if(animateCoin) dropCoin();
    }
  }

  function contributeToGoal(goal){
    const max = computeBalance();
    if(max<=0) return toast('まずはおこづかいをためよう！');
    const val = prompt(`いくらちょきんする？（最大 ${money(max)}）`, Math.min(300, max).toString());
    const amount = parseAmount(val||'');
    if(!validAmount(amount)) return;
    if(amount>max) return toast('ざんだかよりおおいよ');
    goal.saved += amount;
    addTx('goal', amount, `ちょきん: ${goal.name}`);
    save();
    renderGoals();
    if(goal.saved >= goal.target){
      confetti();
      toast('おめでとう！ もくひょう たっせい！');
    }
  }

  function editGoal(goal){
    const name = prompt('なまえ', goal.name)||goal.name;
    const target = parseAmount(prompt('目標金額', String(goal.target))||String(goal.target));
    if(!validAmount(target)) return toast('目標金額を正しく入れてね');
    goal.name = name.trim()||goal.name;
    goal.target = target;
    save();
    renderGoals();
  }

  function deleteGoal(goal){
    if(!confirm('もくひょうをけしますか？')) return;
    state.goals = state.goals.filter(g=>g.id!==goal.id);
    save();
    renderGoals();
  }

  // ----- Effects -----
  function dropCoin(){
    const pig = $('#piggy');
    const rect = pig.getBoundingClientRect();
    const c = document.createElement('div');
    c.className='coin';
    c.style.left = (rect.left + rect.width/2 - 13) + 'px';
    c.style.top = (rect.top - 60) + 'px';
    document.body.appendChild(c);
    setTimeout(()=> c.remove(), 900);
  }

  function confetti(){
    const wrap = $('#confetti');
    for(let i=0;i<80;i++){
      const p = document.createElement('div');
      p.className='p';
      const hue = Math.floor(Math.random()*360);
      p.style.background = `hsl(${hue} 90% 60%)`;
      p.style.left = Math.random()*100 + 'vw';
      p.style.top = (-Math.random()*20) + 'vh';
      p.style.transform = `rotate(${Math.random()*360}deg)`;
      p.style.animationDelay = (Math.random()*0.4)+'s';
      wrap.appendChild(p);
      setTimeout(()=> p.remove(), 1600);
    }
  }

  function toast(msg){
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.position='fixed'; el.style.left='50%'; el.style.bottom='20px'; el.style.transform='translateX(-50%)';
    el.style.background='#000a'; el.style.color='#fff'; el.style.padding='10px 14px'; el.style.borderRadius='999px'; el.style.fontWeight='800';
    el.style.zIndex='1001';
    document.body.appendChild(el);
    setTimeout(()=> el.remove(), 1800);
  }

  // ----- Helpers -----
  const supportsDialog = typeof HTMLDialogElement !== 'undefined' && HTMLDialogElement.prototype && 'showModal' in HTMLDialogElement.prototype;
  function openModal(dlg){ if(supportsDialog) dlg.showModal(); else { document.body.classList.add('modal-open'); dlg.classList.add('open'); } }
  function closeModal(dlg){ if(supportsDialog) dlg.close(); else { dlg.classList.remove('open'); document.body.classList.remove('modal-open'); } }
  function applyTheme(){
    document.body.classList.toggle('theme-adventure', state.theme==='adventure');
    document.body.classList.toggle('theme-cute', state.theme!=='adventure');
  }
  function getAvatarChoices(){
    if(state.theme==='adventure'){
      return ['🚀','🛸','🤖','🦖','🛰️','⚽','🎮','🧭','🛡️','🗡️','🧱','🐲'];
    }
    return ['🐻','🐱','🐯','🐰','🐼','🦊','🐨','🦄','🐣','🐵','🐶','🐸'];
  }
  function dateJa(iso){
    try{
      const d = new Date(iso);
      const m = d.getMonth()+1; const day = d.getDate();
      const hh = d.getHours().toString().padStart(2,'0');
      const mm = d.getMinutes().toString().padStart(2,'0');
      return `${m}/${day} ${hh}:${mm}`;
    }catch{ return '' }
  }
  function labelForType(type){
    return type==='income' ? 'おこづかい' : type==='expense' ? 'おかいもの' : type==='goal' ? 'ちょきん' : 'おてつだい';
  }
  function parseAmount(v){
    if(typeof v !== 'string') return 0;
    v = v.replace(/[^0-9]/g,'');
    return v ? parseInt(v,10) : 0;
  }
  function validAmount(n){ return Number.isFinite(n) && n>0 && n<=1_000_000 }
  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])) }

  // ----- Init -----
  renderAll();
})();
