/*
 * Topwar HeroListPopup2023 - ONE-SHOT hero portrait collector v11 (safe auto open / capture / close)
 * Paste the ENTIRE file into Chrome DevTools Console from BASE or WORLD; opens the Hero list when a safe button is found.
 * Standalone: NO Tampermonkey, NO existing Topwar Helper functions, NO permanent hooks.
 * Keeps v7 intended movement duration; aborts if virtual list turns blank.
 * Restores the scroll position in short animated steps to let Cocos refresh recycled list items.
 * It restores the original scroll offset, then closes only the confirmed hero popup.
 */
(async () => {
  'use strict';
  const CFG = Object.freeze({
    panel: 'HeroListPopup2023',
    scrollStepRatio: 0.38,       // viewport height 38% per step (~317px at 834px viewport)
    minStepPixels: 220,
    maxStepPixels: 330,
    initialWaitMs: 800,          // initial image load, 1000 -> 800
    moveDurationSec: 0.35,       // animate scroll, but much faster than v6
    afterMoveWaitMs: 400,       // settled image wait, 550 -> 400
    lateAssetWaitMs: 250,       // second observation, 350 -> 250
    maxPositions: 160,
    retryFailedAtEnd: true,
    imageTimeoutMs: 4500,
    includeOtherSprites: false, // 영웅 초상화만 수집
    ambiguousRecheckMs: 230,  // 그림이 바뀌었을 때만 추가 확인
    maxImageAttempts: 3,
    emptyListRetryMs: 900,
    restoreStepRatio: 0.65,
    restoreStepDurationSec: 0.12,
    restoreStepWaitMs: 165,
    restoreExtraWaitMs: 500
  });
  const LOG = '[HERO-AUTO-v11]';
  const cc = window.cc;
  const started = Date.now();
  // 영웅 ID -> 후보 SpriteFrame별 기록. 이동 중 관측은 확정 후보가 아니다.
  const found = new Map();
  const observedIds = new Set();
  const ambiguousSteps = [];
  const movingObservations = new Set();
  const progress = [];
  const objectIds = new WeakMap();
  let nextId = 0;
  let captured = 0;
  let lastPopupPath = '';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const safe = (fn, fallback = null) => { try { const x = fn(); return x == null ? fallback : x; } catch { return fallback; } };
  const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const klass = c => String(safe(() => c.__classname__) || safe(() => c.constructor?.name) || '');
  const kindIs = (c, name) => klass(c) === name || klass(c).endsWith('.' + name);
  const component = (node, type) =>
    safe(() => cc?.[type] && node.getComponent?.(cc[type])) ||
    safe(() => node.getComponent?.('cc.' + type)) ||
    (node._components || []).find(c => kindIs(c, type)) || null;
  const objectId = obj => {
    if (!obj || typeof obj !== 'object') return 'unknown';
    if (!objectIds.has(obj)) objectIds.set(obj, ++nextId);
    return String(objectIds.get(obj));
  };
  function walk(root, callback) {
    const stack = [root], seen = new Set();
    while (stack.length) {
      const n = stack.pop();
      if (!n || seen.has(n)) continue;
      seen.add(n);
      callback(n);
      for (let i = (n.children?.length || 0) - 1; i >= 0; i--) stack.push(n.children[i]);
    }
  }
  const nodePath = node => {
    const names = [];
    for (let i = 0; node && i < 90; i++, node = node.parent) names.unshift(node.name || '?');
    return names.join('/');
  };
  const live = node => !!node && safe(() => cc.isValid ? cc.isValid(node) : true, true) && node.active !== false && node.activeInHierarchy !== false;
  function popup() {
    const scene = safe(() => cc?.director?.getScene?.());
    if (!scene) return null;
    let match = null, score = -1;
    walk(scene, node => {
      if (!live(node)) return;
      const owns = (node._components || []).some(c => kindIs(c, CFG.panel));
      const n = String(node.name || '');
      const value = (owns ? 100 : 0) + (n === CFG.panel ? 50 : 0) + (n.includes(CFG.panel) ? 10 : 0);
      if (value > 0 && value > score) { match = node; score = value; }
    });
    return match;
  }
  // v11: BASE / WORLD의 영웅 메뉴 버튼만 누른다.
  // 정확한 버튼 ID가 제공되지 않았기 때문에, 불명확한 경우 자동 클릭하지 않는다.
  const UI_CFG = Object.freeze({
    openTimeoutMs: 7500,
    closeTimeoutMs: 4000,
    verifyIntervalMs: 120,
    minOpenScore: 95,
    minCloseScore: 85,
    tieMargin: 22
  });
  const activeScene = () => safe(() => cc?.director?.getScene?.());
  function isDescendant(node, ancestor) {
    for (let n=node; n; n=n.parent) if (n===ancestor) return true;
    return false;
  }
  function isActiveTree(node) {
    if (!live(node)) return false;
    for (let n=node, i=0; n && i<90; n=n.parent, i++) {
      if (!live(n)) return false;
    }
    return true;
  }
  function clickHandlerInfo(button) {
    const events = safe(() => button?.clickEvents, []);
    return Array.isArray(events) ? events.map(e=>({
      component:String(e?.component||''), handler:String(e?.handler||''),
      target:String(e?.target?.name||''), event:e
    })) : [];
  }
  function uiButtons(scope) {
    const rows=[];
    walk(scope, node=>{
      if (!isActiveTree(node)) return;
      const btn=component(node,'Button');
      if (!btn || btn.enabled===false || btn.interactable===false) return;
      rows.push({node,btn,path:nodePath(node),handlers:clickHandlerInfo(btn)});
    });
    return rows;
  }
  function badMenuCandidate(row) {
    const bad = /HeroListItem2026|HeroListPopup2023|HeroDetail|HeroUpgrade|HeroSkill|HeroEquip|HeroRecruit|HeroShop|HeroStar|HeroFormation|HeroAwake/i;
    if (bad.test(row.path)) return true;
    const val=[row.node.name,...row.handlers.map(h=>h.handler)].join(' ');
    return /close|back|cancel|remove|delete|mask|share|guild|rank|equip|skill|upgrade|recruit|shop|formation|awake|reward|portrait/i.test(val);
  }
  function openButtonScore(row) {
    if (badMenuCandidate(row)) return 0;
    const n=String(row.node.name||'');
    const h=row.handlers.map(x=>`${x.component}.${x.handler}`).join(' ');
    const parent=String(row.node.parent?.name||'');
    let score=0;
    if (/^(?:btn[_-]?hero|hero[_-]?btn|hero[_-]?button|button[_-]?hero|btn[_-]?heroes)$/i.test(n)) score+=155;
    else if (/^(?:hero|heroes|heroMenu|heroList|heroIconBtn)$/i.test(n)) score+=120;
    else if (/(?:^|[_-])hero(?:es)?(?:[_-]|$)/i.test(n)||/hero/i.test(n)) score+=75;
    if (/hero/i.test(parent) && /btn|button|icon|click|touch/i.test(n)) score+=75;
    if (/HeroListPopup2023|openHeroList|onClickHero|onBtnHero|onHeroClick|showHero|heroList|heroMenu/i.test(h)) score+=130;
    else if (/hero/i.test(h)) score+=65;
    if (/main|bottom|menu|left|right|worldmap|city|home|base|toolbar|nav/i.test(row.path)) score+=15;
    if (row.handlers.length===0) score-=65; // 이벤트 함수가 없는 장식/특수 버튼 회피
    return score;
  }
  function pickUnique(rows, minimum, margin) {
    const candidates=rows.filter(x=>x.score>=minimum).sort((a,b)=>b.score-a.score);
    const best=candidates[0]||null;
    return {best:best && (!candidates[1] || best.score-candidates[1].score>=margin) ? best:null,
      candidates,ambiguous:!!best && !!candidates[1] && best.score-candidates[1].score<margin};
  }
  function describeRows(rows) {
    return rows.slice(0,15).map(row=>({score:row.score,name:row.node?.name,path:row.path,
      handlers:row.handlers?.map(x=>`${x.component}.${x.handler}`)||[]}));
  }
  function invokeExactButton(row, reason) {
    if (!row || !isActiveTree(row.node)) throw new Error(`${reason}: 버튼이 사라졌습니다.`);
    if (!component(row.node,'Button')) throw new Error(`${reason}: Cocos Button이 아닙니다.`);
    const handlers=clickHandlerInfo(row.btn);
    if (!handlers.length) throw new Error(`${reason}: 직렬화된 clickEvents가 없어 실행하지 않습니다.`);
    const emitter=cc?.Component?.EventHandler?.emitEvents;
    if (typeof emitter!=='function') throw new Error(`${reason}: Cocos EventHandler.emitEvents를 찾지 못했습니다.`);
    // 단 한 번만 호출한다. 클릭 실패 뒤 자동으로 다른 버튼/상위 UI를 누르지 않는다.
    emitter(handlers.map(x=>x.event), {type:'click',target:row.node,currentTarget:row.node});
  }
  async function waitFor(condition, timeout) {
    const deadline=Date.now()+timeout;
    while (Date.now()<deadline) {
      const hit=safe(condition);
      if (hit) return hit;
      await sleep(UI_CFG.verifyIntervalMs);
    }
    return null;
  }
  async function openHeroListSafely() {
    if (popup()) return {ok:true,method:'already-open',node:popup(),button:null};
    const root=activeScene();
    if (!root) throw new Error('게임 Scene을 찾지 못했습니다.');
    const rows=uiButtons(root).map(row=>({...row,score:openButtonScore(row)}));
    const pick=pickUnique(rows,UI_CFG.minOpenScore,UI_CFG.tieMargin);
    if (!pick.best) {
      console.table(describeRows(rows.filter(x=>x.score>0).sort((a,b)=>b.score-a.score)));
      throw new Error(pick.ambiguous
        ? '영웅 버튼 후보가 여러 개입니다. 자동 클릭하지 않았습니다. 위 콘솔의 후보 노드/경로를 알려주세요.'
        : '영웅 버튼을 확실히 식별하지 못했습니다. 자동 클릭하지 않았습니다. 위 콘솔의 버튼 후보를 확인해주세요.');
    }
    const row=pick.best;
    console.log(LOG,'영웅 버튼 실행 (한 번만):',{name:row.node.name,path:row.path,
      handlers:row.handlers.map(x=>x.handler),score:row.score});
    invokeExactButton(row,'영웅 목록 열기');
    const opened=await waitFor(()=>popup(),UI_CFG.openTimeoutMs);
    if (!opened) throw new Error(`영웅 버튼 실행 후 ${UI_CFG.openTimeoutMs}ms 내 HeroListPopup2023이 열리지 않았습니다. 다른 화면은 클릭하지 않습니다.`);
    return {ok:true,method:'exact-button',button:row.path,node:opened};
  }
  // 영웅 팝업 또는 *그 팝업만 포함하는 가장 가까운* 전용 프레임을 확인한다.
  function popupPrivateFrame(root) {
    for (let p=root.parent,depth=0; p && depth<5; p=p.parent,depth++) {
      const name=String(p.name||'');
      if (/^(?:PopLayer|UICanvas|NWorldMap|Canvas|Scene)$/i.test(name)) break;
      if (!/UIFrame/i.test(name)) continue;
      // 하나의 프레임에 서로 다른 활성 팝업이 있다면 프레임 내부의 닫기를 사용하지 않는다.
      let others=0;
      walk(p,node=>{
        if (isDescendant(node,root)||!isActiveTree(node)) return;
        if ((node._components||[]).some(c=>/Panel|Popup|Dialog|Rank/i.test(klass(c)) &&
           !/Frame|Button|Sprite|Layout/i.test(klass(c)))) others++;
      });
      if (!others) return p;
    }
    return null;
  }
  function closeButtonScore(row,root,frame) {
    const n=String(row.node.name||'');
    const h=row.handlers.map(x=>`${x.component}.${x.handler}`).join(' ');
    if (/mask|worldmap|home|base|backhome|logout|quitgame|exitgame|disconnect/i.test(`${n} ${h}`)) return 0;
    if (!/(close|back|return|exit|cancel)/i.test(`${n} ${h}`)) return 0;
    const owned=isDescendant(row.node,root);
    if (!owned && !(frame && isDescendant(row.node,frame))) return 0;
    let score=owned?95:50;
    if (/^(?:btn[_-]?(?:close|back)|(?:close|back)[_-]?(?:btn|button)|icon[_-]?close|close)$/i.test(n)) score+=90;
    else if (/close|back/i.test(n)) score+=45;
    if (/^(?:onClickClose|onBtnClose|onClose|onClickBack|onBtnBack|onBack|close|back)$/i.test(h.trim().split('.').pop())) score+=60;
    else if (/close|back/i.test(h)) score+=25;
    if (!row.handlers.length) return 0;
    return score;
  }
  async function closeHeroListSafely(root) {
    if (!root || !live(root) || popup()!==root) return {ok:true,alreadyClosed:true};
    const frame=popupPrivateFrame(root);
    // 내부 닫기 버튼 우선. 없을 때만 해당 팝업의 전용 UIFrame 검색.
    const inside=uiButtons(root).map(r=>({...r,score:closeButtonScore(r,root,null)}));
    let pick=pickUnique(inside,UI_CFG.minCloseScore,UI_CFG.tieMargin);
    let scope='popup';
    if (!pick.best && !pick.ambiguous && frame) {
      const local=uiButtons(frame).filter(r=>!isDescendant(r.node,root))
        .map(r=>({...r,score:closeButtonScore(r,root,frame)}));
      pick=pickUnique(local,UI_CFG.minCloseScore,UI_CFG.tieMargin);
      scope='private-frame';
    }
    if (!pick.best) {
      console.warn(LOG,'영웅 팝업 닫기 후보 없음/중복; 추가 클릭하지 않습니다.',{scope,frame:frame&&nodePath(frame)});
      console.table(describeRows(pick.candidates));
      return {ok:false,reason:pick.ambiguous?'ambiguous-close':'no-safe-close-button',
        scope,frame:frame?nodePath(frame):null};
    }
    const target=pick.best;
    console.log(LOG,'영웅 팝업 닫기 (한 번만):',{scope,path:target.path,score:target.score});
    try {
      invokeExactButton(target,'영웅 목록 닫기');
      const closed=await waitFor(()=>!live(root)||popup()!==root,UI_CFG.closeTimeoutMs);
      return {ok:!!closed,reason:closed?'closed':'close-not-confirmed',scope,button:target.path};
    } catch(err) {
      return {ok:false,reason:String(err?.message||err),scope,button:target.path};
    }
  }

  function findScroll(root) {
    const options = [];
    walk(root, node => {
      if (!live(node)) return;
      const sv = component(node, 'ScrollView');
      if (!sv || sv.enabled === false || !sv.content || !sv.vertical) return;
      const view = safe(() => sv._view) || sv.node;
      const height = num(view?.height || sv.node?.height);
      const contentHeight = num(sv.content?.height);
      if (height < 1 || contentHeight <= height + 10) return;
      const path = nodePath(node);
      let priority = path.endsWith('/HeroListPopup2023/ScrollView') ? 1000 : 0;
      priority += path.includes('/HeroListPopup2023/') ? 50 : 0;
      priority += (contentHeight / height) * 10;
      options.push({sv, viewHeight: height, contentHeight, priority, path});
    });
    options.sort((a, b) => b.priority - a.priority);
    return options[0] || null;
  }
  function offset(sv) {
    const o = safe(() => sv.getScrollOffset?.());
    if (!o) return null;
    return { x: num(o.x), y: num(o.y) };
  }
  function maximum(sv, view) {
    const max = safe(() => sv.getMaxScrollOffset?.());
    return Math.max(0, num(max?.y, view.contentHeight - view.viewHeight));
  }
  function toOffset(sv, y, max, durationSec = 0) {
    sv.stopAutoScroll?.();
    if (typeof sv.scrollToOffset === 'function') {
      const vector = cc.v2 ? cc.v2(0, y) : {x: 0, y};
      sv.scrollToOffset(vector, durationSec);
    } else if (typeof sv.scrollToPercentVertical === 'function') {
      sv.scrollToPercentVertical(max > 0 ? 1 - y / max : 1, durationSec);
    } else {
      throw new Error('ScrollView에 scrollToOffset/scrollToPercentVertical이 없습니다.');
    }
  }
  // 스크롤이 화면 전체를 건너뛰면 일부 게임의 가상 리스트가 갱신되지 않는다.
  // 원위치 복귀에도 화면 높이 내의 작은 애니메이션 단계를 사용한다.
  async function restoreScrollSafely(sv, original, view, root, initiallyVisible) {
    const result = {attempted:false, restored:false, before:null, after:null,
      steps:0, heroSpritesAfter:null, recoveredBlank:false};
    if (!original || !live(root) || popup() !== root) return result;
    result.attempted = true;
    const now = offset(sv);
    result.before = now;
    if (!now) return result;
    const max = maximum(sv, view);
    const stride = Math.max(100, Math.min(450, view.viewHeight * CFG.restoreStepRatio));
    const distance = Math.abs(original.y - now.y);
    const steps = Math.min(200, Math.ceil(distance / stride));
    // 1) 원래 위치로 이동하면서 각 단계마다 Cocos 렌더링 시간을 준다.
    for (let i=1;i<=steps;i++) {
      if (!live(root) || popup() !== root) break;
      const target = now.y + (original.y - now.y) * (i / steps);
      toOffset(sv, target, max, CFG.restoreStepDurationSec);
      result.steps++;
      await sleep(CFG.restoreStepWaitMs);
    }
    // 2) 애니메이션 잔여 위치가 있으면 최종 복귀한다.
    if (live(root) && popup() === root) {
      toOffset(sv, original.y, max, CFG.restoreStepDurationSec);
      await sleep(CFG.restoreExtraWaitMs);
      let count = collectVisibleFrames(root).length;
      // 화면이 비었을 때만 작은 왕복 스크롤로 게임의 목록 갱신을 유도한다.
      if (initiallyVisible > 0 && count === 0) {
        const nudge = original.y > 25 ? original.y - 25 : Math.min(max, original.y + 25);
        if (Math.abs(nudge - original.y) > 0.5) {
          toOffset(sv, nudge, max, CFG.restoreStepDurationSec);
          await sleep(300);
          toOffset(sv, original.y, max, CFG.restoreStepDurationSec);
          await sleep(CFG.restoreExtraWaitMs);
          count = collectVisibleFrames(root).length;
          result.recoveredBlank = count > 0;
        }
      }
      result.heroSpritesAfter = count;
    }
    result.after = offset(sv);
    result.restored = !!result.after && Math.abs(result.after.y - original.y) < 5;
    if (initiallyVisible > 0 && result.heroSpritesAfter === 0) {
      console.error(LOG, '영웅 목록이 표시되지 않습니다. 영웅 창을 닫았다 다시 열고, 복구되지 않으면 새로고침하세요.');
    }
    return result;
  }

  function imageSource(texture) {
    const candidates = [
      safe(() => texture.getHtmlElementObj?.()),
      safe(() => texture._image),
      safe(() => texture._nativeAsset),
      safe(() => texture._htmlElementObj),
      safe(() => texture.image)
    ];
    return candidates.find(el => el && num(el.naturalWidth || el.width) > 0 && num(el.naturalHeight || el.height) > 0) || null;
  }
  function assetUrl(texture, frame) {
    for (const raw of [
      safe(() => texture?.nativeUrl), safe(() => texture?._nativeUrl),
      safe(() => texture?.url), safe(() => texture?._url),
      safe(() => frame?.nativeUrl), safe(() => texture?._image?.src)
    ]) {
      if (typeof raw !== 'string' || !raw) continue;
      try {
        const url = new URL(raw, location.href);
        if (/^(https?:|blob:|data:)$/i.test(url.protocol)) return url.href;
      } catch {}
    }
    return null;
  }
  async function loadImage(src) {
    if (!src) return null;
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let completed = false;
      const finish = result => { if (completed) return; completed = true; clearTimeout(timer); resolve(result); };
      const timer = setTimeout(() => finish(null), CFG.imageTimeoutMs);
      img.onload = () => finish(img);
      img.onerror = () => finish(null);
      img.src = src;
    });
  }
  function heroIdFromNode(node) {
    let cur = node;
    for (let i = 0; cur && i < 15; i++, cur = cur.parent) {
      if (cur.name === 'HeroListItem2026' && /^\d+$/.test(String(cur.parent?.name || '')))
        return String(cur.parent.name);
    }
    return null;
  }
  function collectVisibleFrames(root) {
    const candidates = [];
    walk(root, node => {
      if (!live(node)) return;
      if (!CFG.includeOtherSprites && !/heroIcon/i.test(String(node.name))) return;
      const sprite = component(node, 'Sprite');
      if (!sprite || sprite.enabled === false) return;
      const frame = safe(() => sprite.spriteFrame) || safe(() => sprite._spriteFrame);
      if (!frame) return;
      const path = nodePath(node);
      const name = String(safe(() => frame.name) || '');
      const isHero = /\/HeroListItem2026\//.test(path) &&
        (/heroIcon/i.test(node.name) || /^hero_(?:awake)?icon/i.test(name));
      if (!CFG.includeOtherSprites && !isHero) return;
      const heroId = heroIdFromNode(node);
      const texture = safe(() => frame.getTexture?.()) || safe(() => frame._texture) || safe(() => frame.texture);
      const rect = safe(() => frame.getRect?.()) || safe(() => frame._rect) || {};
      const dims = { x:num(rect.x), y:num(rect.y), width:num(rect.width, num(texture?.width)), height:num(rect.height, num(texture?.height)) };
      const rotated = !!safe(() => frame.isRotated?.(), safe(() => frame._rotated, false));
      const frameUUID = String(safe(() => frame._uuid) || safe(() => frame._id) || '');
      const textureUUID = String(safe(() => texture?._uuid) || safe(() => texture?._id) || '');
      const url = assetUrl(texture, frame);
      // Include hero ID: reused Cocos item components must not overwrite distinct heroes.
      const resourceId = frameUUID || `${url || textureUUID || objectId(frame)}:${name}`;
      const key = `${heroId || '?'}|${resourceId}|${dims.x},${dims.y},${dims.width},${dims.height}`;
      candidates.push({key, node, frame, texture, meta: {
        heroNodeId:heroId, heroPortrait:isHero, frameName:name,
        frameUUID:frameUUID || null, textureUUID:textureUUID || null,
        sourceURL:url, nodePath:path, rect:dims, rotated,
        discoveredAt:new Date().toISOString()
      }});
    });
    return candidates;
  }
  async function capturePNG(row) {
    const {rect, rotated} = row.meta;
    const {x,y,width:w,height:h} = rect;
    if (!w || !h) throw new Error('빈 SpriteFrame 영역');
    const source = imageSource(row.texture) || await loadImage(row.meta.sourceURL);
    if (!source) throw new Error('텍스처 픽셀에 접근 불가 (GPU-only / CORS / 로딩 대기)');
    const tw = num(source.naturalWidth || source.width);
    const th = num(source.naturalHeight || source.height);
    const cropW = rotated ? h : w, cropH = rotated ? w : h;
    if (x < 0 || y < 0 || x + cropW > tw + 1 || y + cropH > th + 1)
      throw new Error(`아틀라스 범위 초과: (${x},${y}) ${cropW}x${cropH}/${tw}x${th}`);
    if (w > 8192 || h > 8192) throw new Error('PNG 크기 제한 초과');
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w); canvas.height = Math.ceil(h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas 생성 실패');
    if (rotated) {
      ctx.save(); ctx.translate(0, h); ctx.rotate(-Math.PI / 2);
      ctx.drawImage(source,x,y,cropW,cropH,0,0,cropW,cropH); ctx.restore();
    } else ctx.drawImage(source,x,y,w,h,0,0,w,h);
    return new Promise((resolve, reject) => {
      try { canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG 인코딩 실패')), 'image/png'); }
      catch (e) { reject(e); }
    });
  }
  // 같은 위치에서 두 번 확인한 프레임만 PNG로 저장한다.
  // 실제 영웅 ID와 spriteFrame의 파일 번호는 반드시 일치하는 것은 아니다.
  function sampleAt(root, phase, position) {
    const rows = collectVisibleFrames(root);
    const byId = new Map();
    const duplicates = [];
    for (const row of rows) {
      const id = row.meta.heroNodeId;
      if (!id && !CFG.includeOtherSprites) continue;
      const groupId = id || ('sprite:' + row.key);
      if (byId.has(groupId) && byId.get(groupId).key !== row.key) {
        duplicates.push({id:groupId, frames:[byId.get(groupId).meta.frameName,row.meta.frameName]});
        continue;
      }
      byId.set(groupId,row);
      if (id) {
        if (phase === 'during-scroll') movingObservations.add(id);
        else { observedIds.add(id); }
      }
    }
    const info = {
      phase, position, foundInScene:rows.length,
      visibleHeroNodeIds:[...byId.keys()].filter(id=>/^\d+$/.test(id)).sort((a,b)=>Number(a)-Number(b)),
      conflictingNodes:duplicates, time:new Date().toISOString()
    };
    progress.push(info);
    return {byId, info};
  }

  async function confirmStable(first, loaded, late, root, step) {
    const choices = new Map(), unresolved = [];
    const ids = new Set([...first.byId.keys(), ...loaded.byId.keys(), ...late.byId.keys()]);
    let recheck = null;
    const pick = (id,a,b,reason) => {
      const x=a?.byId.get(id), y=b?.byId.get(id);
      if (x && y && x.key === y.key) choices.set(id,{row:y,reason});
    };
    for (const id of ids) {
      pick(id,loaded,late,'loaded+late');
      if (!choices.has(id)) pick(id,first,late,'first+late');
      if (!choices.has(id)) unresolved.push(id);
    }
    // 불확실한 항목이 있을 때만 같은 정지 위치에서 한 번 더 확인한다.
    if (unresolved.length) {
      await sleep(CFG.ambiguousRecheckMs);
      if (popup()!==root || !live(root)) throw new Error('추가 검증 중 영웅 목록이 닫혔습니다.');
      recheck = sampleAt(root,'ambiguous-recheck',step);
      for (const id of unresolved) {
        pick(id,late,recheck,'late+recheck');
        if (!choices.has(id)) pick(id,loaded,recheck,'loaded+recheck');
      }
    }
    const missing = [...ids].filter(id=>!choices.has(id));
    if (missing.length) ambiguousSteps.push({step,ids:missing,
      phases:{first:[...first.byId.keys()],loaded:[...loaded.byId.keys()],late:[...late.byId.keys()],
        recheck:recheck ? [...recheck.byId.keys()] : null}});
    return {choices,missing,recheck:!!recheck};
  }

  async function saveConfirmed(confirmed, step) {
    let registered=0, saved=0, retries=0;
    for (const [id, evidence] of confirmed.choices) {
      const row = evidence.row;
      let hero = found.get(id);
      if (!hero) {
        hero = {id, variants:new Map(), firstStep:step};
        found.set(id,hero); registered++;
      }
      let candidate = hero.variants.get(row.key);
      if (!candidate) {
        candidate = {key:row.key, meta:row.meta, row, confirmedAt:[],
          confirmations:0, blob:null, error:null, attempts:0, filename:null};
        hero.variants.set(row.key,candidate);
      }
      candidate.confirmations++;
      candidate.confirmedAt.push({step,reason:evidence.reason});
      if (!candidate.blob && candidate.attempts < CFG.maxImageAttempts) {
        candidate.row=row;
        candidate.meta=row.meta;
        candidate.attempts++;
        try {
          candidate.blob=await capturePNG(row);
          candidate.error=null;
          saved++;
          if (candidate.attempts>1) retries++;
        } catch(err) {
          candidate.error=String(err?.message||err);
        }
        candidate.row=null;
      }
    }
    captured=[...found.values()].filter(hero=>
      [...hero.variants.values()].some(v=>!!v.blob)).length;
    return {confirmedHeroes:confirmed.choices.size,added:registered,saved,retries,
      unresolved:confirmed.missing.length,totalHeroIds:found.size,totalSavedHeroIds:captured};
  }

  function selectedEntries() {
    const entries=[];
    for (const hero of found.values()) {
      const variants=[...hero.variants.values()];
      // 동일 ID에 여러 이미지가 나타났을 때, 가장 자주 안정 확인된 프레임 우선.
      // 미저장 후보보다 실제 PNG로 저장된 후보를 우선한다.
      variants.sort((a,b)=>Number(!!b.blob)-Number(!!a.blob)
        || b.confirmations-a.confirmations
        || b.confirmedAt.at(-1).step-a.confirmedAt.at(-1).step);
      const winner=variants[0];
      if (!winner) continue;
      entries.push({id:hero.id, firstStep:hero.firstStep, ...winner,
        alternatives:variants.slice(1).map(v=>({frameName:v.meta.frameName,
          confirmations:v.confirmations,saved:!!v.blob,error:v.error}))});
    }
    return entries.sort((a,b)=>Number(a.id)-Number(b.id));
  }
  function safeName(value) {return String(value || 'unknown').replace(/[\\/\x00-\x1f<>:"|?*]/g,'_').replace(/\s+/g,'_').slice(0,65);}
  const te = new TextEncoder();
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n=0;n<256;n++) {let a=n; for (let i=0;i<8;i++) a=(a&1)?0xedb88320^(a>>>1):(a>>>1); table[n]=a>>>0;}
    return table;
  })();
  function crc32(bytes) {let c=0xffffffff;for(const b of bytes)c=(c>>>8)^crcTable[(c^b)&255];return (c^0xffffffff)>>>0;}
  function u16(d,i,v) {d.setUint16(i,v,true);}
  function u32(d,i,v) {d.setUint32(i,v>>>0,true);}
  async function makeZip(files) {
    const chunks=[], catalog=[];
    let pointer=0;
    const today=new Date(), yr=Math.max(1980,Math.min(2107,today.getFullYear()));
    const dd=((yr-1980)<<9)|((today.getMonth()+1)<<5)|today.getDate();
    const tt=(today.getHours()<<11)|(today.getMinutes()<<5)|Math.floor(today.getSeconds()/2);
    for (const [name,data] of files) {
      const filename=te.encode(name);
      const bytes=data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) :
        typeof data==='string' ? te.encode(data) : data;
      if (bytes.length>0xffffffff || pointer+bytes.length+filename.length+30>0xffffffff)
        throw new Error('ZIP 파일이 4GB 제한을 초과했습니다.');
      const crc=crc32(bytes);
      const hdr=new Uint8Array(30+filename.length), h=new DataView(hdr.buffer);
      u32(h,0,0x04034b50);u16(h,4,20);u16(h,6,0x800);u16(h,8,0);
      u16(h,10,tt);u16(h,12,dd);u32(h,14,crc);u32(h,18,bytes.length);
      u32(h,22,bytes.length);u16(h,26,filename.length);u16(h,28,0);
      hdr.set(filename,30);chunks.push(hdr,bytes);
      catalog.push({filename,crc,size:bytes.length,offset:pointer});
      pointer+=hdr.length+bytes.length;
    }
    const centralStart=pointer;
    for(const item of catalog) {
      const hdr=new Uint8Array(46+item.filename.length),h=new DataView(hdr.buffer);
      u32(h,0,0x02014b50);u16(h,4,20);u16(h,6,20);u16(h,8,0x800);
      u16(h,10,0);u16(h,12,tt);u16(h,14,dd);u32(h,16,item.crc);
      u32(h,20,item.size);u32(h,24,item.size);u16(h,28,item.filename.length);
      u16(h,30,0);u16(h,32,0);u16(h,34,0);u16(h,36,0);
      u32(h,38,0);u32(h,42,item.offset);hdr.set(item.filename,46);
      chunks.push(hdr);pointer+=hdr.length;
    }
    const tail=new Uint8Array(22),t=new DataView(tail.buffer);
    u32(t,0,0x06054b50);u16(t,4,0);u16(t,6,0);u16(t,8,catalog.length);
    u16(t,10,catalog.length);u32(t,12,pointer-centralStart);u32(t,16,centralStart);
    u16(t,20,0);chunks.push(tail);
    return new Blob(chunks,{type:'application/zip'});
  }
  function saveFile(blob,filename) {
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=filename;a.style.display='none';
    (document.body||document.documentElement).appendChild(a);
    a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }

  if (!cc?.director?.getScene) { console.error(LOG,'window.cc 게임 엔진을 찾지 못했습니다.'); return; }
  let launch, root;
  try {
    launch=await openHeroListSafely();
    root=launch.node;
  } catch (err) {
    console.error(LOG,'영웅 메뉴 자동 열기 중단:',err?.message||err);
    return;
  }
  const launchMeta={method:launch.method,button:launch.button||null};
  let closeInfo=null;
  try {
  // 안전하게 연 목록에서만 기존 v10 수집기를 실행한다.
  const view = findScroll(root);
  if (!view) { console.error(LOG,'영웅 목록 ScrollView를 찾지 못했습니다.'); return; }
  lastPopupPath=nodePath(root);
  const {sv}=view;
  const initiallyVisible = collectVisibleFrames(root).length;
  if (initiallyVisible === 0) {
    console.error(LOG, '시작 시 영웅 SpriteFrame이 0개입니다. 목록이 정상 표시된 후 재실행하세요. 스크롤하지 않았습니다.');
    return;
  }
  const original=offset(sv);
  const max=maximum(sv,view);
  const stepPx=Math.max(CFG.minStepPixels,Math.min(CFG.maxStepPixels,view.viewHeight*CFG.scrollStepRatio));
  const nSteps=Math.min(CFG.maxPositions,Math.ceil(max/stepPx)+1);
  const metaScroll={path:view.path,contentHeight:view.contentHeight,viewportHeight:view.viewHeight,
    originalOffset:original,maxOffset:max,stepPixels:stepPx,expectedPositions:nSteps,
    positions:[],minActual:null,maxActual:null,verified:false,restored:false,
    initiallyVisible,restoreDetails:null,blankListStops:0};
  console.log(LOG,'v9의 이미지 검증/복구 방식을 유지하며 대기는 단축하고 스크롤 간격은 넓힙니다.',
    {path:view.path,max,stepPx,nSteps,moveDurationSec:CFG.moveDurationSec,
      afterMoveWaitMs:CFG.afterMoveWaitMs,lateAssetWaitMs:CFG.lateAssetWaitMs});
  try {
    for(let i=0;i<nSteps;i++) {
      if(popup()!==root || !live(root)) throw new Error('수집 도중 영웅 목록이 닫히거나 바뀌었습니다.');
      const requested=Math.min(max,i*stepPx);
      toOffset(sv, requested, max, i === 0 ? 0 : CFG.moveDurationSec);
      let during=null;
      if (i>0) {
        await sleep(Math.ceil(CFG.moveDurationSec*500));
        if(popup()!==root || !live(root)) throw new Error('영웅 목록이 변경됐습니다.');
        // 이동 중 보인 이전 이미지가 새 영웅의 것인 것처럼 저장되는 버그 방지.
        during=sampleAt(root,'during-scroll',offset(sv));
        await sleep(Math.ceil(CFG.moveDurationSec*500)+120);
      } else {
        await sleep(CFG.initialWaitMs);
      }
      const observed=offset(sv);
      const first=sampleAt(root,'after-scroll',observed);
      await sleep(CFG.afterMoveWaitMs);
      let loaded=sampleAt(root,'after-load-wait',offset(sv));
      await sleep(CFG.lateAssetWaitMs);
      let late=sampleAt(root,'late',offset(sv));
      // 게임의 가상 목록에 영웅이 하나도 없을 때 계속 스크롤하면
      // 렌더링이 꼬일 수 있으므로 짧게 기다려 복구 여부를 확인하고 중단한다.
      if (!first.byId.size && !loaded.byId.size && !late.byId.size) {
        console.warn(LOG, `스크롤 위치 ${i+1}: 표시된 영웅이 0개입니다. 목록 갱신을 기다립니다.`,
          {requested,observed});
        await sleep(CFG.emptyListRetryMs);
        const retry=sampleAt(root,'empty-list-retry',offset(sv));
        if (!retry.byId.size) {
          metaScroll.blankListStops++;
          throw new Error(`영웅 가상 목록이 빈 상태: step=${i+1}, y=${offset(sv)?.y}. 안전 복귀합니다.`);
        }
        await sleep(CFG.ambiguousRecheckMs);
        const verifiedAgain=sampleAt(root,'empty-list-verified',offset(sv));
        if (!verifiedAgain.byId.size) {
          metaScroll.blankListStops++;
          throw new Error(`영웅 목록이 다시 비었습니다: step=${i+1}. 안전 복귀합니다.`);
        }
        loaded=retry;
        late=verifiedAgain;
      }
      const confirmed=await confirmStable(first,loaded,late,root,i);
      const saved=await saveConfirmed(confirmed,i);
      metaScroll.positions.push({step:i+1,requested,actual:observed,
        during:during?.info||null, first:first.info, loaded:loaded.info, late:late.info,
        ...saved, rechecked:confirmed.recheck, afterAllWaits:offset(sv)});
      console.log(LOG,`${i+1}/${nSteps}`,`y=${Math.round(observed?.y ?? 0)}`,
        `확인된영웅=${found.size}`,`PNG=${captured}`,`이번저장=${saved.saved}`,
        `불확실=${confirmed.missing.length}`);
    }
    const ys=metaScroll.positions.map(p=>p.actual?.y).filter(Number.isFinite);
    if(ys.length) {
      metaScroll.minActual=Math.min(...ys);metaScroll.maxActual=Math.max(...ys);
      metaScroll.verified=metaScroll.maxActual-metaScroll.minActual>Math.min(80,max*.3);
    }
    if(!metaScroll.verified) console.warn(LOG,'스크롤 이동이 검증되지 않았습니다.');
  } catch(error) {
    console.error(LOG,'진행 중 예외 (확정된 PNG는 ZIP에 포함합니다):',error);
    metaScroll.error=String(error?.message||error);
  } finally {
    try {
      sv.stopAutoScroll?.();
      const status = await restoreScrollSafely(sv, original, view, root, initiallyVisible);
      metaScroll.restoreDetails = status;
      metaScroll.restored = status.restored;
      if (initiallyVisible > 0 && status.heroSpritesAfter === 0) {
        // 이 경우 성공으로 보고하지 않는다. 게임 목록을 다시 열어야 할 수 있다.
        metaScroll.listStillBlank = true;
      }
    } catch(error) {metaScroll.restoreError=String(error?.message||error);}
  }
  if(CFG.retryFailedAtEnd && live(root)) {
    try {
      const a=sampleAt(root,'final-first',offset(sv));
      await sleep(CFG.ambiguousRecheckMs);
      const b=sampleAt(root,'final-second',offset(sv));
      const endChoices=new Map();
      for (const [id,row] of b.byId) {
        if(a.byId.get(id)?.key===row.key) endChoices.set(id,{row,reason:'final+final'});
      }
      await saveConfirmed({choices:endChoices,missing:[]},-1);
    } catch(error) {console.warn(LOG,'마지막 캡처 확인 실패:',error);}
  }
  // PNG 검증 및 스크롤 복구 후, 다른 게임 창을 건드리지 않고 영웅 목록만 닫는다.
  closeInfo=await closeHeroListSafely(root);
  if (!closeInfo.ok) console.warn(LOG,'영웅 창 자동 닫기 실패. 필요하면 직접 닫아주세요.',closeInfo);
  const entries=selectedEntries();
  const files=[];
  for (const item of entries) {
    if(!item.blob) continue;
    item.filename=`${safeName(item.id)}_${safeName(item.meta.frameName)}.png`;
    files.push([`heroes/${item.filename}`,item.blob]);
  }
  const manifest={
    version:11,createdAt:new Date().toISOString(),panel:CFG.panel,popupPath:lastPopupPath,
    uiAutomation:{launch:launchMeta,close:closeInfo},
    config:CFG,scroll:metaScroll,progress,
    statistics:{distinctHeroNodeIds:[...observedIds].sort((a,b)=>Number(a)-Number(b)),
      observedHeroIds:observedIds.size, movingObservedHeroIds:movingObservations.size,
      confirmedHeroIds:found.size, savedPNG:files.length,
      failedPNG:entries.filter(e=>!e.blob).length,
      neverConfirmedIds:[...observedIds].filter(id=>!found.has(id)).sort((a,b)=>Number(a)-Number(b)),
      competingImageIds:entries.filter(e=>e.alternatives.length>0).map(e=>e.id),
      durationMs:Date.now()-started},
    ambiguousSteps,
    entries:entries.map(item=>({...item.meta,heroNodeId:item.id,firstStep:item.firstStep,
      confirmations:item.confirmations,confirmedAt:item.confirmedAt,
      alternatives:item.alternatives,
      png:item.filename?`heroes/${item.filename}`:null,bytes:item.blob?.size||0,
      attempts:item.attempts,error:item.error}))
  };
  files.unshift(['manifest.json',JSON.stringify(manifest,null,2)]);
  files.unshift(['README.txt',
    'HeroListPopup2023 v11: one-shot auto open, v10 guarded capture and safe close.\r\n'+
    'Scroll step ratio 0.38 (220..330px), initial 800ms, after-move 400ms, late 250ms; movement time remains 0.35s.\r\n'+
    'Empty-list abort and gradual restoration are unchanged from v9.\r\n'+
    'The same hero ID and SpriteFrame must be observed in two settled samples.\r\n'+
    'One selected PNG per hero ID; manifest records alternatives, ambiguous observations and errors.\r\n'+
    'Sprites may use legacy icon numbers that differ from hero IDs; do not force numeric equality.\r\n'+
    'No Tampermonkey, upload, or permanent hooks; closes only the verified hero popup.\r\n']);
  try {
    const archive=await makeZip(files);
    const filename=`topwar-heroes-auto-v11-${Date.now()}.zip`;
    saveFile(archive,filename);
    console.table(entries.map(e=>({hero:e.meta.heroNodeId,frame:e.meta.frameName,
      png:!!e.blob,firstStep:e.firstStep,error:e.error})).slice(0,100));
    console.log(LOG,'완료:',{filename,bytes:archive.size, ...manifest.statistics,
      scrollVerified:metaScroll.verified,originalScrollRestored:metaScroll.restored,
      heroSpritesAfterRestore:metaScroll.restoreDetails?.heroSpritesAfter,
      listStillBlank:!!metaScroll.listStillBlank});
    if (manifest.statistics.neverConfirmedIds.length) console.warn(LOG,
      '이미지는 관측했지만 정지 후 일치가 확인되지 않은 영웅:',
      manifest.statistics.neverConfirmedIds);
    if (manifest.statistics.competingImageIds.length) console.warn(LOG,
      '두 이미지 이상이 안정적으로 관측된 영웅 (manifest 대체 후보 확인):',
      manifest.statistics.competingImageIds);
  } catch(error) {console.error(LOG,'ZIP 생성/다운로드 실패:',error);}
  } finally {
    // 수집/ZIP 단계의 예상치 못한 예외에서도 영웅 목록만 닫는다.
    if (root && live(root) && popup()===root && !closeInfo?.ok) {
      // 이미 닫기 명령을 실행했다면 절대로 2차 닫기를 하지 않는다.
      if (!closeInfo || closeInfo.reason === 'no-safe-close-button' || closeInfo.reason === 'ambiguous-close') {
        if (!closeInfo) {
          const result=await closeHeroListSafely(root);
          console.log(LOG,'예외 후 영웅 목록 종료 결과:',result);
        }
      }
    }
  }
})();
