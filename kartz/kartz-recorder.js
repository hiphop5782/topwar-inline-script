(function () {
  'use strict';

  const CONFIG = {
    // 기존 Java 프로그램에서 사용한 기준 화면 크기
    referenceWidth: 400,
    referenceHeight: 600,

    playerLimit: 500,

    // 아래 스크롤 영역 좌표는 400x600 기준
    scrollArea: {
      minX: 225,
      maxX: 275,
      minY: 325,
      maxY: 375
    },

    wheelDelta: 600,
    wheelsPerCycle: 10,
    wheelInterval: 60,
    loadWait: 500,
    playerTimeout: 5 * 60 * 1000
  };

  const PANEL_ID = 'kartz-collector-panel';
  const PLAYER_BUTTON_ID = 'kartz-player-button';
  const ALLIANCE_BUTTON_ID = 'kartz-alliance-button';
  const DOWNLOAD_BUTTON_ID = 'kartz-download-button';
  const STATUS_ID = 'kartz-collector-status';

  let running = false;
  let cancelled = false;
  let currentCollectionType = null;
  let finishAllianceRequested = false;
  let cachedComponent = null;
  let collectedPlayers = null;
  let collectedAlliances = null;

  if (window.__kartzCollectorMonitor) {
    clearInterval(window.__kartzCollectorMonitor);
  }

  document.getElementById(PANEL_ID)?.remove();
  document.getElementById(STATUS_ID)?.remove();

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function javaInt(value) {
    if (value === null || value === undefined || value === '') {
      return 0;
    }

    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : 0;
  }

  function nullableString(value) {
    return value === null || value === undefined
      ? null
      : String(value);
  }

  function formatLocalDateTime(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');

    return (
      `${date.getFullYear()}-` +
      `${pad(date.getMonth() + 1)}-` +
      `${pad(date.getDate())}T` +
      `${pad(date.getHours())}:` +
      `${pad(date.getMinutes())}:` +
      `${pad(date.getSeconds())}`
    );
  }

  function setStatus(message) {
    const status = document.getElementById(STATUS_ID);

    if (status) {
      status.textContent = message;
    }

    console.log(`[카르츠] ${message}`);
  }

  function getGameElement() {
    return (
      document.querySelector('#GameCanvas') ||
      document.querySelector('canvas')
    );
  }

  function getClassName(component) {
    if (!component) {
      return '';
    }

    try {
      const className = globalThis.cc?.js?.getClassName?.(component);

      if (className) {
        return className;
      }
    } catch {}

    return (
      component.__classname__ ||
      component.constructor?.name ||
      ''
    );
  }

  function looksLikeRankingComponent(component) {
    if (!component) {
      return false;
    }

    const className = getClassName(component);

    if (
      className === 'EndLessPVERankPop' ||
      className.includes('EndLessPVERankPop')
    ) {
      return true;
    }

    const data = component._data;

    if (!Array.isArray(data)) {
      return false;
    }

    for (const list of data) {
      if (!Array.isArray(list)) {
        continue;
      }

      const sample = list.find(
        item => item && typeof item === 'object'
      );

      if (
        sample &&
        'rank' in sample &&
        'sid' in sample &&
        (
          'playeInfo' in sample ||
          'aName' in sample ||
          'aTag' in sample
        )
      ) {
        return true;
      }
    }

    return false;
  }

  function isComponentActive(component) {
    if (!component || component._destroyed || component.node?._destroyed) {
      return false;
    }

    if (
      component.node?.activeInHierarchy === false ||
      component.node?.active === false
    ) {
      return false;
    }

    return true;
  }

  function findComponentRecursively(node) {
    if (!node) {
      return null;
    }

    const components =
      node._components ||
      node.getComponents?.(cc.Component) ||
      [];

    for (const component of components) {
      if (
        isComponentActive(component) &&
        looksLikeRankingComponent(component)
      ) {
        return component;
      }
    }

    const children = node.children || node._children || [];

    for (const child of children) {
      const found = findComponentRecursively(child);

      if (found) {
        return found;
      }
    }

    return null;
  }

  function findInPersistentNodes() {
    const persistRootNodes = cc?.game?._persistRootNodes;

    if (!persistRootNodes) {
      return null;
    }

    const nodes = Array.isArray(persistRootNodes)
      ? persistRootNodes
      : Object.values(persistRootNodes);

    for (const node of nodes) {
      const found = findComponentRecursively(node);

      if (found) {
        return found;
      }
    }

    return null;
  }

  function getRankingComponent() {
    if (isComponentActive(cachedComponent)) {
      return cachedComponent;
    }

    cachedComponent = null;

    if (!globalThis.cc?.director) {
      throw new Error(
        'Cocos의 cc 객체를 찾지 못했습니다. ' +
        '개발자 도구의 실행 대상을 게임 iframe으로 변경하세요.'
      );
    }

    const scene = cc.director.getScene();

    if (!scene) {
      throw new Error('현재 게임 Scene을 찾지 못했습니다.');
    }

    try {
      const direct = scene.getComponentInChildren?.(
        'EndLessPVERankPop'
      );

      if (isComponentActive(direct)) {
        cachedComponent = direct;
        return direct;
      }
    } catch {}

    const recursive = findComponentRecursively(scene);

    if (recursive) {
      cachedComponent = recursive;
      console.log('Scene에서 랭킹 컴포넌트를 찾았습니다:', recursive);
      return recursive;
    }

    const persistent = findInPersistentNodes();

    if (persistent) {
      cachedComponent = persistent;
      console.log('Persistent Node에서 랭킹 컴포넌트를 찾았습니다:', persistent);
      return persistent;
    }

    throw new Error(
      '카르츠 랭킹 컴포넌트를 찾지 못했습니다. ' +
      '카르츠 랭킹 창을 연 뒤 다시 시도하세요.'
    );
  }

  // 400x600 기준 좌표를 현재 게임 캔버스 비율로 변환한다.
  function getGamePosition(referenceX, referenceY) {
    const element = getGameElement();

    if (!element) {
      throw new Error('게임 canvas를 찾지 못했습니다.');
    }

    const rect = element.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      throw new Error('게임 canvas 크기가 올바르지 않습니다.');
    }

    return {
      element,
      clientX:
        rect.left +
        (referenceX / CONFIG.referenceWidth) * rect.width,
      clientY:
        rect.top +
        (referenceY / CONFIG.referenceHeight) * rect.height
    };
  }

  function dispatchMouse(
    element,
    type,
    clientX,
    clientY,
    buttons
  ) {
    element.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        button: 0,
        buttons
      })
    );
  }

  function wheelDown() {
    const x = random(
      CONFIG.scrollArea.minX,
      CONFIG.scrollArea.maxX
    );

    const y = random(
      CONFIG.scrollArea.minY,
      CONFIG.scrollArea.maxY
    );

    const {
      element,
      clientX,
      clientY
    } = getGamePosition(x, y);

    dispatchMouse(element, 'mousemove', clientX, clientY, 0);

    element.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        deltaX: 0,
        deltaY: CONFIG.wheelDelta,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL
      })
    );
  }

  async function scrollCycle() {
    for (let i = 0; i < CONFIG.wheelsPerCycle; i++) {
      if (cancelled) {
        throw new Error('수집이 중단됐습니다.');
      }

      wheelDown();
      await wait(CONFIG.wheelInterval);
    }

    await wait(CONFIG.loadWait);
  }

  async function loadRanking({
    dataIndex,
    limit,
    label,
    timeout
  }) {
    const startedAt = Date.now();
    let previousCount = -1;
    let unchangedCycles = 0;

    while (true) {
      if (cancelled) {
        throw new Error('수집이 중단됐습니다.');
      }

      const component = getRankingComponent();
      const list = component?._data?.[dataIndex];
      const count = Array.isArray(list) ? list.length : 0;

      setStatus(`${label} 로딩 중: ${count}/${limit}`);

      if (count >= limit) {
        setStatus(`${label} ${limit}개 로딩 완료`);
        return list.slice(0, limit);
      }

      if (count === previousCount) {
        unchangedCycles++;
      } else {
        previousCount = count;
        unchangedCycles = 0;
      }

      if (Date.now() - startedAt >= timeout) {
        throw new Error(
          `${label} 로딩 시간 초과: ${count}/${limit}`
        );
      }

      await scrollCycle();

      if (unchangedCycles >= 10) {
        setStatus(`${label} 추가 데이터 대기 중: ${count}/${limit}`);
        await wait(1500);
        unchangedCycles = 0;
      }
    }
  }

  function createPlayerData(player) {
    const uid = nullableString(player?.uid)?.trim();

    if (!uid) {
      throw new Error(
        `UID 누락: rank=${player?.rank ?? '?'}, ` +
        `server=${player?.sid ?? '?'}`
      );
    }

    let detail;

    try {
      detail = JSON.parse(player.playeInfo);
    } catch {
      throw new Error(
        `playeInfo 해석 실패: uid=${uid}, ` +
        `rank=${player?.rank ?? '?'}`
      );
    }

    return {
      rank: javaInt(player.rank),
      uid,
      nation: javaInt(
        detail.nationalflag ?? detail.nationalFlag
      ),
      gender: Math.max(
        javaInt(detail.usergender),
        javaInt(detail.gender)
      ),
      nickname: nullableString(detail.username),
      profile: nullableString(detail.headimgurl_custom),
      round: javaInt(player.specId) - 100600,
      server: javaInt(player.sid),
      damage: nullableString(player.damageShow)
    };
  }

  function createAllianceData(alliance) {
    if (!alliance || typeof alliance !== 'object') {
      return null;
    }

    try {
      return {
        rank: javaInt(alliance.rank),
        server: javaInt(alliance.sid),
        name: nullableString(alliance.aName),
        tag: nullableString(alliance.aTag),
        totem: javaInt(alliance.totem),
        score: javaInt(alliance.score)
      };
    } catch {
      return null;
    }
  }

  async function collectPlayers() {
    getRankingComponent();
    setStatus('현재 열린 개인 랭킹을 수집합니다.');

    const rawPlayers = await loadRanking({
      dataIndex: 0,
      limit: CONFIG.playerLimit,
      label: '개인 랭킹',
      timeout: CONFIG.playerTimeout
    });

    setStatus('개인 랭킹 변환 중...');
    const result = rawPlayers.map(createPlayerData);

    if (result.length !== CONFIG.playerLimit) {
      throw new Error(
        `개인 랭킹 결과: ${result.length}/${CONFIG.playerLimit}`
      );
    }

    return result;
  }

  async function collectAlliances() {
    getRankingComponent();
    setStatus('길드 랭킹 수집 중: 완료 버튼을 누를 때까지 계속합니다.');

    let rawAlliances = [];

    while (!finishAllianceRequested) {
      const component = getRankingComponent();
      const list = component?._data?.[2];

      rawAlliances = Array.isArray(list) ? list : [];
      setStatus(
        `길드 랭킹 수집 중: ${rawAlliances.length}개 ` +
        '(끝났으면 길드랭킹 완료를 누르세요)'
      );

      await scrollCycle();
    }

    const component = getRankingComponent();
    const finalList = component?._data?.[2];
    rawAlliances = Array.isArray(finalList)
      ? finalList.slice()
      : rawAlliances.slice();

    if (rawAlliances.length === 0) {
      throw new Error('수집된 길드 랭킹이 없습니다.');
    }

    setStatus('길드 랭킹 변환 중...');
    const result = rawAlliances
      .map(createAllianceData)
      .filter(item => item !== null);

    return result;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {}

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.readOnly = true;

    Object.assign(textarea.style, {
      position: 'fixed',
      left: '-9999px',
      top: '0'
    });

    document.body.appendChild(textarea);
    textarea.select();

    const copied = document.execCommand('copy');
    textarea.remove();

    if (!copied) {
      throw new Error('클립보드 복사에 실패했습니다.');
    }
  }

  function downloadJson(data) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], {
      type: 'application/json;charset=utf-8'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download =
      `kartz-ranking-${data.time.replaceAll(':', '-')}.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function setButtonsDisabled(disabled) {
    for (const id of [
      PLAYER_BUTTON_ID,
      ALLIANCE_BUTTON_ID,
      DOWNLOAD_BUTTON_ID
    ]) {
      const button = document.getElementById(id);

      if (button) {
        button.disabled = disabled;
        button.style.opacity = disabled ? '0.55' : '1';
      }
    }
  }

  function setCollectionUi(type) {
    setButtonsDisabled(true);

    if (type === 'alliance') {
      const button = document.getElementById(ALLIANCE_BUTTON_ID);

      button.disabled = false;
      button.style.opacity = '1';
      button.style.background = '#c62828';
      button.textContent = '길드랭킹 완료';
    }
  }

  function resetCollectionUi() {
    setButtonsDisabled(false);

    const button = document.getElementById(ALLIANCE_BUTTON_ID);
    button.style.background = '#7b3fc6';
    button.textContent = '길드랭킹 수집';
  }

  async function runCollection(type) {
    if (running) {
      if (
        currentCollectionType === 'alliance' &&
        type === 'alliance'
      ) {
        finishAllianceRequested = true;
        setStatus('길드 랭킹 수집을 완료하는 중...');
      }

      return;
    }

    running = true;
    cancelled = false;
    currentCollectionType = type;
    finishAllianceRequested = false;
    setCollectionUi(type);

    try {
      if (type === 'player') {
        collectedPlayers = await collectPlayers();
        setStatus(`개인 랭킹 ${collectedPlayers.length}명 수집 완료`);
      } else {
        collectedAlliances = await collectAlliances();
        setStatus(`길드 랭킹 ${collectedAlliances.length}개 수집 완료`);
      }

      window.kartzCollectedPlayers = collectedPlayers;
      window.kartzCollectedAlliances = collectedAlliances;
    } catch (error) {
      console.error('카르츠 랭킹 수집 실패:', error);
      setStatus(`실패: ${error.message}`);
      alert(`카르츠 랭킹 수집 실패\n\n${error.message}`);
    } finally {
      running = false;
      cancelled = false;
      currentCollectionType = null;
      finishAllianceRequested = false;
      resetCollectionUi();
    }
  }

  async function saveCollectedData() {
    if (!collectedPlayers) {
      alert('개인 랭킹 탭을 열고 개인랭킹 수집 버튼을 먼저 누르세요.');
      return;
    }

    if (!collectedAlliances) {
      alert('길드 랭킹 탭을 열고 길드랭킹 수집 버튼을 먼저 누르세요.');
      return;
    }

    const data = {
      time: formatLocalDateTime(),
      playerRankList: collectedPlayers,
      allianceRankList: collectedAlliances
    };

    const json = JSON.stringify(data, null, 2);

    try {
      setStatus('클립보드 복사 및 파일 저장 중...');
      await copyText(json);
      downloadJson(data);
      window.kartzRankingData = data;

      setStatus(
        `다운로드 완료: 개인 ${collectedPlayers.length}명 / ` +
        `길드 ${collectedAlliances.length}개`
      );
    } catch (error) {
      console.error('다운로드 실패:', error);
      setStatus(`다운로드 실패: ${error.message}`);
      alert(`다운로드 실패\n\n${error.message}`);
    }
  }

  const status = document.createElement('div');
  status.id = STATUS_ID;
  status.textContent =
    '탭을 직접 연 뒤 해당 수집 버튼을 누르세요.';

  Object.assign(status.style, {
    position: 'fixed',
    right: '20px',
    bottom: '78px',
    zIndex: '2147483647',
    maxWidth: '380px',
    padding: '10px 14px',
    borderRadius: '8px',
    background: 'rgba(0,0,0,0.85)',
    color: '#ffffff',
    fontSize: '13px',
    fontFamily: 'sans-serif',
    boxShadow: '0 4px 14px rgba(0,0,0,0.35)'
  });

  const panel = document.createElement('div');
  panel.id = PANEL_ID;

  Object.assign(panel.style, {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: '2147483647',
    display: 'flex',
    gap: '8px'
  });

  function createButton(id, text, color, handler) {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', handler);

    Object.assign(button.style, {
      padding: '12px 14px',
      border: 'none',
      borderRadius: '8px',
      background: color,
      color: '#ffffff',
      fontSize: '13px',
      fontWeight: '700',
      fontFamily: 'sans-serif',
      cursor: 'pointer',
      boxShadow: '0 4px 14px rgba(0,0,0,0.35)'
    });

    return button;
  }

  const playerButton = createButton(
    PLAYER_BUTTON_ID,
    '개인랭킹 수집',
    '#1268e8',
    () => runCollection('player')
  );

  const allianceButton = createButton(
    ALLIANCE_BUTTON_ID,
    '길드랭킹 수집',
    '#7b3fc6',
    () => runCollection('alliance')
  );

  const downloadButton = createButton(
    DOWNLOAD_BUTTON_ID,
    '다운로드',
    '#218838',
    saveCollectedData
  );

  panel.appendChild(playerButton);
  panel.appendChild(allianceButton);
  panel.appendChild(downloadButton);

  document.body.appendChild(status);
  document.body.appendChild(panel);

  let lastWindowDetected = null;

  function monitorRankingWindow() {
    if (running) {
      return;
    }

    try {
      const component = getRankingComponent();

      if (lastWindowDetected !== true) {
        lastWindowDetected = true;
        setStatus(
          '랭킹 창 감지 완료: 현재 열린 탭의 수집 버튼을 누르세요.'
        );
        console.log('카르츠 랭킹 컴포넌트:', component);
      }
    } catch {
      cachedComponent = null;

      if (lastWindowDetected !== false) {
        lastWindowDetected = false;
        setStatus('카르츠 랭킹 창이 열리기를 기다리는 중...');
      }
    }
  }

  monitorRankingWindow();
  window.__kartzCollectorMonitor = setInterval(
    monitorRankingWindow,
    1000
  );
})();
