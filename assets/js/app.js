/* ====== 設定 ====== */
// そのままのファイル名を使う場合
const DATA_FILES = [
  'data/3kyu.csv',
  'data/2kyu.csv'
];

let QUESTION_ORDER = [];   // 出題順（インデックスのシャッフル）
let questionPtr = 0;       // 進捗ポインタ
let exhausted = false;     // 全問出題し終えた



/* ====== 状態 ====== */
let ALL_ITEMS = [];        // 正規化済みデータ
let qCount = 0;
let correctCount = 0;
let current = null;        // 現在の問題 {item, choices, answer}

/* ====== DOM ====== */
const elLoader = document.getElementById('loader');
const elQuiz = document.getElementById('quiz');
const elQuestionText = document.getElementById('questionText');
const elChoices = document.getElementById('choices');
const elSubmit = document.getElementById('submitBtn');
const elNext = document.getElementById('nextBtn');
const elResult = document.getElementById('result');
const elResultBody = document.getElementById('resultBody');
const elQ = document.getElementById('qLabel');
const elQCount = document.getElementById('qCount');
const elCorrectCount = document.getElementById('correctCount');

/* ====== ユーティリティ ====== */
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function pickN(arr, n, excludeSet = new Set()){
  const pool = arr.filter(x=>!excludeSet.has(x));
  return shuffle(pool).slice(0, n);
}
function toInt(x){const n=Number(x);return Number.isFinite(n)?n:null;}
function parseRGB(raw){
  if(!raw) return null;
  let s = String(raw).trim();

  // #RRGGBB
  if(/^#?[0-9a-f]{6}$/i.test(s)){
    if(s[0]==='#') s=s.slice(1);
    return [parseInt(s.slice(0,2),16), parseInt(s.slice(2,4),16), parseInt(s.slice(4,6),16)];
  }
  // "R,G,B" or "R G B" or "R / G / B"
  const tokens = s.split(/[,\s/]+/).map(x=>x.trim()).filter(Boolean);
  if(tokens.length===3){
    const r = toInt(tokens[0]), g=toInt(tokens[1]), b=toInt(tokens[2]);
    if([r,g,b].every(v=>v!==null)) return [r,g,b];
  }
  return null;
}
function rgbCss(rgb){
  if(!rgb) return 'transparent';
  const [r,g,b]=rgb;
  return `rgb(${r}, ${g}, ${b})`;
}
function splitSentencesJa(text){
  if(!text) return [];
  const s = String(text).replace(/\s+/g,' ').trim();
  if(!s) return [];
  // 句点や！、？で文区切り。記号の直後で分割しつつ最大5文まで
  const parts = s.split(/(?<=[。．！？!?])/u).map(t=>t.trim()).filter(Boolean);
  // 先頭5文。句点が無い場合は約30〜40字で粗分割フォールバック
  if(parts.length===0){
    const chunks=[];
    let buf=s;
    while(buf.length>0 && chunks.length<5){
      chunks.push(buf.slice(0,34));
      buf = buf.slice(34);
    }
    return chunks;
  }
  return parts.slice(0,5);
}

function initQuestionOrder(){
  QUESTION_ORDER = shuffle([...Array(ALL_ITEMS.length).keys()]);
  questionPtr = 0;
  exhausted = false;
}

/* ====== CSVロード & 正規化 ====== */
async function loadAll(){
  const parsed = [];
  for(const path of DATA_FILES){
    const data = await new Promise((resolve, reject)=>{
      Papa.parse(path, {
        header: true,
        download: true,
        skipEmptyLines: true,
        complete: (res)=>resolve(res.data),
        error: (e)=>reject(e)
      });
    });

    parsed.push(...data);
  }
  // ヘッダー名のゆらぎに耐えるマッピング
  const mapKey = (row, keys) => {
    console.log(row, keys)
    for(const k of keys){
      if(k in row && row[k]!==undefined) return row[k];
    }
    return '';
  };


  ALL_ITEMS = parsed.map((row)=>{
    const name         = mapKey(row, ['色名','name','Name','色の名前']);
    const family       = mapKey(row, ['系統色名','系統','family']);
    const munsell      = mapKey(row, ['マンセル値','マンセル','Munsell']);
    const pccs         = mapKey(row, ['pccs','PCCS','PCCSトーン','PCCS tone','トーン']);
    const rgbRaw       = mapKey(row, ['RGB','rgb','カラーコード','color','Color']);
    const description  = mapKey(row, ['説明','解説','description','Description','由来']);
    const rgb = parseRGB(rgbRaw);

    const sentences = splitSentencesJa(description); // 文1〜文5
    return {
      name: String(name).trim(),
      family: String(family).trim(),
      munsell: String(munsell).trim(),
      pccs: String(pccs).trim(),
      rgb,
      description: String(description||'').trim(),
      sentences
    };
  }).filter(it=>it.name);

  // 名前重複など簡易クリーニング
  const seen = new Set();
  ALL_ITEMS = ALL_ITEMS.filter(it=>{
    const key = it.name;
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if(ALL_ITEMS.length === 0){
    throw new Error('CSVから有効な行が読み込めませんでした。ヘッダー名をご確認ください。');
  }
}

/* ====== 出題生成 ====== */
function makeQuestion(){
  // すべて出し切ったら終了フラグを立てる
  if(questionPtr >= QUESTION_ORDER.length){
    exhausted = true;
    return;
  }

  const idx = QUESTION_ORDER[questionPtr++];
  const item = ALL_ITEMS[idx];

  // 文1〜文5から2つランダム（文が1つしか無いときはそのまま）
  const pool = item.sentences.length>0 ? item.sentences.slice(0,5) : [item.description];
  const pick = pool.length >= 2 ? pickN(pool, 2) : [pool[0]];
  const stem = pick.join('\n');

  // 選択肢（正解+ダミー3）
  const dummies = pickN(names, 3, new Set([item.name]));
  const choices = shuffle([item.name, ...dummies]);

  current = { item, stem, choices, answer: item.name };
}

/* ====== UI更新 ====== */
function renderQuestion(){
  if(exhausted){
    // 出し切った後の表示
    elQuestionText.textContent = '全問題の出題が完了しました。もう一度、順序をシャッフルして最初から始めますか？';
    elChoices.innerHTML = '';
    elSubmit.classList.add('hidden');
    elNext.classList.remove('hidden');
    elNext.textContent = 'もう一度やる（シャッフル）';
    elResult.classList.add('hidden');

    elQ.textContent = 'Q—';
    // 出題数/正答数はそのまま残しておく（履歴として見えるように）
    return;
  }

  if(!current){
    elQuestionText.textContent = '（問題を用意できませんでした）';
    elChoices.innerHTML = '';
    elSubmit.classList.add('hidden');
    elNext.classList.add('hidden');
    elResult.classList.add('hidden');
    return;
  }

  elQuestionText.textContent = current.stem || '（説明文なし）';

  // 選択肢
  elChoices.innerHTML = '';
  current.choices.forEach((label, idx)=>{
    const div = document.createElement('label');
    div.className = 'choice';
    div.innerHTML = `
      <input type="radio" name="answer" value="${label}">
      <span>${label}</span>
    `;
    elChoices.appendChild(div);
  });

  // ボタン表示制御
  elSubmit.classList.remove('hidden');
  elSubmit.disabled = false;
  elNext.classList.add('hidden');
  elNext.textContent = '次の問題へ';
  elResult.classList.add('hidden');

  // カウンタ表示（次に回答したら qCount が+1される前提で +1 を先出し）
  elQ.textContent = `Q${qCount+1}`;
  elQCount.textContent = String(qCount);
  elCorrectCount.textContent = String(correctCount);
}


function getSelectedAnswer(){
  const input = elChoices.querySelector('input[name="answer"]:checked');
  return input ? input.value : null;
}

/* 追加：名前からアイテムを引く */
function findItemByName(name){
return ALL_ITEMS.find(x => x.name === name) || null;
}

/* 追加：1件分の詳細カードHTMLを生成 */
function itemCardHtml(item, {isCorrect=false} = {}){
const rgbText = item.rgb ? `rgb(${item.rgb[0]}, ${item.rgb[1]}, ${item.rgb[2]})` : '（不明）';
return `
  <div class="item-card ${isCorrect ? 'correct-ring' : ''}">
    <div class="item-head">
      <div class="item-title">${item.name}${isCorrect ? '（正解）' : ''}</div>
      ${isCorrect ? '<span class="badge">正解</span>' : ''}
    </div>
    <div class="item-meta">
      <div class="badge">系統色名</div><div>${item.family || '—'}</div>
      <div class="badge">マンセル値</div><div>${item.munsell || '—'}</div>
      <div class="badge">PCCS</div><div>${item.pccs || '—'}</div>
      <div class="badge">RGB</div>
      <div class="item-chip">
        <div class="colorchip" style="background:${rgbCss(item.rgb)};"></div>
        <span>${rgbText}</span>
      </div>
    </div>
    ${item.description ? `<div class="item-desc">${item.description}</div>` : ''}
  </div>
`;
}

function renderResult(isCorrect){
const { item } = current;

// 正誤見出し（従来の一行メッセージ）
const headerHtml = `
  <p class="${isCorrect ? 'correct' : 'incorrect'}">
    ${isCorrect ? '正解！' : '不正解…'} 正解は <strong class="kv">${item.name}</strong>
  </p>
`;

// 正解カード（説明文は全文表示）
const correctCard = itemCardHtml(item, { isCorrect: true });

// 他の選択肢カード
const others = current.choices
  .filter(name => name !== item.name)
  .map(name => findItemByName(name))
  .filter(Boolean);

const othersTitle = others.length ? `<div class="section-title">他の選択肢</div>` : '';
const otherCards = others.map(o => itemCardHtml(o)).join('');

elResultBody.innerHTML = `
  ${headerHtml}
  <div class="items-wrap">
    ${correctCard}
    ${othersTitle}
    ${otherCards}
  </div>
`;

elResult.classList.remove('hidden');
elSubmit.classList.add('hidden');
elNext.classList.remove('hidden');
}

/* ====== イベント ====== */
elSubmit.addEventListener('click', ()=>{
  const ans = getSelectedAnswer();
  if(!ans){
    alert('選択肢を選んでください。');
    return;
  }
  const ok = ans === current.answer;
  qCount += 1;
  if(ok) correctCount += 1;
  renderResult(ok);
  // カウント反映
  elQCount.textContent = String(qCount);
  elCorrectCount.textContent = String(correctCount);
});

elNext.addEventListener('click', ()=>{
  if(exhausted){
    initQuestionOrder();
    makeQuestion();
    renderQuestion();
    return;
  }
  makeQuestion();
  renderQuestion();
});

/* ====== 起動 ====== */
(async function bootstrap(){
  try{
    await loadAll();
    initQuestionOrder();
    elLoader.classList.add('hidden');
    elQuiz.classList.remove('hidden');
    makeQuestion();
    renderQuestion();
  }catch(e){
    console.error(e);
    elLoader.textContent = 'データ読込エラー：' + e.message;
  }
})();
