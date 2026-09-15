(() => {
    'use strict';
    const installation = {};
    try {

    /* ============================================================
     * TopWar Navigation Controller
     * v0.9.3
     *
     * 상태
     * - BASE
     * - WORLD
     * - WORLD_MINIMAP
     * - WORLD_MAP
     *
     * UI 버튼
     * - 기지
     * - 월드
     * - 월드맵
     *
     * WORLD_MINIMAP은 내부 중간 상태
     * ============================================================ */

    const VERSION = '0.9.3';

    const UI_ID = 'topwar-nav-v093';
    const STYLE_ID = 'topwar-nav-v093-style';

    const WATCH_INTERVAL = 250;


    /* ============================================================
     * STATE
     * ============================================================ */

    const STATE = Object.freeze({

        BASE:
            'BASE',

        WORLD:
            'WORLD',

        WORLD_MINIMAP:
            'WORLD_MINIMAP',

        WORLD_MAP:
            'WORLD_MAP',

        UNKNOWN:
            'UNKNOWN'
    });


    /* ============================================================
     * 실제 확인된 경로
     * ============================================================ */

    const PATH = Object.freeze({

        MINIMAP:
            'NWorldMap/UICanvas/WorldMapUIWrapper/NWorldMapUI/' +
            'leftTopNode/leftMoveNode/minimapNode/infoNode/MinimapBtn',

        WORLD_MAP:
            'NWorldMap/UICanvas/PopLayer/UIFrameNone/CONTENT/' +
            'NWorldMinimap3D/UINodeNormal/worldmapBtn'
    });


    let watcher = null;

    let moving = false;

    let lastState = null;


    /* ============================================================
     * 기존 버전 제거
     * ============================================================ */

    const previousNav = window.TOPWAR_NAV;
    const uiEvents = new AbortController();
    installation.events = uiEvents;
    let disposed = false;
    let profileBusy = false;
    const runtimeErrors = [];
    const runtimeLogs = [];
    const MAX_RUNTIME_LOGS = 200;

    /* ============================================================
     * 공통
     * ============================================================ */

    const sleep = ms =>
        new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    Number(ms) || 0
                )
        );


    function scene() {

        try {

            return (
                window.cc
                    ?.director
                    ?.getScene?.()
                || null
            );

        } catch {

            return null;
        }
    }


    function isActive(node) {

        if (!node)
            return false;


        try {

            if (
                node.active === false
            )
                return false;

        } catch {}


        try {

            if (
                node.activeInHierarchy ===
                false
            )
                return false;

        } catch {}


        return true;
    }


    function nodePath(node) {

        const names = [];

        let current =
            node;


        while (current) {

            names.unshift(
                current.name || '?'
            );

            current =
                current.parent;
        }


        return names.join('/');
    }


    function componentName(component) {

        return String(

            component
                ?.__classname__

            ||

            component
                ?.constructor
                ?.name

            ||

            component
                ?.name

            ||

            ''
        );
    }


    function walk(
        root,
        callback
    ) {

        if (!root)
            return;


        const stack =
            [root];

        const visited =
            new Set();


        while (
            stack.length
        ) {

            const node =
                stack.pop();


            if (!node)
                continue;


            if (
                visited.has(node)
            )
                continue;


            visited.add(node);


            callback(node);


            for (
                const child
                of node.children || []
            ) {

                stack.push(
                    child
                );
            }
        }
    }


    /* ============================================================
     * 정확한 direct child 경로 탐색
     * ============================================================ */

    function findDirectPath(path) {

        const root =
            scene();


        if (!root)
            return null;


        const parts =
            String(path)
                .split('/')
                .filter(Boolean);


        if (
            !parts.length
        )
            return null;


        /*
         * 첫 번째 root 이름 검색
         */

        let current =
            null;


        walk(
            root,
            node => {

                if (current)
                    return;


                if (
                    node.name ===
                    parts[0]
                ) {

                    current =
                        node;
                }
            }
        );


        if (!current)
            return null;


        /*
         * 이후는 반드시 direct child
         */

        for (
            let i = 1;
            i < parts.length;
            i++
        ) {

            const name =
                parts[i];


            current =

                current
                    .getChildByName
                    ?.(name)

                ||

                (
                    current.children || []
                ).find(
                    child =>
                        child?.name ===
                        name
                )

                ||

                null;


            if (!current)
                return null;
        }


        return current;
    }


    /* ============================================================
     * 이름으로 Node 찾기
     * ============================================================ */

    function findNodeByName(
        name,
        activeOnly = false
    ) {

        let result =
            null;


        walk(
            scene(),
            node => {

                if (result)
                    return;


                if (
                    node.name !== name
                )
                    return;


                if (
                    activeOnly &&
                    !isActive(node)
                )
                    return;


                result =
                    node;
            }
        );


        return result;
    }


    /* ============================================================
     * Component 찾기
     * ============================================================ */

    function findComponent(
        name,
        activeOnly = false
    ) {

        let result =
            null;


        walk(
            scene(),
            node => {

                if (result)
                    return;


                if (
                    activeOnly &&
                    !isActive(node)
                )
                    return;


                /*
                 * getComponent(name)
                 */

                try {

                    const direct =
                        node.getComponent?.(
                            name
                        );


                    if (direct) {

                        if (
                            !activeOnly ||
                            isActive(
                                direct.node
                            )
                        ) {

                            result =
                                direct;

                            return;
                        }
                    }

                } catch {}


                /*
                 * _components
                 */

                for (
                    const component
                    of node._components || []
                ) {

                    if (
                        componentName(
                            component
                        ) !==
                        name
                    )
                        continue;


                    if (
                        activeOnly &&
                        !isActive(
                            component.node
                        )
                    )
                        continue;


                    result =
                        component;

                    return;
                }
            }
        );


        return result;
    }


    /* ============================================================
     * Cocos Button 실행
     * ============================================================ */

    function triggerButton(node) {

        if (!node) {

            return {

                ok: false,

                reason:
                    'node 없음'
            };
        }


        /*
         * 1. cc.Button clickEvents
         */

        try {

            const button =
                node.getComponent?.(
                    cc.Button
                );


            if (
                button
                    ?.clickEvents
                    ?.length

                &&

                cc.Component
                    ?.EventHandler
                    ?.emitEvents
            ) {

                const event = {

                    type:
                        'click',

                    target:
                        node,

                    currentTarget:
                        node
                };


                cc.Component
                    .EventHandler
                    .emitEvents(
                        button.clickEvents,
                        event
                    );


                return {

                    ok: true,

                    method:
                        'clickEvents',

                    node:
                        node.name,

                    path:
                        nodePath(node)
                };
            }

        } catch (
            error
        ) {

            console.warn(
                '[NAV] clickEvents 실패',
                error
            );
        }


        /*
         * 2. node.emit
         */

        try {

            if (
                typeof node.emit ===
                'function'
            ) {

                node.emit(
                    'click',
                    {
                        type:
                            'click',

                        target:
                            node,

                        currentTarget:
                            node
                    }
                );


                return {

                    ok: true,

                    method:
                        'node.emit',

                    node:
                        node.name,

                    path:
                        nodePath(node)
                };
            }

        } catch (
            error
        ) {

            console.warn(
                '[NAV] node.emit 실패',
                error
            );
        }


        return {

            ok: false,

            reason:
                '실행 가능한 이벤트 없음',

            node:
                node.name,

            path:
                nodePath(node)
        };
    }


    /* ============================================================
     * 상태 신호
     * ============================================================ */

    function getSignals() {

        const serverPanel =
            findComponent(
                'WorldServerListPanel',
                true
            );


        const serverPanelNode =

            serverPanel?.node

            ||

            findNodeByName(
                'WorldServerListPanel',
                true
            );


        const minimapButton =
            findDirectPath(
                PATH.MINIMAP
            );


        const worldmapButton =
            findDirectPath(
                PATH.WORLD_MAP
            );


        const nWorldMap =
            findNodeByName(
                'NWorldMap',
                true
            );


        const minimapRoot =
            findNodeByName(
                'NWorldMinimap3D',
                true
            );


        return {

            serverPanel:
                !!(
                    serverPanelNode &&
                    isActive(
                        serverPanelNode
                    )
                ),

            serverPanelNode,


            minimapButton:
                !!(
                    minimapButton &&
                    isActive(
                        minimapButton
                    )
                ),

            minimapButtonNode:
                minimapButton,


            worldmapButton:
                !!(
                    worldmapButton &&
                    isActive(
                        worldmapButton
                    )
                ),

            worldmapButtonNode:
                worldmapButton,


            minimapRoot:
                !!(
                    minimapRoot &&
                    isActive(
                        minimapRoot
                    )
                ),

            minimapRootNode:
                minimapRoot,


            nWorldMap:
                !!(
                    nWorldMap &&
                    isActive(
                        nWorldMap
                    )
                ),

            nWorldMapNode:
                nWorldMap
        };
    }


    function simplifySignals(s) {

        return {

            serverPanel:
                s.serverPanel,

            minimapButton:
                s.minimapButton,

            worldmapButton:
                s.worldmapButton,

            minimapRoot:
                s.minimapRoot,

            nWorldMap:
                s.nWorldMap
        };
    }


    /* ============================================================
     * 상태 감지
     * ============================================================ */

    function detect() {

        const s =
            getSignals();


        /*
         * 1.
         * WorldServerListPanel
         */

        if (
            s.serverPanel
        ) {

            return {

                state:
                    STATE.WORLD_MAP,

                confidence:
                    1,

                reason:
                    'WorldServerListPanel active',

                signals:
                    simplifySignals(s)
            };
        }


        /*
         * 2.
         * 중간 미니맵
         */

        if (
            s.worldmapButton ||
            s.minimapRoot
        ) {

            return {

                state:
                    STATE.WORLD_MINIMAP,

                confidence:
                    1,

                reason:
                    'NWorldMinimap3D active',

                signals:
                    simplifySignals(s)
            };
        }


        /*
         * 3.
         * 일반 WORLD
         */

        if (
            s.minimapButton
        ) {

            return {

                state:
                    STATE.WORLD,

                confidence:
                    1,

                reason:
                    'MinimapBtn active',

                signals:
                    simplifySignals(s)
            };
        }


        /*
         * 4.
         * 전환중
         */

        if (
            s.nWorldMap
        ) {

            return {

                state:
                    STATE.UNKNOWN,

                confidence:
                    0.4,

                reason:
                    'NWorldMap active but UI not confirmed',

                signals:
                    simplifySignals(s)
            };
        }


        /*
         * 5.
         * BASE
         */

        return {

            state:
                STATE.BASE,

            confidence:
                0.9,

            reason:
                'World UI not active',

            signals:
                simplifySignals(s)
        };
    }


    /* ============================================================
     * 상태 대기
     * ============================================================ */

    async function waitForState(
        target,
        options = {}
    ) {

        const timeout =
            Number(
                options.timeout ??
                12000
            );


        const interval =
            Number(
                options.interval ??
                150
            );


        const stableRequired =
            Number(
                options.stable ??
                2
            );


        const started =
            Date.now();


        let stable = 0;

        let last = null;


        while (
            Date.now() -
            started <
            timeout
        ) {

            last =
                detect();


            if (
                last.state ===
                target
            ) {

                stable++;


                if (
                    stable >=
                    stableRequired
                ) {

                    return {

                        ok: true,

                        state:
                            target,

                        elapsed:
                            Date.now() -
                            started,

                        detected:
                            last
                    };
                }

            } else {

                stable = 0;
            }


            await sleep(
                interval
            );
        }


        return {

            ok: false,

            target,

            elapsed:
                Date.now() -
                started,

            last
        };
    }


    /* ============================================================
     * Button 수집
     * ============================================================ */

    function collectActiveButtons(
        root = scene()
    ) {

        const rows =
            [];


        walk(
            root,
            node => {

                if (
                    !isActive(node)
                )
                    return;


                let button =
                    null;


                try {

                    button =
                        node.getComponent?.(
                            cc.Button
                        );

                } catch {}


                if (!button)
                    return;


                const events =
                    [];


                for (
                    const event
                    of button.clickEvents || []
                ) {

                    events.push(

                        [
                            event?.component,
                            event?.handler,
                            event?.target?.name
                        ]
                            .filter(Boolean)
                            .join(' ')
                    );
                }


                const value =

                    [
                        node.name,
                        nodePath(node),
                        ...events
                    ]

                        .join(' ')

                        .replace(
                            /[^a-zA-Z0-9가-힣]/g,
                            ''
                        )

                        .toLowerCase();


                rows.push({

                    node,

                    button,

                    events,

                    value,

                    path:
                        nodePath(node)
                });
            }
        );


        return rows;
    }


    /* ============================================================
     * BASE 버튼 점수
     * ============================================================ */

    function scoreGoBase(row) {

        const value =
            row.value;


        let score = 0;


        if (
            value.includes('btnhome')
        )
            score += 180;


        if (
            value.includes('gohome')
        )
            score += 180;


        if (
            value.includes('returnbase')
        )
            score += 150;


        if (
            value.includes('backhome')
        )
            score += 150;


        if (
            value.includes('maincity')
        )
            score += 140;


        if (
            value.includes('기지')
        )
            score += 100;


        if (
            value.includes('home')
        )
            score += 100;


        if (
            value.includes('base')
        )
            score += 80;


        if (
            value.includes('city')
        )
            score += 50;


        if (
            value.includes('close')
        )
            score -= 200;


        if (
            value.includes('chat')
        )
            score -= 160;


        if (
            value.includes('share')
        )
            score -= 160;


        if (
            value.includes('guild') ||
            value.includes('alliance')
        )
            score -= 100;


        return score;
    }


    /* ============================================================
     * WORLD 버튼 점수
     * ============================================================ */

    function scoreGoWorld(row) {

        const value =
            row.value;


        let score = 0;


        if (
            value.includes('worldmap')
        )
            score += 190;


        if (
            value.includes('btnworld')
        )
            score += 170;


        if (
            value.includes('btnmap')
        )
            score += 150;


        if (
            value.includes('mapbtn')
        )
            score += 140;


        if (
            value.includes('nworld')
        )
            score += 130;


        if (
            value.includes('월드맵')
        )
            score += 180;


        if (
            value.includes('월드')
        )
            score += 110;


        if (
            value.includes('지도')
        )
            score += 90;


        if (
            value.includes('world')
        )
            score += 70;


        if (
            value.includes('map')
        )
            score += 60;


        if (
            value.includes('chat')
        )
            score -= 240;


        if (
            value.includes('share')
        )
            score -= 160;


        if (
            value.includes('close')
        )
            score -= 180;


        return score;
    }


    /* ============================================================
     * BASE -> WORLD
     * ============================================================ */

    async function baseToWorld(
        options = {}
    ) {

        if (
            detect().state ===
            STATE.WORLD
        ) {

            return {

                ok: true,

                alreadyThere:
                    true
            };
        }


        const candidates =

            collectActiveButtons()

                .map(
                    row => ({
                        ...row,

                        score:
                            scoreGoWorld(
                                row
                            )
                    })
                )

                .filter(
                    row =>
                        row.score >=
                        80
                )

                .sort(
                    (a, b) =>
                        b.score -
                        a.score
                );


        if (
            !candidates.length
        ) {

            return {

                ok: false,

                reason:
                    'WORLD 이동 버튼을 찾지 못함'
            };
        }


        const target =
            candidates[0];


        const click =
            triggerButton(
                target.node
            );


        if (
            !click.ok
        ) {

            return {

                ok: false,

                click,

                target
            };
        }


        const verified =
            await waitForState(
                STATE.WORLD,
                {
                    timeout:
                        options.timeout ??
                        12000
                }
            );


        return {

            ok:
                verified.ok,

            click,

            target: {

                node:
                    target.node.name,

                path:
                    target.path,

                score:
                    target.score
            },

            verified
        };
    }


    /* ============================================================
     * WORLD -> BASE
     * ============================================================ */

    async function worldToBase(
        options = {}
    ) {

        if (
            detect().state ===
            STATE.BASE
        ) {

            return {

                ok: true,

                alreadyThere:
                    true
            };
        }


        const candidates =

            collectActiveButtons()

                .map(
                    row => ({
                        ...row,

                        score:
                            scoreGoBase(
                                row
                            )
                    })
                )

                .filter(
                    row =>
                        row.score >=
                        80
                )

                .sort(
                    (a, b) =>
                        b.score -
                        a.score
                );


        if (
            !candidates.length
        ) {

            return {

                ok: false,

                reason:
                    'BASE 복귀 버튼을 찾지 못함'
            };
        }


        const target =
            candidates[0];


        const click =
            triggerButton(
                target.node
            );


        if (
            !click.ok
        ) {

            return {

                ok: false,

                click,

                target
            };
        }


        const verified =
            await waitForState(
                STATE.BASE,
                {
                    timeout:
                        options.timeout ??
                        12000
                }
            );


        return {

            ok:
                verified.ok,

            click,

            target: {

                node:
                    target.node.name,

                path:
                    target.path,

                score:
                    target.score
            },

            verified
        };
    }


    /* ============================================================
     * WORLD -> WORLD_MINIMAP
     * ============================================================ */

    async function worldToWorldMinimap(
        options = {}
    ) {

        const current =
            detect();


        if (
            current.state ===
            STATE.WORLD_MINIMAP
        ) {

            return {

                ok: true,

                alreadyThere:
                    true
            };
        }


        const minimapButton =
            findDirectPath(
                PATH.MINIMAP
            );


        if (
            !minimapButton ||
            !isActive(
                minimapButton
            )
        ) {

            return {

                ok: false,

                reason:
                    'MinimapBtn을 찾지 못함'
            };
        }


        const click =
            triggerButton(
                minimapButton
            );


        if (
            !click.ok
        ) {

            return {

                ok: false,

                click
            };
        }


        const verified =
            await waitForState(
                STATE.WORLD_MINIMAP,
                {
                    timeout:
                        options.timeout ??
                        7000
                }
            );


        return {

            ok:
                verified.ok,

            click,

            verified
        };
    }


    /* ============================================================
     * WORLD_MINIMAP -> WORLD_MAP
     * ============================================================ */

    async function worldMinimapToWorldMap(
        options = {}
    ) {

        const current =
            detect();


        if (
            current.state ===
            STATE.WORLD_MAP
        ) {

            return {

                ok: true,

                alreadyThere:
                    true
            };
        }


        if (
            current.state !==
            STATE.WORLD_MINIMAP
        ) {

            return {

                ok: false,

                reason:
                    '현재 상태가 WORLD_MINIMAP이 아님',

                current
            };
        }


        const button =
            findDirectPath(
                PATH.WORLD_MAP
            );


        if (
            !button ||
            !isActive(
                button
            )
        ) {

            return {

                ok: false,

                reason:
                    'worldmapBtn을 찾지 못함'
            };
        }


        const click =
            triggerButton(
                button
            );


        if (
            !click.ok
        ) {

            return {

                ok: false,

                click
            };
        }


        const verified =
            await waitForState(
                STATE.WORLD_MAP,
                {
                    timeout:
                        options.timeout ??
                        10000
                }
            );


        return {

            ok:
                verified.ok,

            click,

            verified
        };
    }


    /* ============================================================
     * WORLD -> WORLD_MAP
     * ============================================================ */

    async function worldToWorldMap(
        options = {}
    ) {

        let current =
            detect();


        if (
            current.state ===
            STATE.WORLD_MAP
        ) {

            return {

                ok: true,

                alreadyThere:
                    true
            };
        }


        if (
            current.state ===
            STATE.WORLD
        ) {

            const step1 =
                await worldToWorldMinimap(
                    options
                );


            if (
                !step1.ok
            ) {

                return {

                    ok: false,

                    stage:
                        'WORLD_TO_WORLD_MINIMAP',

                    detail:
                        step1
                };
            }
        }


        current =
            detect();


        if (
            current.state ===
            STATE.WORLD_MINIMAP
        ) {

            const step2 =
                await worldMinimapToWorldMap(
                    options
                );


            return step2;
        }


        return {

            ok: false,

            reason:
                'WORLD_MAP 이동 실패',

            current:
                detect()
        };
    }


    /* ============================================================
     * 뒤로가기 후보 찾기
     * ============================================================ */

    function findBackCandidates(
        root,
        options = {}
    ) {

        if (!root)
            return [];


        const candidates =
            [];


        walk(
            root,
            node => {

                if (
                    !isActive(node)
                )
                    return;


                let button =
                    null;


                try {

                    button =
                        node.getComponent?.(
                            cc.Button
                        );

                } catch {}


                if (!button)
                    return;


                const handlers =
                    [];


                for (
                    const event
                    of button.clickEvents || []
                ) {

                    handlers.push({

                        event,

                        component:
                            String(
                                event?.component ||
                                ''
                            ),

                        handler:
                            String(
                                event?.handler ||
                                ''
                            ),

                        targetName:
                            String(
                                event
                                    ?.target
                                    ?.name ||
                                ''
                            )
                    });
                }


                const text =

                    [
                        node.name,
                        nodePath(node),

                        ...handlers.map(
                            h =>
                                `${h.component} ${h.handler} ${h.targetName}`
                        )
                    ]

                        .join(' ')

                        .replace(
                            /[^a-zA-Z0-9가-힣]/g,
                            ''
                        )

                        .toLowerCase();


                let score = 0;


                if (
                    text.includes(
                        'btnback'
                    )
                )
                    score += 10000;


                if (
                    text.includes(
                        'backbtn'
                    )
                )
                    score += 9500;


                if (
                    text.includes(
                        'onclickback'
                    )
                )
                    score += 9000;


                if (
                    text.includes(
                        'onbtnback'
                    )
                )
                    score += 9000;


                if (
                    text.includes(
                        'onback'
                    )
                )
                    score += 8500;


                if (
                    text.includes(
                        'back'
                    )
                )
                    score += 7000;


                if (
                    text.includes(
                        'btnclose'
                    )
                )
                    score += 8000;


                if (
                    text.includes(
                        'closebtn'
                    )
                )
                    score += 7500;


                if (
                    text.includes(
                        'onclickclose'
                    )
                )
                    score += 7300;


                if (
                    text.includes(
                        'onbtnclose'
                    )
                )
                    score += 7300;


                if (
                    text.includes(
                        'onclose'
                    )
                )
                    score += 7000;


                if (
                    text.includes(
                        'close'
                    )
                )
                    score += 5000;


                if (
                    text.includes(
                        'return'
                    )
                )
                    score += 4500;


                /*
                 * 제외
                 */

                if (
                    text.includes(
                        'worldmapbtn'
                    )
                )
                    score -= 30000;


                if (
                    text.includes(
                        'btnsevermap'
                    )
                )
                    score -= 30000;


                if (
                    text.includes(
                        'servermap'
                    )
                )
                    score -= 20000;


                if (
                    text.includes(
                        'transfer'
                    )
                )
                    score -= 10000;


                if (
                    text.includes(
                        'rank'
                    )
                )
                    score -= 8000;


                if (
                    score > 0
                ) {

                    candidates.push({

                        node,

                        button,

                        handlers,

                        score,

                        path:
                            nodePath(node),

                        text
                    });
                }
            }
        );


        candidates.sort(
            (a, b) =>
                b.score -
                a.score
        );


        return candidates;
    }


    /* ============================================================
     * WORLD_MAP -> WORLD_MINIMAP
     * ============================================================ */

    async function worldMapToWorldMinimap(
        options = {}
    ) {

        let current =
            detect();


        if (
            current.state ===
            STATE.WORLD_MINIMAP
        ) {

            return {

                ok: true,

                alreadyThere:
                    true
            };
        }


        if (
            current.state !==
            STATE.WORLD_MAP
        ) {

            return {

                ok: false,

                reason:
                    '현재 WORLD_MAP 상태가 아님',

                current
            };
        }


        const panel =
            findComponent(
                'WorldServerListPanel',
                true
            );


        const panelNode =

            panel?.node

            ||

            findNodeByName(
                'WorldServerListPanel',
                true
            );


        if (!panelNode) {

            return {

                ok: false,

                reason:
                    'WorldServerListPanel 없음'
            };
        }


        /*
         * 버튼 우선
         */

        const candidates =
            findBackCandidates(
                panelNode
            );


        console.table(
            candidates.map(
                (row, index) => ({

                    index,

                    score:
                        row.score,

                    node:
                        row.node.name,

                    path:
                        row.path,

                    handlers:
                        row.handlers
                            .map(
                                h =>
                                    `${h.component}.${h.handler}`
                            )
                            .join(' | ')
                })
            )
        );


        for (
            const candidate
            of candidates
        ) {

            const click =
                triggerButton(
                    candidate.node
                );


            if (
                !click.ok
            )
                continue;


            await sleep(
                350
            );


            current =
                detect();


            if (
                current.state ===
                STATE.WORLD_MINIMAP
            ) {

                return {

                    ok: true,

                    method:
                        'button',

                    target: {

                        node:
                            candidate.node.name,

                        path:
                            candidate.path,

                        score:
                            candidate.score
                    },

                    detected:
                        current
                };
            }


            if (
                current.state ===
                STATE.WORLD
            ) {

                return {

                    ok: true,

                    directWorld:
                        true,

                    method:
                        'button',

                    detected:
                        current
                };
            }
        }


        /*
         * component method fallback
         */

        if (panel) {

            const preferred = [

                'onClickBack',
                'onBtnBack',
                'onBack',
                'back',

                'onClickClose',
                'onBtnClose',
                'onClose',
                'close',

                'closePanel',
                'hide'
            ];


            for (
                const methodName
                of preferred
            ) {

                if (
                    typeof panel[
                        methodName
                    ] !==
                    'function'
                )
                    continue;


                try {

                    panel[
                        methodName
                    ]();


                    await sleep(
                        350
                    );


                    current =
                        detect();


                    if (
                        current.state ===
                        STATE.WORLD_MINIMAP
                    ) {

                        return {

                            ok: true,

                            method:
                                `component.${methodName}`,

                            detected:
                                current
                        };
                    }


                    if (
                        current.state ===
                        STATE.WORLD
                    ) {

                        return {

                            ok: true,

                            directWorld:
                                true,

                            method:
                                `component.${methodName}`,

                            detected:
                                current
                        };
                    }

                } catch (
                    error
                ) {

                    console.warn(
                        `[NAV] ${methodName} 실패`,
                        error
                    );
                }
            }
        }


        return {

            ok: false,

            reason:
                'WORLD_MAP 뒤로가기 실패',

            current:
                detect()
        };
    }


    /* ============================================================
     * WORLD_MINIMAP -> WORLD
     * ============================================================ */

    async function worldMinimapToWorld(
        options = {}
    ) {

        let current =
            detect();


        if (
            current.state ===
            STATE.WORLD
        ) {

            return {

                ok: true,

                alreadyThere:
                    true
            };
        }


        if (
            current.state !==
            STATE.WORLD_MINIMAP
        ) {

            return {

                ok: false,

                reason:
                    '현재 WORLD_MINIMAP 상태가 아님',

                current
            };
        }


        const minimapRoot =

            findNodeByName(
                'NWorldMinimap3D',
                true
            )

            ||

            findDirectPath(
                'NWorldMap/UICanvas/PopLayer/UIFrameNone/CONTENT/NWorldMinimap3D'
            );


        if (!minimapRoot) {

            return {

                ok: false,

                reason:
                    'NWorldMinimap3D 찾지 못함'
            };
        }


        const candidates =
            findBackCandidates(
                minimapRoot
            );


        console.table(
            candidates.map(
                (row, index) => ({

                    index,

                    score:
                        row.score,

                    node:
                        row.node.name,

                    path:
                        row.path,

                    handlers:
                        row.handlers
                            .map(
                                h =>
                                    `${h.component}.${h.handler}`
                            )
                            .join(' | ')
                })
            )
        );


        for (
            const candidate
            of candidates
        ) {

            const click =
                triggerButton(
                    candidate.node
                );


            if (
                !click.ok
            )
                continue;


            const verified =
                await waitForState(
                    STATE.WORLD,
                    {
                        timeout:
                            options.timeout ??
                            5000,

                        stable:
                            2
                    }
                );


            if (
                verified.ok
            ) {

                return {

                    ok: true,

                    target: {

                        node:
                            candidate.node.name,

                        path:
                            candidate.path,

                        score:
                            candidate.score
                    },

                    click,

                    verified
                };
            }
        }


        /*
         * 상위 PopLayer/UIFrame close 버튼까지 확인
         */

        let parent =
            minimapRoot.parent;


        for (
            let depth = 0;
            depth < 5 &&
            parent;
            depth++
        ) {

            const parentCandidates =
                findBackCandidates(
                    parent
                );


            for (
                const candidate
                of parentCandidates
            ) {

                /*
                 * worldmapBtn 제외
                 */

                if (
                    candidate.node.name ===
                    'worldmapBtn'
                )
                    continue;


                const click =
                    triggerButton(
                        candidate.node
                    );


                if (
                    !click.ok
                )
                    continue;


                const verified =
                    await waitForState(
                        STATE.WORLD,
                        {
                            timeout:
                                3000,

                            stable:
                                2
                        }
                    );


                if (
                    verified.ok
                ) {

                    return {

                        ok: true,

                        method:
                            'parent-close',

                        target: {

                            node:
                                candidate.node.name,

                            path:
                                candidate.path,

                            score:
                                candidate.score
                        },

                        verified
                    };
                }
            }


            parent =
                parent.parent;
        }


        return {

            ok: false,

            reason:
                'WORLD_MINIMAP 뒤로가기 실패',

            candidates:
                candidates
                    .slice(0, 15)
                    .map(
                        row => ({

                            node:
                                row.node.name,

                            path:
                                row.path,

                            score:
                                row.score,

                            handlers:
                                row.handlers
                                    .map(
                                        h =>
                                            `${h.component}.${h.handler}`
                                    )
                        })
                    )
        };
    }


    /* ============================================================
     * WORLD_MAP -> WORLD
     *
     * 뒤로 두 번
     * ============================================================ */

    async function worldMapToWorld(
        options = {}
    ) {

        let current =
            detect();


        if (
            current.state ===
            STATE.WORLD
        ) {

            return {

                ok: true,

                alreadyThere:
                    true
            };
        }


        /*
         * 1단계
         * WORLD_MAP -> WORLD_MINIMAP
         */

        if (
            current.state ===
            STATE.WORLD_MAP
        ) {

            const step1 =
                await worldMapToWorldMinimap(
                    options
                );


            if (
                !step1.ok
            ) {

                return {

                    ok: false,

                    stage:
                        'WORLD_MAP_TO_WORLD_MINIMAP',

                    detail:
                        step1
                };
            }


            current =
                detect();


            /*
             * 한번에 WORLD까지 빠진 경우
             */

            if (
                current.state ===
                STATE.WORLD
            ) {

                return {

                    ok: true,

                    direct:
                        true,

                    step1
                };
            }
        }


        /*
         * 2단계
         * WORLD_MINIMAP -> WORLD
         */

        if (
            current.state ===
            STATE.WORLD_MINIMAP
        ) {

            const step2 =
                await worldMinimapToWorld(
                    options
                );


            return {

                ok:
                    step2.ok,

                step2
            };
        }


        return {

            ok: false,

            reason:
                'WORLD_MAP → WORLD 전환 중 상태 이상',

            current:
                detect()
        };
    }


    /* ============================================================
     * goto
     * ============================================================ */

    async function goto(
        target,
        options = {}
    ) {

        target =
            String(
                target || ''
            ).toUpperCase();


        let current =
            detect();


        console.log(
            '[NAV]',
            current.state,
            '→',
            target
        );


        if (
            current.state ===
            target
        ) {

            return {

                ok: true,

                alreadyThere:
                    true,

                state:
                    target
            };
        }


        /* ========================================================
         * TARGET = WORLD_MAP
         * ======================================================== */

        if (
            target ===
            STATE.WORLD_MAP
        ) {

            /*
             * BASE -> WORLD
             */

            if (
                current.state ===
                STATE.BASE
            ) {

                const step =
                    await baseToWorld(
                        options
                    );


                if (
                    !step.ok
                ) {

                    return {

                        ok: false,

                        stage:
                            'BASE_TO_WORLD',

                        detail:
                            step
                    };
                }


                current =
                    detect();
            }


            /*
             * WORLD -> WORLD_MINIMAP
             */

            if (
                current.state ===
                STATE.WORLD
            ) {

                const step =
                    await worldToWorldMinimap(
                        options
                    );


                if (
                    !step.ok
                ) {

                    return {

                        ok: false,

                        stage:
                            'WORLD_TO_WORLD_MINIMAP',

                        detail:
                            step
                    };
                }


                current =
                    detect();
            }


            /*
             * WORLD_MINIMAP -> WORLD_MAP
             */

            if (
                current.state ===
                STATE.WORLD_MINIMAP
            ) {

                return await worldMinimapToWorldMap(
                    options
                );
            }
        }


        /* ========================================================
         * TARGET = WORLD
         * ======================================================== */

        if (
            target ===
            STATE.WORLD
        ) {

            /*
             * BASE -> WORLD
             */

            if (
                current.state ===
                STATE.BASE
            ) {

                return await baseToWorld(
                    options
                );
            }


            /*
             * WORLD_MINIMAP -> WORLD
             */

            if (
                current.state ===
                STATE.WORLD_MINIMAP
            ) {

                return await worldMinimapToWorld(
                    options
                );
            }


            /*
             * WORLD_MAP -> WORLD_MINIMAP -> WORLD
             */

            if (
                current.state ===
                STATE.WORLD_MAP
            ) {

                return await worldMapToWorld(
                    options
                );
            }
        }


        /* ========================================================
         * TARGET = BASE
         * ======================================================== */

        if (
            target ===
            STATE.BASE
        ) {

            /*
             * WORLD_MAP -> WORLD
             */

            if (
                current.state ===
                STATE.WORLD_MAP
            ) {

                const step =
                    await worldMapToWorld(
                        options
                    );


                if (
                    !step.ok
                ) {

                    return {

                        ok: false,

                        stage:
                            'WORLD_MAP_TO_WORLD',

                        detail:
                            step
                    };
                }


                current =
                    detect();
            }


            /*
             * WORLD_MINIMAP -> WORLD
             */

            if (
                current.state ===
                STATE.WORLD_MINIMAP
            ) {

                const step =
                    await worldMinimapToWorld(
                        options
                    );


                if (
                    !step.ok
                ) {

                    return {

                        ok: false,

                        stage:
                            'WORLD_MINIMAP_TO_WORLD',

                        detail:
                            step
                    };
                }


                current =
                    detect();
            }


            /*
             * WORLD -> BASE
             */

            if (
                current.state ===
                STATE.WORLD
            ) {

                return await worldToBase(
                    options
                );
            }
        }


        return {

            ok: false,

            reason:
                '지원되지 않는 상태 전환',

            from:
                current.state,

            to:
                target,

            current
        };
    }


    /* ============================================================
     * 진단
     * ============================================================ */

    function diagnose() {

        const detected =
            detect();


        const signals =
            getSignals();


        const result = {

            version:
                VERSION,

            detected,

            signals:
                simplifySignals(
                    signals
                ),

            paths: {

                minimap: {

                    expected:
                        PATH.MINIMAP,

                    found:
                        !!signals.minimapButtonNode,

                    active:
                        signals.minimapButton,

                    actual:
                        signals.minimapButtonNode
                            ? nodePath(
                                signals.minimapButtonNode
                            )
                            : null
                },


                worldmap: {

                    expected:
                        PATH.WORLD_MAP,

                    found:
                        !!signals.worldmapButtonNode,

                    active:
                        signals.worldmapButton,

                    actual:
                        signals.worldmapButtonNode
                            ? nodePath(
                                signals.worldmapButtonNode
                            )
                            : null
                },


                minimapRoot: {

                    found:
                        !!signals.minimapRootNode,

                    active:
                        signals.minimapRoot,

                    actual:
                        signals.minimapRootNode
                            ? nodePath(
                                signals.minimapRootNode
                            )
                            : null
                },


                serverPanel: {

                    found:
                        !!signals.serverPanelNode,

                    active:
                        signals.serverPanel,

                    actual:
                        signals.serverPanelNode
                            ? nodePath(
                                signals.serverPanelNode
                            )
                            : null
                }
            }
        };


        console.log(
            '[TOPWAR_NAV diagnose]',
            result
        );


        console.table([

            {
                item:
                    'MinimapBtn',

                found:
                    result.paths
                        .minimap
                        .found,

                active:
                    result.paths
                        .minimap
                        .active,

                path:
                    result.paths
                        .minimap
                        .actual
            },

            {
                item:
                    'NWorldMinimap3D',

                found:
                    result.paths
                        .minimapRoot
                        .found,

                active:
                    result.paths
                        .minimapRoot
                        .active,

                path:
                    result.paths
                        .minimapRoot
                        .actual
            },

            {
                item:
                    'worldmapBtn',

                found:
                    result.paths
                        .worldmap
                        .found,

                active:
                    result.paths
                        .worldmap
                        .active,

                path:
                    result.paths
                        .worldmap
                        .actual
            },

            {
                item:
                    'WorldServerListPanel',

                found:
                    result.paths
                        .serverPanel
                        .found,

                active:
                    result.paths
                        .serverPanel
                        .active,

                path:
                    result.paths
                        .serverPanel
                        .actual
            }

        ]);


        return result;
    }


    /* ============================================================
     * CSS
     * ============================================================ */

    const style =
        document.createElement(
            'style'
        );


    installation.style = style;

    style.id =
        STYLE_ID;


    style.textContent = `

        #${UI_ID} {

            position:fixed;

            top:80px;
            right:20px;

            width:310px;

            z-index:2147483647;

            background:
                rgba(20,20,24,.96);

            color:#eee;

            border:
                1px solid #555;

            border-radius:10px;

            font-family:
                Arial,sans-serif;

            box-shadow:
                0 8px 30px
                rgba(0,0,0,.5);

            overflow:hidden;

            user-select:none;
        }


        #${UI_ID} .header {

            height:38px;

            display:flex;

            align-items:center;

            justify-content:
                space-between;

            padding:0 10px;

            background:#29292f;

            border-bottom:
                1px solid #444;

            cursor:move;
        }


        #${UI_ID} .title {

            font-size:13px;

            font-weight:bold;
        }


        #${UI_ID} .version {

            font-size:9px;

            color:#888;
        }


        #${UI_ID} .body {

            padding:10px;
        }


        #${UI_ID} .state-box {

            display:flex;

            align-items:center;

            justify-content:
                space-between;

            padding:10px;

            margin-bottom:9px;

            background:#151519;

            border:
                1px solid #3a3a40;

            border-radius:7px;
        }


        #${UI_ID} .small {

            font-size:10px;

            color:#888;
        }


        #${UI_ID} .state {

            margin-top:2px;

            font-size:16px;

            font-weight:bold;
        }


        #${UI_ID} .reason {

            margin-top:3px;

            max-width:240px;

            font-size:9px;

            color:#777;

            word-break:
                break-all;
        }


        #${UI_ID} .dot {

            width:15px;
            height:15px;

            border-radius:50%;

            background:#777;
        }


        #${UI_ID} .buttons {

            display:grid;

            grid-template-columns:
                1fr 1fr 1fr;

            gap:6px;
        }


        #${UI_ID} button {

            cursor:pointer;
        }


        #${UI_ID} .move {

            height:40px;

            background:#333;

            color:#eee;

            border:
                1px solid #555;

            border-radius:6px;

            font-size:11px;
        }


        #${UI_ID} .move.current {

            background:#234623;

            color:#9cff9c;

            border-color:#6cc96c;
        }


        #${UI_ID} .move:disabled {

            opacity:.4;
        }


        #${UI_ID} .tools {

            display:grid;

            grid-template-columns:
                1fr 1fr;

            gap:6px;

            margin-top:7px;
        }


        #${UI_ID} .tool {

            height:28px;

            background:#28282e;

            color:#aaa;

            border:
                1px solid #444;

            border-radius:5px;

            font-size:10px;
        }


        #${UI_ID} .collapse {

            width:25px;
            height:25px;

            border:0;

            border-radius:4px;

            background:#444;

            color:#ddd;
        }


        #${UI_ID}.collapsed .body {

            display:none;
        }


        #${UI_ID} .sale-progress-icon {

            width:15px;
            height:15px;

            box-sizing:border-box;

            border-radius:50%;

            display:inline-flex;

            align-items:center;
            justify-content:center;

            font-size:10px;
            font-weight:bold;

            flex:none;
        }


        #${UI_ID} .sale-progress-icon.waiting {

            border:2px solid #666;

            background:transparent;

            color:transparent;
        }


        #${UI_ID} .sale-progress-icon.running {

            border:2px solid #555;

            border-top-color:#ddd;

            background:transparent;

            animation:
                topwar-sale-spin
                .75s
                linear
                infinite;
        }


        #${UI_ID} .sale-progress-icon.done {

            border:2px solid #58a66a;

            background:#356b42;

            color:#fff;
        }


        #${UI_ID} .sale-progress-icon.error {

            border:2px solid #b96262;

            background:#793a3a;

            color:#fff;
        }


        @keyframes topwar-sale-spin {

            to {
                transform:
                    rotate(360deg);
            }
        }

    `;


    (document.head || document.documentElement).appendChild(
        style
    );


    /* ============================================================
     * UI
     * ============================================================ */

    const root =
        document.createElement(
            'div'
        );


    installation.root = root;

    root.id =
        UI_ID;


    root.innerHTML = `

        <div class="header">

            <div>

                <span class="title">
                    TopWar Navigator
                </span>

                <span class="version">
                    v${VERSION}
                </span>

            </div>


            <button
                class="collapse"
            >
                −
            </button>

        </div>


        <div class="body">

            <div class="state-box">

                <div>

                    <div class="small">
                        현재 위치
                    </div>

                    <div class="state">
                        -
                    </div>

                    <div class="reason">
                        -
                    </div>

                </div>


                <div class="dot">
                </div>

            </div>


            <div class="buttons">

                <button
                    class="move"
                    data-target="BASE"
                >
                    기지
                </button>

                <button
                    class="move"
                    data-target="WORLD"
                >
                    월드
                </button>

                <button
                    class="move"
                    data-target="WORLD_MAP"
                >
                    월드맵
                </button>

            </div>


            <div class="tools">

                <button
                    class="tool diagnose"
                >
                    진단
                </button>

                <button
                    class="tool signal"
                >
                    신호
                </button>

            </div>

        </div>
    `;


    (document.body || document.documentElement).appendChild(
        root
    );


    const stateElement =
        root.querySelector(
            '.state'
        );


    const reasonElement =
        root.querySelector(
            '.reason'
        );


    const dotElement =
        root.querySelector(
            '.dot'
        );


    const moveButtons =
        [
            ...root.querySelectorAll(
                '.move'
            )
        ];


    /*
     * 판매 정보 Collector UI에서는 직접 이동 버튼을 노출하지 않는다.
     * 버튼 DOM과 이벤트, moveButtons 참조는 그대로 유지하므로
     * 내부 자동 수집/이동 로직에서는 계속 사용할 수 있다.
     */
    const moveButtonContainer =
        root.querySelector(
            '.buttons'
        );

    if (
        moveButtonContainer
    ) {
        moveButtonContainer.hidden =
            true;

        moveButtonContainer.style.display =
            'none';
    }


    /* ============================================================
     * UI helper
     * ============================================================ */

    function stateColor(state) {

        switch (state) {

            case STATE.BASE:

                return '#42a5f5';


            case STATE.WORLD:

                return '#66bb6a';


            case STATE.WORLD_MINIMAP:

                return '#ab47bc';


            case STATE.WORLD_MAP:

                return '#ffa726';


            default:

                return '#888';
        }
    }


    function log(
        message,
        object
    ) {

        const entry = {
            time:
                Date.now(),

            message:
                String(
                    message ?? ''
                ),

            data:
                object
        };


        runtimeLogs.unshift(
            entry
        );


        if (
            runtimeLogs.length >
            MAX_RUNTIME_LOGS
        ) {

            runtimeLogs.length =
                MAX_RUNTIME_LOGS;
        }


        console.log(
            '[TOPWAR_NAV]',
            message,
            object ?? ''
        );


        return entry;
    }


    function refreshUnsafe() {

        const current =
            detect();


        stateElement.textContent =

            moving

                ? `${current.state} · 이동중`

                : current.state;


        reasonElement.textContent =
            current.reason;


        dotElement.style.background =
            stateColor(
                current.state
            );


        /*
         * WORLD_MINIMAP은
         * 월드 버튼을 현재상태 처리하지 않음.
         */

        for (
            const button
            of moveButtons
        ) {

            button.classList.toggle(

                'current',

                button.dataset.target ===
                current.state
            );
        }


        return current;
    }

    function recordError(stage, error) {
        const entry = { stage, message: error?.message || String(error), stack: error?.stack };
        runtimeErrors.push(entry);
        if (runtimeErrors.length > 30) runtimeErrors.shift();
        console.error('[TOPWAR_NAV] ' + stage, error);
        log(stage + ': ' + entry.message);
        return { ok: false, reason: entry.message, stage };
    }

    function refresh() {
        try { return refreshUnsafe(); }
        catch (error) {
            if (runtimeErrors.at(-1)?.message !== error.message) recordError('화면 감지', error);
            stateElement.textContent = 'ERROR';
            reasonElement.textContent = error.message;
            return { state: STATE.UNKNOWN, reason: error.message };
        }
    }



    /* ============================================================
     * 실시간 watcher
     * ============================================================ */

    function startWatcher() {

        if (watcher) {

            clearInterval(
                watcher
            );
        }


        lastState =
            refresh().state;


        watcher =
            setInterval(
                () => {

                    if (disposed) return;
                    if (!root.isConnected) (document.body || document.documentElement).appendChild(root);
                    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);

                    const current =
                        refresh();


                    if (
                        current.state !==
                        lastState
                    ) {

                        const previous =
                            lastState;


                        lastState =
                            current.state;


                        log(
                            `${previous} → ${current.state}`
                        );


                        window.dispatchEvent(

                            new CustomEvent(
                                'topwar:navigation-state-change',
                                {

                                    detail: {

                                        previous,

                                        current:
                                            current.state,

                                        detected:
                                            current,

                                        time:
                                            Date.now()
                                    }
                                }
                            )
                        );
                    }

                },

                WATCH_INTERVAL
            );
    }


    /* ============================================================
     * UI 이동
     * ============================================================ */

    async function move(target) {

        if (moving)
            return;


        moving =
            true;


        for (
            const button
            of moveButtons
        ) {

            button.disabled =
                true;
        }


        try {

            const before =
                detect();


            log(
                `${before.state} → ${target}`
            );


            const result =
                await goto(
                    target
                );


            log(

                result.ok
                    ? `${target} 이동 성공`
                    : `${target} 이동 실패`,

                result
            );


            return result;

        } catch (
            error
        ) {

            const result = {

                ok:
                    false,

                error:
                    error?.message ||
                    String(error)
            };


            log(
                '이동 오류',
                result
            );


            return result;

        } finally {

            moving =
                false;


            for (
                const button
                of moveButtons
            ) {

                button.disabled =
                    false;
            }


            refresh();
        }
    }


    /* ============================================================
     * UI Event
     * ============================================================ */

    for (
        const button
        of moveButtons
    ) {

        button.addEventListener(

            'click',

            () =>

                move(
                    button.dataset.target
                )
        );
    }


    root
        .querySelector(
            '.diagnose'
        )
        .addEventListener(
            'click',
            () => {

                const result =
                    diagnose();


                log(
                    '진단',
                    result
                );
            }
        );


    root
        .querySelector(
            '.signal'
        )
        .addEventListener(
            'click',
            () => {

                const result =
                    getSignals();


                console.log(
                    '[TOPWAR_NAV signals]',
                    result
                );


                console.table([

                    {
                        signal:
                            'MinimapBtn',

                        active:
                            result.minimapButton
                    },

                    {
                        signal:
                            'NWorldMinimap3D',

                        active:
                            result.minimapRoot
                    },

                    {
                        signal:
                            'worldmapBtn',

                        active:
                            result.worldmapButton
                    },

                    {
                        signal:
                            'WorldServerListPanel',

                        active:
                            result.serverPanel
                    },

                    {
                        signal:
                            'NWorldMap',

                        active:
                            result.nWorldMap
                    }

                ]);


                log(
                    '신호 확인',
                    simplifySignals(
                        result
                    )
                );
            }
        );


    root
        .querySelector(
            '.collapse'
        )
        .addEventListener(
            'click',
            event => {

                root.classList.toggle(
                    'collapsed'
                );


                event.target.textContent =

                    root.classList.contains(
                        'collapsed'
                    )

                        ? '+'

                        : '−';
            }
        );


    /* ============================================================
     * Drag
     * ============================================================ */

    const header =
        root.querySelector(
            '.header'
        );


    let dragging =
        false;


    let offsetX =
        0;


    let offsetY =
        0;


    header.addEventListener(
        'mousedown',
        event => {

            if (
                event.target.closest(
                    'button'
                )
            )
                return;


            dragging =
                true;


            const rect =
                root
                    .getBoundingClientRect();


            offsetX =
                event.clientX -
                rect.left;


            offsetY =
                event.clientY -
                rect.top;
        }
    );


    document.addEventListener(
        'mousemove',
        event => {

            if (
                !dragging
            )
                return;


            root.style.left =
                `${event.clientX - offsetX}px`;


            root.style.top =
                `${event.clientY - offsetY}px`;


            root.style.right =
                'auto';
        },
        { signal: uiEvents.signal }
    );


    document.addEventListener(
        'mouseup',
        () => {

            dragging =
                false;
        },
        { signal: uiEvents.signal }
    );


    /* ============================================================
     * Destroy
     * ============================================================ */

    function destroy() {
        disposed = true;
        try { stopGameMacro(); } catch {}
        try { stopGameRecorder({discard:true}); } catch {}
        uiEvents.abort();

        if (watcher) {

            clearInterval(
                watcher
            );


            watcher =
                null;
        }


        root.remove();


        style.remove();


        if (
            window.TOPWAR_NAV ===
            api
        ) {

            delete window.TOPWAR_NAV;
        }
    }


    /* ============================================================
     * Public API
     * ============================================================ */


    // Profile integration; all app/module version labels use the single VERSION value.
    const profileModule = (() => {

    /* ============================================================
     * TOPWAR_PROFILE
     *
     * TOPWAR_NAV 위에 억지로 함수를 추가하지 않고
     * 별도 모듈로 사용한다.
     *
     * 실행:
     *
     *   const data = await TOPWAR_PROFILE.collectAll();
     *
     * 결과:
     *
     *   window.TOPWAR_PROFILE_DATA
     *
     * ============================================================ */


    const VERSION = '0.9.3';


    const TAB_ORDER = [
        'toggle1',   // 기지 외관
        'toggle3',   // 대열 외관
        'toggle4',   // 기지 효과
        'toggle5',   // 이동 효과
        'toggle6',   // 행군 참여
        'toggle7',   // 수호 효과
        'toggle8',   // 영광의 장식
        'toggle10'   // 기지 오라
    ];


    const TAB_ORDER_MAP =
        new Map(
            TAB_ORDER.map(
                (name, index) => [
                    name,
                    index
                ]
            )
        );


    /* ============================================================
     * BASIC
     * ============================================================ */


    function sleep(ms) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );
    }


    function isActive(node) {

        return !!node &&
            node.active !== false &&
            node.activeInHierarchy !== false;
    }


    function nodePath(node) {

        const arr = [];

        let cur =
            node;


        while (cur) {

            arr.unshift(
                cur.name || '?'
            );

            cur =
                cur.parent;
        }


        return arr.join('/');
    }


    function walk(
        root,
        callback,
        options = {}
    ) {

        if (!root)
            return;


        const includeInactive =
            !!options.includeInactive;


        const stack =
            [root];


        while (stack.length) {

            const node =
                stack.pop();


            if (!node)
                continue;


            if (
                !includeInactive &&
                !isActive(node)
            ) {
                continue;
            }


            callback(node);


            const children =
                node.children || [];


            for (
                let i =
                    children.length - 1;

                i >= 0;

                i--
            ) {

                stack.push(
                    children[i]
                );
            }
        }
    }


    function findChildPath(
        root,
        path
    ) {

        const parts =
            String(path)
                .split('/')
                .filter(Boolean);


        let cur =
            root;


        for (
            const part
            of parts
        ) {

            if (!cur)
                return null;


            cur =
                cur.getChildByName?.(
                    part
                ) ||
                (cur.children || [])
                    .find(
                        child =>
                            child.name ===
                            part
                    ) ||
                null;
        }


        return cur;
    }


    /* ============================================================
     * TEXT
     * ============================================================ */


    function collectTexts(node) {

        const values =
            [];


        walk(
            node,
            cur => {

                try {

                    const label =
                        cur.getComponent?.(
                            cc.Label
                        );


                    const text =
                        String(
                            label?.string ??
                            ''
                        ).trim();


                    if (text) {

                        values.push(
                            text
                        );
                    }

                } catch {}


                try {

                    const rich =
                        cur.getComponent?.(
                            cc.RichText
                        );


                    const text =
                        String(
                            rich?.string ??
                            ''
                        ).trim();


                    if (text) {

                        values.push(
                            text
                        );
                    }

                } catch {}

            },
            {
                includeInactive:
                    true
            }
        );


        return [
            ...new Set(values)
        ];
    }


    function getText(node) {

        return collectTexts(node)
            .join(' / ');
    }


    /* ============================================================
     * SPRITES
     * ============================================================ */


    


    /* ============================================================
     * BUTTON HANDLERS
     * ============================================================ */


    function getButtonHandlers(node) {

        let button =
            null;


        try {

            button =
                node.getComponent?.(
                    cc.Button
                );

        } catch {}


        if (!button) {

            return [];
        }


        return (
            button.clickEvents || []
        ).map(
            event => ({

                component:
                    String(
                        event?.component ||
                        event?._componentName ||
                        ''
                    ),

                handler:
                    String(
                        event?.handler ||
                        event?._handler ||
                        ''
                    ),

                customEventData:
                    event?.customEventData ??
                    event?._customEventData ??
                    ''
            })
        );
    }


    function isSkinItemNode(node) {
        const selected = collectToggles().find(tab => tab.toggle.isChecked)?.name;
        const events = {
            toggle1: ['towerDetailNode', 'itemClickCallBack'],
            toggle3: ['armyLineSkinNode', 'itemClickCallBack'],
            toggle4: ['CityEffectCellNode', 'onSelectClick'],
            toggle5: ['TransportEffectNode', 'onItemClick'],
            toggle6: ['SkinBaseItem', 'onItemClick'],
            toggle7: ['SkinBaseItem', 'onItemClick'],
            toggle8: ['ZSWEnigmaNode', 'onItemClick'],
            toggle10: ['CastleHaloItem', 'itemClick']
        };
        const expected = events[selected];
        return !!expected && getButtonHandlers(node).some(event => event.component === expected[0] && event.handler === expected[1]);
    }


    /* ============================================================
     * COMPONENT STATE INSPECTION
     *
     * 보유 상태와 관련된 실제 필드가 존재하면 읽는다.
     * ============================================================ */


    function detectOwnership(itemNode) {
        const evidence = [];
        walk(itemNode, node => {
            if (node.name === 'notHaveNode') evidence.push({ name: node.name, path: nodePath(node), active: node.active });
        }, { includeInactive: true });
        const allTrue = evidence.length && evidence.every(row => row.active === true);
        const allFalse = evidence.length && evidence.every(row => row.active === false);
        return { owned: allTrue ? false : allFalse ? true : null,
            confidence: allTrue || allFalse ? 'HIGH' : 'UNKNOWN',
            reason: allTrue ? 'notHaveNode 활성' : allFalse ? 'notHaveNode 비활성' : '확정 근거 없음 또는 충돌', evidence };
    }


    /* ============================================================
     * PROFILE
     * ============================================================ */


    function findProfileRoot() {
        // Use the proven NAV traversal. The profile walker prunes inactive ancestors
        // and can miss a live panel below a scene/container traversal boundary.
        return findNodeByName('UserInfoMainPanel', true);
    }


    /* ============================================================
     * TOGGLES
     * ============================================================ */


    function collectToggles() {

        const root =
            findProfileRoot();


        if (!root) {

            return [];
        }


        const result =
            [];


        walk(
            root,
            node => {

                let toggle =
                    null;


                try {

                    toggle =
                        node.getComponent?.(
                            cc.Toggle
                        );

                } catch {}


                if (!toggle)
                    return;


                /*
                 * 현재 우리가 확인한
                 * towerNode ToggleContainer만
                 */
                const path =
                    nodePath(node);


                if (
                    !path.includes(
                        '/towerNode/toggleNode/'
                    )
                ) {
                    return;
                }


                result.push({

                    node,

                    toggle,

                    name:
                        node.name,

                    text:
                        getText(node) || {"toggle1":"기지 외관","toggle3":"대열 외관","toggle4":"기지 효과","toggle5":"이동 효과","toggle6":"행군 참여","toggle7":"수호 효과","toggle8":"영광의 장식","toggle10":"기지 오라"}[node.name],

                    active:
                        isActive(node),

                    checked:
                        !!toggle.isChecked,

                    path
                });

            },
            {
                includeInactive:
                    true
            }
        );


        return result
            .filter(
                row =>
                    row.active
                    &&
                    row.text
                    &&
                    TAB_ORDER_MAP.has(
                        row.name
                    )
            )
            .sort(
                (a, b) =>
                    TAB_ORDER_MAP.get(
                        a.name
                    )
                    -
                    TAB_ORDER_MAP.get(
                        b.name
                    )
            );
    }


    /* ============================================================
     * CONTENT
     * ============================================================ */


    function findTowerNode() {

        const root =
            findProfileRoot();


        if (!root)
            return null;


        return findChildPath(
            root,
            'contentNode/towerNode'
        );
    }


    function findContentRoot() {
    const tower = findTowerNode();
    if (!tower) return null;
    const selected = collectToggles().filter(tab => tab.toggle.isChecked);
    if (selected.length !== 1) return null;
    // Confirmed by the user's 2026-09-14 runtime diagnostics, not guessed names.
    const paths = {
        toggle1: 'skinNode',
        toggle3: 'armyparentNode/armyLineSkinNode',
        toggle4: 'headFrameNode/CityEffectNode',
        toggle5: 'transportParentNode/TransportEffectNode',
        toggle6: 'marchEnigmaParent/MarchEnigmaNode',
        toggle7: 'castleEnigmaParent/CastleEnigmaNode',
        toggle8: 'zswEnigmaParent/ZSWEnigmaNode',
        toggle10: 'castleHaloParent/CastleHaloNode'
    };
    const prefix = paths[selected[0].name];
    const content = prefix && findChildPath(tower, prefix + '/allTowerNode/view/content');
    return content && isActive(content) ? content : null;
}


    /* ============================================================
     * DATA STABILITY
     * ============================================================ */


    function contentSignature() {
        const content = findContentRoot();
        if (!content) return '';
        const items = collectCurrentItems();
        // Animated labels and sprite frames do not determine list readiness.
        // Item identity and explicit ownership markers must settle instead.
        return items.length ? JSON.stringify(items.map(item => ({
            id: item.id, key: item.key, path: item.path, owned: item.owned
        })).sort((a, b) => a.key.localeCompare(b.key))) : '';
    }


    async function waitForContentStable(options = {}) {
    const timeout = Number(options.timeout ?? 20000);
    const interval = Number(options.interval ?? 150);
    const settle = Number(options.settleMs ?? 1000);
    if (![timeout, interval, settle].every(Number.isFinite) || timeout <= 0 || interval <= 0 || settle < 0) {
        throw new Error('timeout/interval은 양수, settleMs는 0 이상의 유한한 숫자여야 합니다');
    }
    const panel = findProfileRoot();
    const tab = collectToggles().find(row => row.toggle.isChecked)?.name;
    const started = Date.now();
    let previous = '', lastChange = started, changes = 0, lastCount = 0;
    while (Date.now() - started < timeout) {
        if (
            disposed ||
            !findProfileRoot() ||
            collectToggles()
                .find(
                    row =>
                        row.toggle.isChecked
                )
                ?.name !== tab
        ) {
            throw new Error('수집 중 프로필이 닫히거나 선택 탭이 변경됨');
        }
        const signature = contentSignature();
        if (signature !== previous) { previous = signature; lastChange = Date.now(); changes++; }
        if (signature) {
            lastCount = JSON.parse(signature).length;
            if (Date.now() - lastChange >= settle) return {
                ok: true, signature, elapsedMs: Date.now() - started, changes, itemCount: lastCount
            };
        }
        await sleep(interval);
    }
    return { ok: false, signature: previous, elapsedMs: Date.now() - started, changes,
        itemCount: lastCount, reason: previous ? '제한 시간 내 목록 안정화 미완료' : '선택 탭의 아이템 미확인' };
}


    /* ============================================================
     * ITEM COLLECTION
     * ============================================================ */


    function itemKey(node) {
        const parts = [];
        for (let current = node; current; current = current.parent) {
            parts.unshift(current.name + '[' + (current.parent?.children || []).indexOf(current) + ']');
        }
        return parts.join('/');
    }

    function collectCurrentItems() {

        const content =
            findContentRoot();


        const tower =
            findTowerNode();


        if (!tower) {

            return [];
        }


        const nodes =
            [];


        /*
         * 가장 정확한 방법:
         * allTowerNode/view/content의 직계 아이템
         */
        if (content) {

            for (
                const child
                of content.children || []
            ) {

                if (
                    !isActive(child)
                ) {
                    continue;
                }


                if (
                    isSkinItemNode(
                        child
                    )
                ) {

                    nodes.push(
                        child
                    );
                }
            }
        }


        /*
         * fallback:
         * towerNode 전체에서 itemClickCallBack 탐색
         */
        if (
            !nodes.length
        ) {

            walk(
                content,
                node => {

                    if (
                        isSkinItemNode(
                            node
                        )
                    ) {

                        nodes.push(
                            node
                        );
                    }
                }
            );
        }


        const seen =
            new Set();


        return nodes
            .filter(
                node => {

                    if (
                        seen.has(node)
                    ) {
                        return false;
                    }


                    seen.add(node);

                    return true;
                }
            )
            .map(
                node => {

                    const ownership =
                        detectOwnership(
                            node
                        );


                    const texts =
                        collectTexts(
                            node
                        );


                    return {

                        id:
                            String(
                                node.name ||
                                ''
                            ),

                        name:
                            texts[0] ||
                            null,

                        texts,

                        owned:
                            ownership.owned,

                        ownership: {

                            confidence:
                                ownership
                                    .confidence,

                            reason:
                                ownership
                                    .reason,

                            evidence:
                                ownership
                                    .evidence
                        },

                        path:
                            nodePath(node),
                        key: itemKey(node)
                    };
                }
            );
    }


    /* ============================================================
     * TAB LOAD
     * ============================================================ */


    async function loadTab(tab, options = {}) {
        if (disposed) throw new Error('Navigator 종료됨');
        const panel = findProfileRoot();
        const beforeContent = findContentRoot();
        const beforeSignature = contentSignature();
        const wasChecked = !!tab.toggle.isChecked;
        if (typeof tab.toggle.check !== 'function') throw new Error(tab.name + ': toggle.check 없음');
        tab.toggle.check();
        await sleep(Number(options.delay ?? 700));
        if (
            disposed ||
            !findProfileRoot() ||
            collectToggles()
                .find(
                    row =>
                        row.toggle.isChecked
                )
                ?.name !== tab.name
        ) {
            throw new Error('프로필이 닫히거나 선택 탭이 변경됨');
        }
        const stable = await waitForContentStable(options);
        const afterSignature = contentSignature();
        const changed = wasChecked || beforeContent !== findContentRoot() || beforeSignature !== afterSignature;
        return {
            ok:
                stable.ok &&
                changed &&
                !disposed &&
                !!findProfileRoot() &&
                collectToggles()
                    .find(
                        row =>
                            row.toggle.isChecked
                    )
                    ?.name === tab.name,
            tab:
                tab.text,
            toggle:
                tab.name,
            beforeSignature,
            afterSignature,
            stable
        };
    }


    /* ============================================================
     * SINGLE TAB
     * ============================================================ */


function inspectCurrentProfileItems() {
    const panel = findProfileRoot();
    const tower = findTowerNode();
    const content = findContentRoot();
    const describe = node => node ? {
        name: node.name, path: nodePath(node), active: node.active,
        activeInHierarchy: node.activeInHierarchy, children: node.children?.length || 0
    } : null;
    const candidates = [];
    const itemButtons = [];
    walk(panel, node => {
        if (node.name === 'content' && /\/allTowerNode\/view\/content$/.test(nodePath(node))) candidates.push(describe(node));
    }, { includeInactive: true });
    walk(content, node => {
        const handlers = getButtonHandlers(node);
        if (handlers.length && itemButtons.length < 20) itemButtons.push({
            ...describe(node), matches: isSkinItemNode(node), handlers
        });
    }, { includeInactive: true });
    return {
        panel: describe(panel), tower: describe(tower), content: describe(content),
        selectedTabs: collectToggles().filter(tab => tab.toggle.isChecked).map(tab => tab.name),
        contentCandidates: candidates, itemButtons,
        matchedItems: collectCurrentItems().length
    };
}


    async function collectTab(
        tab,
        options = {}
    ) {

        const load =
            await loadTab(
                tab,
                options
            );


        /*
         * 프로필 탭은 기존 방식대로 현재 로드된 전체 데이터 구조에서
         * 바로 읽는다. 별도의 ScrollView 조작은 하지 않는다.
         */
        const observedItems =
            collectCurrentItems();


        const items =
            load.ok
                ? observedItems
                : [];


        if (!load.ok) {

            return {
                toggle:
                    tab.name,
                name:
                    tab.text,
                loaded:
                    false,
                stable:
                    !!load.stable?.ok,
                count:
                    null,
                ownedCount:
                    null,
                unownedCount:
                    null,
                unknownCount:
                    null,
                items:
                    [],
                observedItems,
                observedCount:
                    observedItems.length,
                error:
                    !load.stable?.ok
                        ? '아이템 로딩 확인 실패'
                        : '탭 전환 전후 데이터 변화 미확인',
                diagnostics:
                    inspectCurrentProfileItems(),
                load
            };
        }


        const owned =
            items.filter(
                item =>
                    item.owned === true
            );


        const unowned =
            items.filter(
                item =>
                    item.owned === false
            );


        const unknown =
            items.filter(
                item =>
                    item.owned === null
            );


        const result = {

            toggle:
                tab.name,

            name:
                tab.text,

            loaded:
                load.ok,

            stable:
                load.stable?.ok ??
                false,

            count:
                items.length,

            ownedCount:
                owned.length,

            unownedCount:
                unowned.length,

            unknownCount:
                unknown.length,

            items
        };


        console.log(
            `[PROFILE] ${tab.text}`,
            {
                total:
                    result.count,

                owned:
                    result.ownedCount,

                unowned:
                    result.unownedCount,

                unknown:
                    result.unknownCount
            }
        );


        return result;
    }


    /* ============================================================
     * ALL
     * ============================================================ */


    async function waitForProfileUiReady(
        options = {}
    ) {

        const timeout =
            Math.max(
                1000,
                Number(
                    options.profileReadyTimeout ??
                    5200
                )
            );

        const stableMs =
            Math.max(
                250,
                Number(
                    options.profileReadyStableMs ??
                    650
                )
            );

        const pollMs =
            Math.max(
                60,
                Number(
                    options.profileReadyPollMs ??
                    100
                )
            );


        const deadline =
            Date.now() +
            timeout;


        let stableSignature =
            '';

        let stableSince =
            0;

        let lastState = {
            profileFound:
                false,
            toggleCount:
                0,
            toggleNames:
                []
        };


        while (
            !disposed &&
            Date.now() <
                deadline
        ) {

            const profile =
                findProfileRoot();


            if (!profile) {

                stableSignature =
                    '';

                stableSince =
                    0;

                lastState = {
                    profileFound:
                        false,
                    toggleCount:
                        0,
                    toggleNames:
                        []
                };


                await sleep(
                    pollMs
                );

                continue;
            }


            let toggles =
                [];


            try {

                toggles =
                    collectToggles();

            } catch {}


            const toggleNames =
                toggles
                    .map(
                        tab =>
                            String(
                                tab?.name ||
                                ''
                            )
                    )
                    .filter(
                        Boolean
                    );


            const expectedReady =
                TAB_ORDER.every(
                    name =>
                        toggleNames.includes(
                            name
                        )
                );


            lastState = {
                profileFound:
                    true,
                toggleCount:
                    toggles.length,
                toggleNames
            };


            if (!expectedReady) {

                stableSignature =
                    '';

                stableSince =
                    0;

                await sleep(
                    pollMs
                );

                continue;
            }


            const signature =
                TAB_ORDER
                    .map(
                        name =>
                            toggleNames.includes(
                                name
                            )
                                ? name
                                : '-'
                    )
                    .join(
                        '|'
                    );


            if (
                signature !==
                stableSignature
            ) {

                stableSignature =
                    signature;

                stableSince =
                    Date.now();

            } else if (
                Date.now() -
                    stableSince >=
                stableMs
            ) {

                return {
                    ok: true,
                    profile:
                        findProfileRoot(),
                    toggles:
                        collectToggles(),
                    stableMs,
                    toggleNames
                };
            }


            await sleep(
                pollMs
            );
        }


        return {
            ok: false,
            reason:
                '프로필 UI 준비 시간 초과: 8개 탭이 안정적으로 생성되지 않음',
            ...lastState
        };
    }


    async function collectAll(
        options = {}
    ) {

        /*
         * 각 단계는 최초 1회 + 실패 시 최대 3회 재시도한다.
         * maxRetries를 넘겨도 안전상 3회를 초과하지 않는다.
         */
        const maxRetries =
            Math.max(
                0,
                Math.min(
                    3,
                    Number(
                        options.maxRetries ??
                        3
                    )
                )
            );

        const maxAttempts =
            maxRetries + 1;

        const retryDelay =
            Math.max(
                100,
                Number(
                    options.retryDelay ??
                    350
                )
            );

        /*
         * WORLD_MAP / WORLD_MINIMAP이면
         * 기존 NAV가 막아줌.
         */
        if (![STATE.BASE, STATE.WORLD].includes(detect().state)) return { ok: false, reason: '현재 화면에서는 프로필 수집 불가' };
        let profile = findProfileRoot();


        if (!profile) {

            if (
                typeof openOwnProfile !==
                'function'
            ) {

                return {

                    ok: false,

                    reason:
                        'TOPWAR_NAV.openOwnProfile 없음'
                };
            }


            let opened =
                null;

            const openAttempts =
                [];


            for (
                let attempt = 1;
                attempt <= maxAttempts;
                attempt += 1
            ) {

                try {

                    opened =
                        await openOwnProfile({
                            timeout:
                                options
                                    .profileTimeout ??
                                3000
                        });

                } catch (
                    error
                ) {

                    opened = {
                        ok: false,
                        reason:
                            error?.message ||
                            String(
                                error
                            )
                    };
                }


                openAttempts.push({
                    attempt,
                    ok:
                        !!opened?.ok,
                    reason:
                        opened?.reason ||
                        null
                });


                if (
                    opened?.ok
                )
                    break;


                if (
                    attempt <
                    maxAttempts
                ) {

                    try {
                        options.onProgress?.({
                            type:
                                'profile-open-retry',
                            attempt:
                                attempt + 1,
                            maxAttempts,
                            reason:
                                opened?.reason ||
                                '프로필 열기 실패'
                        });
                    } catch {}


                    await sleep(
                        retryDelay
                    );
                }
            }


            if (!opened?.ok) {

                return {

                    ok: false,

                    stage:
                        'OPEN_PROFILE',

                    detail:
                        opened,

                    attempts:
                        openAttempts
                };
            }


            await sleep(
                Number(
                    options
                        .profileDelay ??
                    400
                )
            );


            profile =
                findProfileRoot();
        }


        if (!profile) {

            return {

                ok: false,

                reason:
                    'UserInfoMainPanel 확인 실패'
            };
        }


        /*
         * UserInfoMainPanel 노드만 생겼다고 준비 완료가 아니다.
         * 실제 8개 탭이 모두 생성되고 같은 구성이 일정 시간 유지된 뒤에
         * profile-ready를 발생시킨다.
         */
        const ready =
            await waitForProfileUiReady(
                options
            );


        if (!ready.ok) {

            return {
                ok: false,
                stage:
                    'WAIT_PROFILE_UI',
                reason:
                    ready.reason,
                detail:
                    ready
            };
        }


        /*
         * Cocos가 프로필 프레임 내부 노드를 교체할 수 있으므로
         * 준비 완료 시점의 최신 root를 다시 잡는다.
         */
        profile =
            ready.profile ||
            findProfileRoot();


        const tabs =
            ready.toggles ||
            collectToggles();


        /*
         * 판매 정보 Collector가 UI 진행상황을 실제 수집 단계와 동기화할 수 있도록
         * 실제 8개 탭 준비 완료 뒤에 이벤트를 전달한다.
         */
        try {
            options.onProgress?.({
                type:
                    'profile-ready',
                profilePath:
                    nodePath(
                        profile
                    ),
                toggleCount:
                    tabs.length,
                toggleNames:
                    tabs.map(
                        tab =>
                            tab.name
                    ),
                stableMs:
                    ready.stableMs
            });
        } catch {}


        if (
            tabs.length !==
                TAB_ORDER.length ||
            !TAB_ORDER.every(
                name =>
                    tabs.some(
                        tab =>
                            tab.name ===
                            name
                    )
            )
        ) {

            return {
                ok: false,
                stage:
                    'VERIFY_PROFILE_TABS',
                reason:
                    `프로필 필수 탭 부족: ${tabs.length}/${TAB_ORDER.length}`,
                detail: {
                    toggleNames:
                        tabs.map(
                            tab =>
                                tab.name
                        )
                }
            };
        }


        const result = {

            ok: true,

            version:
                VERSION,

            collectedAt:
                new Date()
                    .toISOString(),

            tabCount:
                tabs.length,

            totalItems:
                0,

            ownedCount:
                0,

            unownedCount:
                0,

            unknownCount:
                0,

            tabs: {},

            flat: []
        };


        for (
            let index = 0;
            index < tabs.length;
            index++
        ) {

            const tab =
                tabs[index];


            console.log(
                `[PROFILE ${index + 1}/${tabs.length}] ${tab.text}`
            );


            try {
                options.onProgress?.({
                    type: 'tab-start',
                    index,
                    total: tabs.length,
                    toggle: tab.name,
                    label: tab.text
                });
            } catch {}


            /*
             * Cocos가 같은 프로필 화면 안에서 root 객체를 교체할 수 있으므로
             * 객체 identity는 비교하지 않는다. 화면이 닫혔는지만 확인한다.
             */
            if (
                disposed ||
                !findProfileRoot()
            ) {
                result.ok = false;
                result.reason =
                    disposed
                        ? '수집기 종료됨'
                        : '프로필 화면이 탭 조사 중 닫힘';
                result.stage =
                    'PROFILE_TAB_TRAVERSAL';
                break;
            }


            let data =
                null;

            const attempts =
                [];


            for (
                let attempt = 1;
                attempt <= maxAttempts;
                attempt += 1
            ) {

                try {

                    data =
                        await collectTab(
                            tab,
                            options
                        );

                } catch (
                    error
                ) {

                    recordError(
                        '프로필 탭 ' +
                        tab.name +
                        ` 시도 ${attempt}`,
                        error
                    );

                    data = {
                        name:
                            tab.text,
                        toggle:
                            tab.name,
                        loaded:
                            false,
                        stable:
                            false,
                        count:
                            null,
                        ownedCount:
                            null,
                        unownedCount:
                            null,
                        unknownCount:
                            null,
                        items:
                            [],
                        error:
                            error?.message ||
                            String(
                                error
                            )
                    };
                }


                const attemptOk =
                    !!data?.loaded &&
                    !!data?.stable;


                attempts.push({
                    attempt,
                    ok:
                        attemptOk,
                    reason:
                        attemptOk
                            ? null
                            : (
                                data?.error ||
                                '탭 데이터 확인 실패'
                              )
                });


                if (
                    attemptOk
                )
                    break;


                if (
                    attempt <
                    maxAttempts
                ) {

                    try {
                        options.onProgress?.({
                            type:
                                'tab-retry',
                            index,
                            total:
                                tabs.length,
                            toggle:
                                tab.name,
                            label:
                                tab.text,
                            attempt:
                                attempt + 1,
                            maxAttempts,
                            reason:
                                data?.error ||
                                '탭 데이터 확인 실패'
                        });
                    } catch {}


                    await sleep(
                        retryDelay
                    );
                }
            }


            data = {
                ...data,
                attempts
            };


            if (!data.loaded || !data.stable) result.ok = false;


            try {
                options.onProgress?.({
                    type: 'tab-complete',
                    index,
                    total: tabs.length,
                    toggle: tab.name,
                    label: tab.text,
                    ok: !!data.loaded && !!data.stable,
                    data
                });
            } catch {}


            result.tabs[
                tab.text
            ] =
                data;


            for (
                const item
                of data.items
            ) {

                result.flat.push({

                    tab:
                        tab.text,

                    toggle:
                        tab.name,

                    ...item
                });
            }


            result.totalItems +=
                data.count;

            result.ownedCount +=
                data.ownedCount;

            result.unownedCount +=
                data.unownedCount;

            result.unknownCount +=
                data.unknownCount;
        }


        result.ok = result.ok && tabs.length === TAB_ORDER.length && Object.keys(result.tabs).length === TAB_ORDER.length;
        if (!result.ok) {
            result.confirmedItemCount = result.totalItems;
            result.totalItems = result.ownedCount = result.unownedCount = result.unknownCount = null;
        }
        window.TOPWAR_PROFILE_DATA = result;


        console.log(
            '=============================='
        );

        console.log(
            '[TOPWAR_PROFILE] 수집 완료'
        );

        console.table(
            Object.values(
                result.tabs
            ).map(
                tab => ({

                    tab:
                        tab.name,

                    total:
                        tab.count,

                    owned:
                        tab.ownedCount,

                    unowned:
                        tab.unownedCount,

                    unknown:
                        tab.unknownCount
                })
            )
        );


        console.log(
            'TOTAL',
            {
                tabs:
                    result.tabCount,

                items:
                    result.totalItems,

                owned:
                    result.ownedCount,

                unowned:
                    result.unownedCount,

                unknown:
                    result.unknownCount
            }
        );


        console.log(
            '최종 객체:',
            result
        );


        return result;
    }


    /* ============================================================
     * OWNED ONLY
     * ============================================================ */


    function getOwned(
        data =
            window.TOPWAR_PROFILE_DATA
    ) {

        if (!data?.flat) {

            return [];
        }


        return data.flat.filter(
            item =>
                item.owned === true
        );
    }


    function getUnowned(
        data =
            window.TOPWAR_PROFILE_DATA
    ) {

        if (!data?.flat) {

            return [];
        }


        return data.flat.filter(
            item =>
                item.owned === false
        );
    }


    function getUnknown(
        data =
            window.TOPWAR_PROFILE_DATA
    ) {

        if (!data?.flat) {

            return [];
        }


        return data.flat.filter(
            item =>
                item.owned === null
        );
    }


    /* ============================================================
     * PUBLIC
     * ============================================================ */


    return {
        inspectCurrentProfileItems,

        waitForProfileUiReady,

        version:
            VERSION,

        TAB_ORDER,

        findProfileRoot,

        collectToggles,

        findContentRoot,

        collectCurrentItems,

        detectOwnership,

        waitForContentStable,

        collectTab,

        collectAll,

        getOwned,

        getUnowned,

        getUnknown
    };


})();

    /* ============================================================
     * TOPWAR CHARACTER SALE COLLECTOR
     *
     * 목적:
     * - 범용 매크로가 아니라 캐릭터 판매용 정보 수집
     * - 현재 확정된 프로필 8개 탭 데이터를 하나의 객체로 통합
     * - 아직 구조가 확정되지 않은 닉네임/서버/VIP/전투력 등은
     *   억지로 추측하지 않고 실제 Label(path + text)을 진단 데이터로 보존
     *
     * 결과:
     *   window.TOPWAR_CHARACTER_SALE_DATA
     * ============================================================ */

    const SALE_SCHEMA_VERSION = '0.9.3';

    const SALE_PROGRESS_ITEMS = Object.freeze([
        { key: 'profileBasic', label: '프로필 기본 정보', implemented: true },
        { key: 'toggle1', label: '보유 외관 정보', implemented: true },
        { key: 'toggle3', label: '보유 대열 정보', implemented: true },
        { key: 'toggle4', label: '보유 기지 효과 정보', implemented: true },
        { key: 'toggle5', label: '보유 이동 효과 정보', implemented: true },
        { key: 'toggle6', label: '보유 행군 참여 정보', implemented: true },
        { key: 'toggle7', label: '보유 수호 효과 정보', implemented: true },
        { key: 'toggle8', label: '보유 영광의 장식 정보', implemented: true },
        { key: 'toggle10', label: '보유 기지 오라 정보', implemented: true },

        // 영웅 상세 판매 정보.
        { key: 'heroes', label: '보유 영웅 정보', implemented: true },
        { key: 'skills', label: '장착 스킬 정보', implemented: true },
        { key: 'traits', label: '영웅 특성', implemented: true },
        { key: 'equipment', label: '타이탄 장비', implemented: true },
        { key: 'awakening', label: '영웅 각성', implemented: true },

        // 아직 후속 Collector가 필요한 항목.
        { key: 'inventory', label: '보유 아이템 / 재화 정보', implemented: false }
    ]);

    const SALE_PROFILE_CATEGORIES = Object.freeze({
        toggle1: { key: 'baseSkins',       label: '기지 외관' },
        toggle3: { key: 'formationSkins',  label: '대열 외관' },
        toggle4: { key: 'baseEffects',     label: '기지 효과' },
        toggle5: { key: 'marchEffects',    label: '이동 효과' },
        toggle6: { key: 'marchJoin',       label: '행군 참여' },
        toggle7: { key: 'guardianEffects', label: '수호 효과' },
        toggle8: { key: 'decorations',     label: '영광의 장식' },
        toggle10:{ key: 'baseAura',        label: '기지 오라' }
    });


    /*
     * 판매용 보유 수에서 제외할 항목.
     *
     * 카테고리와 관계없이 정확히 "효과 없음"만 제외한다.
     * "기본", "고전 해병대", "골든 링"은 정상 보유 항목으로 카운트한다.
     *
     * 원본 items 자체는 보존하고,
     * 판매용 ownedItems / ownedCount에서만 "효과 없음"을 제외한다.
     */
    const SALE_EXCLUDED_PROFILE_ITEM_NAMES =
        new Set([
            '효과 없음'
        ]);


    function saleProfileItemTexts(item) {

        return [
            item?.name,
            ...(Array.isArray(item?.texts)
                ? item.texts
                : [])
        ]
            .map(
                value =>
                    String(
                        value ?? ''
                    ).trim()
            )
            .filter(Boolean);
    }


    function isExcludedSaleProfileItem(
        toggle,
        item
    ) {

        return saleProfileItemTexts(
            item
        ).some(
            text =>
                SALE_EXCLUDED_PROFILE_ITEM_NAMES.has(
                    text
                )
        );
    }


    function saleOwnedProfileItems(
        toggle,
        items
    ) {

        return (
            Array.isArray(items)
                ? items
                : []
        ).filter(
            item =>
                item?.owned === true
                &&
                !isExcludedSaleProfileItem(
                    toggle,
                    item
                )
        );
    }

    function collectProfileHeaderLabels() {
        const panel = profileModule.findProfileRoot();

        if (!panel) {
            return [];
        }

        const rows = [];
        const seen = new Set();

        walk(panel, node => {
            const path = nodePath(node);

            /*
             * 판매 기본정보 후보만 보기 위해 외관 아이템 리스트 영역은 제외.
             * towerNode 내부 데이터는 profile.categories 쪽에서 별도로 수집한다.
             */
            if (path.includes('/contentNode/towerNode/')) {
                return;
            }

            const candidates = [];

            try {
                const label = node.getComponent?.(window.cc?.Label);
                const value = String(label?.string ?? '').trim();
                if (value) {
                    candidates.push({
                        type: 'cc.Label',
                        text: value
                    });
                }
            } catch {}

            try {
                const rich = node.getComponent?.(window.cc?.RichText);
                const value = String(rich?.string ?? '').trim();
                if (value) {
                    candidates.push({
                        type: 'cc.RichText',
                        text: value
                    });
                }
            } catch {}

            for (const item of candidates) {
                const key = JSON.stringify([path, item.type, item.text]);
                if (seen.has(key)) continue;
                seen.add(key);

                rows.push({
                    name: String(node.name || ''),
                    path,
                    type: item.type,
                    text: item.text
                });
            }
        });

        return rows;
    }

    function classifyProfileHeaderLabels(labels) {
        const groups = {
            nickname: [],
            server: [],
            level: [],
            vip: [],
            power: []
        };

        const rules = {
            nickname: /(nickname|nick|user.?name|player.?name|name)/i,
            server: /(server|zone|sid)/i,
            level: /(^|[^a-z])(level|lv)([^a-z]|$)/i,
            vip: /vip/i,
            power: /(power|combat|fight|battle.?power)/i
        };

        for (const row of labels || []) {
            const haystack = [
                row.name,
                row.path
            ].join(' ');

            for (const [key, pattern] of Object.entries(rules)) {
                if (pattern.test(haystack)) {
                    groups[key].push(row);
                }
            }
        }

        return groups;
    }

    function normalizeSaleProfile(profileData) {
        const categories = {};

        for (const descriptor of Object.values(SALE_PROFILE_CATEGORIES)) {
            categories[descriptor.key] = {
                key: descriptor.key,
                label: descriptor.label,
                toggle: null,
                loaded: false,
                stable: false,
                count: null,
                ownedCount: null,
                rawOwnedCount: null,
                excludedOwnedCount: 0,
                unownedCount: null,
                unknownCount: null,
                ownedItems: [],
                excludedOwnedItems: [],
                unknownItems: [],
                items: []
            };
        }

        for (const tab of Object.values(profileData?.tabs || {})) {
            const descriptor = SALE_PROFILE_CATEGORIES[tab.toggle];
            if (!descriptor) continue;

            const items = Array.isArray(tab.items) ? tab.items : [];
            const target = categories[descriptor.key];

            target.toggle = tab.toggle;
            target.loaded = !!tab.loaded;
            target.stable = !!tab.stable;
            const rawOwnedItems =
                items.filter(
                    item =>
                        item.owned === true
                );

            const saleOwnedItems =
                saleOwnedProfileItems(
                    tab.toggle,
                    items
                );

            const excludedOwnedItems =
                rawOwnedItems.filter(
                    item =>
                        isExcludedSaleProfileItem(
                            tab.toggle,
                            item
                        )
                );

            target.count =
                tab.count ??
                null;

            /*
             * 판매용 ownedCount.
             * 기본 지급 항목/효과 없음은 제외한다.
             */
            target.ownedCount =
                saleOwnedItems.length;

            /*
             * 진단을 위해 게임에서 읽은 원래 보유 수는 따로 보존.
             */
            target.rawOwnedCount =
                tab.ownedCount ??
                rawOwnedItems.length;

            target.excludedOwnedCount =
                excludedOwnedItems.length;

            target.unownedCount =
                tab.unownedCount ??
                null;

            target.unknownCount =
                tab.unknownCount ??
                null;

            target.ownedItems =
                saleOwnedItems;

            target.excludedOwnedItems =
                excludedOwnedItems;

            target.unknownItems =
                items.filter(
                    item =>
                        item.owned == null
                );

            target.items =
                items;
        }

        const categoryValues =
            Object.values(
                categories
            );

        const saleOwnedCount =
            categoryValues.reduce(
                (sum, category) =>
                    sum +
                    (
                        Number.isFinite(
                            category.ownedCount
                        )
                            ? category.ownedCount
                            : 0
                    ),
                0
            );

        const rawOwnedCount =
            categoryValues.reduce(
                (sum, category) =>
                    sum +
                    (
                        Number.isFinite(
                            category.rawOwnedCount
                        )
                            ? category.rawOwnedCount
                            : 0
                    ),
                0
            );

        const excludedOwnedCount =
            categoryValues.reduce(
                (sum, category) =>
                    sum +
                    (
                        Number.isFinite(
                            category.excludedOwnedCount
                        )
                            ? category.excludedOwnedCount
                            : 0
                    ),
                0
            );


        return {
            summary: {
                ok:
                    !!profileData?.ok,

                reason:
                    profileData?.reason ||
                    profileData?.detail?.reason ||
                    null,

                stage:
                    profileData?.stage ||
                    null,

                tabCount:
                    profileData?.tabCount ??
                    null,

                totalItems:
                    profileData?.totalItems ??
                    null,

                confirmedItemCount:
                    profileData
                        ?.confirmedItemCount ??
                    null,

                /*
                 * UI/판매 데이터에서 사용하는 보유 수.
                 */
                ownedCount:
                    saleOwnedCount,

                /*
                 * 게임에서 원래 읽은 보유 수.
                 */
                rawOwnedCount,

                excludedOwnedCount,

                unownedCount:
                    profileData?.unownedCount ??
                    null,

                unknownCount:
                    profileData?.unknownCount ??
                    null
            },

            categories
        };
    }

    function saleSleep(
        ms
    ) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    Math.max(
                        0,
                        Number(
                            ms ||
                            0
                        )
                    )
                )
        );
    }


    async function runCollectorStepWithRetries(
        label,
        task,
        options = {}
    ) {

        const maxRetries =
            Math.max(
                0,
                Math.min(
                    3,
                    Number(
                        options.maxRetries ??
                        3
                    )
                )
            );

        const maxAttempts =
            maxRetries + 1;

        const retryDelay =
            Math.max(
                100,
                Number(
                    options.retryDelay ??
                    350
                )
            );

        const attempts =
            [];

        let lastValue =
            null;


        for (
            let attempt = 1;
            attempt <= maxAttempts;
            attempt += 1
        ) {

            try {

                lastValue =
                    await task(
                        attempt,
                        maxAttempts
                    );

                const ok =
                    typeof options.isSuccess ===
                        'function'
                        ? !!options.isSuccess(
                            lastValue
                          )
                        : !!lastValue?.ok;


                attempts.push({
                    attempt,
                    ok,
                    reason:
                        ok
                            ? null
                            : (
                                lastValue?.reason ||
                                lastValue?.error ||
                                '단계 실패'
                              )
                });


                if (
                    ok
                ) {

                    return {
                        ok: true,
                        value:
                            lastValue,
                        attempts
                    };
                }

            } catch (
                error
            ) {

                attempts.push({
                    attempt,
                    ok: false,
                    reason:
                        error?.message ||
                        String(
                            error
                        )
                });


                lastValue = {
                    ok: false,
                    reason:
                        error?.message ||
                        String(
                            error
                        )
                };


                recordError(
                    `${label} 시도 ${attempt}`,
                    error
                );
            }


            if (
                attempt <
                maxAttempts
            ) {

                try {
                    options.onRetry?.({
                        label,
                        attempt:
                            attempt + 1,
                        maxAttempts,
                        reason:
                            attempts[
                                attempts.length -
                                1
                            ]?.reason
                    });
                } catch {}


                await saleSleep(
                    retryDelay
                );
            }
        }


        return {
            ok: false,
            value:
                lastValue,
            attempts,
            reason:
                attempts[
                    attempts.length -
                    1
                ]?.reason ||
                `${label} 실패`
        };
    }


    function findHeroListRoot() {

        const root =
            scene();

        let found =
            null;


        if (!root)
            return null;


        walk(
            root,
            node => {

                if (
                    found ||
                    !isActive(
                        node
                    )
                )
                    return;


                if (
                    node?.name ===
                    'HeroListPopup2023'
                ) {

                    found =
                        node;
                }
            }
        );


        return found;
    }


    function findHeroOpenButtonRow() {

        if (
            typeof gameButtonRows !==
            'function'
        )
            return null;


        const rows =
            gameButtonRows().filter(
                row => {

                    if (
                        !row?.enabled ||
                        !row?.supported
                    )
                        return false;


                    const hasHeroHandler =
                        (
                            row?.events ||
                            []
                        ).some(
                            event =>
                                event?.handler ===
                                'onHeroClick'
                        );


                    const exactHeroButton =
                        row?.name ===
                            'btnHero' &&
                        /\/NMainUI\/RightBottom\/btnHero$/
                            .test(
                                row?.path ||
                                ''
                            );


                    return (
                        hasHeroHandler ||
                        exactHeroButton
                    );
                }
            );


        rows.sort(
            (a, b) => {

                const score =
                    row =>
                        (
                            /\/NMainUI\/RightBottom\/btnHero$/
                                .test(
                                    row?.path ||
                                    ''
                                )
                                ? 1000
                                : 0
                        ) +
                        (
                            row?.name ===
                                'btnHero'
                                ? 200
                                : 0
                        ) +
                        (
                            (
                                row?.events ||
                                []
                            ).some(
                                event =>
                                    event?.handler ===
                                    'onHeroClick'
                            )
                                ? 100
                                : 0
                        ) +
                        (
                            /NMainUI/
                                .test(
                                    row?.path ||
                                    ''
                                )
                                ? 20
                                : 0
                        );


                return (
                    score(b) -
                    score(a)
                );
            }
        );


        return (
            rows[0] ||
            null
        );
    }


    async function openHeroListScreen(
        options = {}
    ) {

        const already =
            findHeroListRoot();


        if (
            already
        ) {

            return {
                ok: true,
                alreadyOpen:
                    true,
                path:
                    nodePath(
                        already
                    )
            };
        }


        const buttonDeadline =
            Date.now() +
            Math.max(
                500,
                Number(
                    options.buttonTimeout ??
                    options.timeout ??
                    3500
                )
            );


        let target =
            findHeroOpenButtonRow();


        /*
         * 프로필 프레임이 닫힌 직후 MainUI가 다시 활성화되는 데
         * 짧은 지연이 있을 수 있다.
         */
        while (
            !disposed &&
            !target &&
            Date.now() <
                buttonDeadline
        ) {

            await saleSleep(
                100
            );


            target =
                findHeroOpenButtonRow();
        }


        if (!target) {

            return {
                ok: false,
                reason:
                    'NMainUI/RightBottom/btnHero(onHeroClick)를 찾지 못했습니다.',
                heroCandidates:
                    (
                        typeof gameButtonRows ===
                            'function'
                            ? gameButtonRows()
                            : []
                    )
                        .filter(
                            row =>
                                /hero/i.test(
                                    [
                                        row?.name,
                                        row?.path,
                                        row?.text,
                                        ...(
                                            row?.events ||
                                            []
                                        ).map(
                                            event =>
                                                event?.handler
                                        )
                                    ]
                                        .filter(
                                            Boolean
                                        )
                                        .join(
                                            ' '
                                        )
                                )
                        )
                        .map(
                            describeGameButton
                        )
            };
        }


        const pressed =
            await pressGameButton(
                target.id,
                {
                    waitMs:
                        options.waitMs ??
                        500
                }
            );


        if (!pressed.ok) {

            return {
                ok: false,
                reason:
                    pressed.reason ||
                    '영웅 버튼 실행 실패',
                detail:
                    pressed
            };
        }


        const deadline =
            Date.now() +
            Number(
                options.timeout ??
                3500
            );


        let panel =
            findHeroListRoot();


        while (
            !disposed &&
            !panel &&
            Date.now() <
                deadline
        ) {

            await saleSleep(
                100
            );

            panel =
                findHeroListRoot();
        }


        return {
            ok:
                !!panel &&
                !disposed,
            reason:
                panel
                    ? undefined
                    : '영웅 목록 화면 확인 실패',
            path:
                panel
                    ? nodePath(
                        panel
                      )
                    : null,
            target:
                describeGameButton(
                    target
                )
        };
    }


    function findHeroListScrollView() {

        const panel =
            findHeroListRoot();


        if (
            !panel ||
            !window.cc?.ScrollView
        )
            return null;


        const candidates =
            [];


        walk(
            panel,
            node => {

                if (
                    !isActive(
                        node
                    )
                )
                    return;


                let component =
                    null;


                try {

                    component =
                        node.getComponent?.(
                            window.cc.ScrollView
                        );

                } catch {}


                if (!component)
                    return;


                const path =
                    nodePath(
                        node
                    );


                const content =
                    component.content ||
                    null;


                const contentPath =
                    content
                        ? nodePath(
                            content
                          )
                        : '';


                let score =
                    0;


                if (
                    node?.name ===
                    'ScrollView'
                )
                    score += 100;

                if (
                    /\/HeroListPopup2023\/ScrollView(?:\/|$)/
                        .test(
                            path
                        )
                )
                    score += 300;

                if (
                    /\/HeroListPopup2023\/ScrollView\/view\/content$/
                        .test(
                            contentPath
                        )
                )
                    score += 600;

                if (
                    content &&
                    findDescendantByName(
                        content,
                        'itemSpecialContent'
                    )
                )
                    score += 1000;

                if (
                    component.vertical ===
                    true
                )
                    score += 100;


                candidates.push({
                    node,
                    component,
                    content,
                    path,
                    contentPath,
                    score
                });
            }
        );


        candidates.sort(
            (a, b) =>
                b.score -
                a.score
        );


        return (
            candidates[0] ||
            null
        );
    }


    function heroScrollOffset(
        scrollInfo
    ) {

        const component =
            scrollInfo?.component;


        if (!component)
            return null;


        try {

            if (
                typeof component.getScrollOffset ===
                'function'
            ) {

                const offset =
                    component.getScrollOffset();


                return {
                    x:
                        Number(
                            offset?.x ??
                            0
                        ),
                    y:
                        Number(
                            offset?.y ??
                            0
                        )
                };
            }

        } catch {}


        const content =
            component.content ||
            scrollInfo?.content;


        if (content) {

            return {
                x:
                    Number(
                        content.x ??
                        content.position?.x ??
                        0
                    ),
                y:
                    Number(
                        content.y ??
                        content.position?.y ??
                        0
                    )
            };
        }


        return null;
    }


    function heroScrollMoved(
        before,
        after
    ) {

        if (
            !before ||
            !after
        )
            return false;


        return (
            Math.abs(
                Number(
                    after.x ||
                    0
                ) -
                Number(
                    before.x ||
                    0
                )
            ) >
                1 ||
            Math.abs(
                Number(
                    after.y ||
                    0
                ) -
                Number(
                    before.y ||
                    0
                )
            ) >
                1
        );
    }


    async function moveHeroListScroll(
        scrollInfo,
        position,
        options = {}
    ) {

        const component =
            scrollInfo?.component;


        if (!component) {

            return {
                ok: false,
                reason:
                    '영웅 ScrollView 없음'
            };
        }


        const target =
            Math.max(
                0,
                Math.min(
                    1,
                    Number(
                        position ||
                        0
                    )
                )
            );


        const duration =
            Math.max(
                0.15,
                Number(
                    options.scrollDuration ??
                    0.40
                )
            );


        const settleMs =
            Math.max(
                400,
                Number(
                    options.scrollSettleMs ??
                    700
                )
            );


        const before =
            heroScrollOffset(
                scrollInfo
            );


        let method =
            null;

        let error =
            null;


        /*
         * 1차: Cocos ScrollView 정식 percent API.
         * 애니메이션이 화면에 보이도록 0.4초를 기본값으로 사용.
         */
        try {

            if (
                typeof component.scrollToPercentVertical ===
                'function'
            ) {

                component.scrollToPercentVertical(
                    target,
                    duration,
                    false
                );

                method =
                    'scrollToPercentVertical';
            }

        } catch (
            e
        ) {

            error =
                e;
        }


        await saleSleep(
            Math.ceil(
                duration *
                1000
            ) +
            settleMs
        );


        let after =
            heroScrollOffset(
                scrollInfo
            );


        let moved =
            heroScrollMoved(
                before,
                after
            );


        /*
         * 0% 위치는 이미 상단일 수 있으므로 움직이지 않아도 정상.
         * 그 외 위치에서 percent API로 실제 이동이 없으면
         * getMaxScrollOffset + scrollToOffset을 fallback으로 사용.
         */
        if (
            target >
                0.001 &&
            !moved &&
            typeof component.getMaxScrollOffset ===
                'function' &&
            typeof component.scrollToOffset ===
                'function'
        ) {

            try {

                const max =
                    component.getMaxScrollOffset();


                const maxY =
                    Math.abs(
                        Number(
                            max?.y ??
                            0
                        )
                    );


                const offsetY =
                    maxY *
                    target;


                const vector =
                    window.cc?.v2
                        ? window.cc.v2(
                            0,
                            offsetY
                          )
                        : {
                            x: 0,
                            y: offsetY
                          };


                component.scrollToOffset(
                    vector,
                    duration,
                    false
                );


                method =
                    'scrollToOffset';


                await saleSleep(
                    Math.ceil(
                        duration *
                        1000
                    ) +
                    settleMs
                );


                after =
                    heroScrollOffset(
                        scrollInfo
                    );


                moved =
                    heroScrollMoved(
                        before,
                        after
                    );

            } catch (
                e
            ) {

                error =
                    e;
            }
        }


        return {
            ok:
                target <=
                    0.001 ||
                moved,

            target,

            method,

            moved,

            before,

            after,

            error:
                error
                    ? (
                        error?.message ||
                        String(
                            error
                        )
                      )
                    : null
        };
    }


    function mergeHeroRows(
        target,
        source
    ) {

        if (!target)
            return {
                ...source
            };


        const merged = {
            ...target,
            ...source
        };


        /*
         * 뒤쪽 스크롤에서 빈 문자열/NULL이 들어와
         * 앞서 확보한 값을 지우지 않도록 보정.
         */
        for (
            const key
            of [
                'name',
                'levelText',
                'level',
                'star',
                'awakenLevelText',
                'awakenLevel',
                'rarityEvidence'
            ]
        ) {

            if (
                source?.[key] == null ||
                source?.[key] ===
                    ''
            ) {

                merged[key] =
                    target?.[key] ??
                    source?.[key];
            }
        }


        return merged;
    }


    function heroSaleKey(
        item
    ) {

        if (
            Number.isFinite(
                item?.heroIdCandidate
            )
        ) {

            return (
                'id:' +
                item.heroIdCandidate
            );
        }


        if (
            item?.name
        ) {

            return (
                'name:' +
                item.name
            );
        }


        return (
            'path:' +
            (
                item?.path ||
                Math.random()
            )
        );
    }


    async function collectHeroListData(
        options = {}
    ) {

        /*
         * 중요:
         * openHeroListScreen()에서 이미 HeroListPopup2023 진입 성공을
         * 확인했다. 여기서 다시 saleWaitForNode()로 "동일 노드가 N ms 동안
         * 유지되는지"를 검사하면 Cocos 내부에서 프레임/CONTENT가 교체되는
         * 경우 실제 화면이 보이는데도 실패할 수 있다.
         *
         * 따라서 영웅 목록만큼은:
         *   화면 진입 확인 -> 고정 대기 -> 현재 패널 재탐색 -> 스크롤
         * 순서로 간다.
         */
        await saleSleep(
            Math.max(
                800,
                Number(
                    options.heroListOpenDelay ??
                    1200
                )
            )
        );


        let panel =
            findHeroListRoot();


        if (!panel) {

            /*
             * 렌더 지연 가능성을 고려해 짧게 추가 탐색.
             * 노드 identity 안정 판정은 하지 않는다.
             */
            const deadline =
                Date.now() +
                Math.max(
                    1000,
                    Number(
                        options.heroListFindTimeout ??
                        3000
                    )
                );


            while (
                !disposed &&
                !panel &&
                Date.now() <
                    deadline
            ) {

                await saleSleep(
                    100
                );


                panel =
                    findHeroListRoot();
            }
        }


        if (!panel) {

            return {
                ok: false,
                reason:
                    'HeroListPopup2023가 영웅 메뉴 진입 후 사라졌습니다.',
                items:
                    [],
                scrollSupported:
                    false,
                samples:
                    []
            };
        }


        /*
         * 화면에는 패널이 떠 있어도 virtual list의 ScrollView가
         * 한 박자 늦게 생성될 수 있으므로 별도로 기다린다.
         */
        let scrollInfo =
            findHeroListScrollView();


        const scrollDeadline =
            Date.now() +
            Math.max(
                1200,
                Number(
                    options.heroScrollViewTimeout ??
                    3200
                )
            );


        while (
            !disposed &&
            !scrollInfo &&
            Date.now() <
                scrollDeadline
        ) {

            await saleSleep(
                100
            );


            scrollInfo =
                findHeroListScrollView();
        }


        if (!scrollInfo) {

            const scrollCandidates =
                [];


            if (
                window.cc?.ScrollView
            ) {

                walk(
                    panel,
                    node => {

                        let component =
                            null;


                        try {

                            component =
                                node.getComponent?.(
                                    window.cc.ScrollView
                                );

                        } catch {}


                        if (!component)
                            return;


                        scrollCandidates.push({
                            name:
                                node.name ||
                                '',
                            path:
                                nodePath(
                                    node
                                ),
                            vertical:
                                component.vertical ??
                                null,
                            horizontal:
                                component.horizontal ??
                                null,
                            contentPath:
                                component.content
                                    ? nodePath(
                                        component.content
                                      )
                                    : null
                        });
                    }
                );
            }


            return {
                ok: false,
                reason:
                    '영웅 목록 내부 cc.ScrollView를 찾지 못했습니다.',
                count:
                    heroes.size,
                items:
                    [
                        ...heroes.values()
                    ],
                scrollSupported:
                    false,
                samples,
                scrollCandidates
            };
        }


        const heroes =
            new Map();

        const samples =
            [];


        /*
         * 스크롤 전에 현재 화면의 카드부터 반드시 한 번 읽는다.
         * 이 값이 0이면 스크롤 문제와 카드 탐색 문제를 구분할 수 있다.
         */
        const initialVisibleRows =
            inspectVisibleHeroItems();


        samples.push({
            type:
                'initial-visible',
            visible:
                initialVisibleRows.length,
            heroIds:
                initialVisibleRows
                    .map(
                        row =>
                            row?.heroIdCandidate
                    )
                    .filter(
                        value =>
                            Number.isFinite(
                                value
                            )
                    )
                    .slice(
                        0,
                        20
                    )
        });


        for (
            const row
            of initialVisibleRows
        ) {

            const key =
                heroSaleKey(
                    row
                );


            heroes.set(
                key,
                mergeHeroRows(
                    heroes.get(
                        key
                    ),
                    row
                )
            );
        }


        const capture =
            (
                position,
                attempt
            ) => {

                const rows =
                    inspectVisibleHeroItems();


                for (
                    const row
                    of rows
                ) {

                    const enrichedRow =
                        Number.isFinite(
                            position
                        )
                            ? {
                                ...row,
                                listPosition:
                                    position
                              }
                            : row;


                    const key =
                        heroSaleKey(
                            enrichedRow
                        );


                    heroes.set(
                        key,
                        mergeHeroRows(
                            heroes.get(
                                key
                            ),
                            enrichedRow
                        )
                    );
                }


                samples.push({
                    position,
                    attempt,
                    visible:
                        rows.length,
                    totalUnique:
                        heroes.size
                });


                return rows;
            };


        const settleDelay =
            Math.max(
                500,
                Number(
                    options.heroSettleDelay ??
                    700
                )
            );

        const sampleRetries =
            Math.max(
                0,
                Math.min(
                    3,
                    Number(
                        options.maxRetries ??
                        3
                    )
                )
            );


        /*
         * 새로 연 영웅 화면은 상단부터 시작.
         * moveHeroListScroll가 실제 offset 변화까지 확인한다.
         */
        await moveHeroListScroll(
            scrollInfo,
            0,
            {
                scrollDuration:
                    options.heroScrollDuration ??
                    0.40,

                scrollSettleMs:
                    settleDelay
            }
        );


        const positions =
            scrollInfo?.component &&
            typeof scrollInfo.component.scrollToPercentVertical ===
                'function'
                ? Array.from(
                    {
                        length: 13
                    },
                    (_, index) =>
                        index /
                        12
                  )
                : [null];


        for (
            const position
            of positions
        ) {

            if (
                disposed ||
                !findHeroListRoot()
            ) {

                return {
                    ok: false,
                    reason:
                        '영웅 목록 화면이 조사 중 닫혔습니다.',
                    count:
                        heroes.size,
                    items:
                        [
                            ...heroes.values()
                        ],
                    scrollSupported:
                        true,
                    samples
                };
            }


            if (
                position != null &&
                scrollInfo?.component
            ) {

                const scrollMove =
                    await moveHeroListScroll(
                        scrollInfo,
                        position,
                        {
                            scrollDuration:
                                options.heroScrollDuration ??
                                0.40,

                            scrollSettleMs:
                                settleDelay
                        }
                    );


                samples.push({
                    type:
                        'scroll',
                    position,
                    scroll:
                        scrollMove,
                    totalUnique:
                        heroes.size
                });


                /*
                 * 실제 이동이 안 된 구간은 같은 위치에서 한 번 더 시도.
                 */
                if (
                    position >
                        0.001 &&
                    !scrollMove.ok
                ) {

                    await saleSleep(
                        settleDelay
                    );


                    const retryMove =
                        await moveHeroListScroll(
                            scrollInfo,
                            position,
                            {
                                scrollDuration:
                                    options.heroScrollDuration ??
                                    0.40,

                                scrollSettleMs:
                                    settleDelay
                            }
                        );


                    samples.push({
                        type:
                            'scroll-retry',
                        position,
                        scroll:
                            retryMove,
                        totalUnique:
                            heroes.size
                    });
                }
            }


            let rows =
                [];


            for (
                let attempt = 1;
                attempt <=
                    sampleRetries + 1;
                attempt += 1
            ) {

                rows =
                    capture(
                        position,
                        attempt
                    );


                if (
                    rows.length
                )
                    break;


                if (
                    attempt <=
                    sampleRetries
                ) {

                    await saleSleep(
                        settleDelay
                    );
                }
            }
        }


        /*
         * 조사 종료 후 상단으로 되돌린다.
         */
        await moveHeroListScroll(
            scrollInfo,
            0,
            {
                scrollDuration:
                    options.heroScrollDuration ??
                    0.40,

                scrollSettleMs:
                    450
            }
        );


        const rawItems =
            [
                ...heroes.values()
            ].sort(
                (a, b) => {

                    const aid =
                        Number.isFinite(
                            a?.heroIdCandidate
                        )
                            ? a.heroIdCandidate
                            : Number.MAX_SAFE_INTEGER;

                    const bid =
                        Number.isFinite(
                            b?.heroIdCandidate
                        )
                            ? b.heroIdCandidate
                            : Number.MAX_SAFE_INTEGER;


                    return (
                        aid - bid ||
                        String(
                            a?.name ||
                            ''
                        ).localeCompare(
                            String(
                                b?.name ||
                                ''
                            )
                        )
                    );
                }
            );


        const rarityClassification =
            applyHeroRarityClassification(
                rawItems
            );


        const items =
            rarityClassification.items;


        return {
            ok:
                items.length >
                0,

            reason:
                items.length
                    ? undefined
                    : '영웅 카드를 읽지 못했습니다.',

            collectedAt:
                new Date()
                    .toISOString(),

            count:
                items.length,

            raritySummary:
                rarityClassification.summary,

            scrollSupported:
                !!scrollInfo?.component,

            scrollView: {
                path:
                    scrollInfo?.path ||
                    null,

                contentPath:
                    scrollInfo?.contentPath ||
                    null,

                vertical:
                    scrollInfo?.component
                        ?.vertical ??
                    null
            },

            samples,

            items
        };
    }



    /* ============================================================
     * HERO DETAIL SALE COLLECTOR
     *
     * 흐름:
     * 영웅 목록 -> 첫 보유 영웅 상세
     * -> 특성 -> 타이탄 장비 -> 각성
     * -> 다음 영웅
     * -> 전체 완료 후 영웅 상세 / 영웅 목록 닫기
     *
     * 읽기 전용 원칙:
     * - 특성 습득/교환 버튼 호출 금지
     * - 타이탄 편집/프로필 호출 금지
     * - 각성 레벨업/승격 호출 금지
     * ============================================================ */


    function saleUniqueStrings(
        values
    ) {

        const result =
            [];

        const seen =
            new Set();


        for (
            const value
            of (
                values ||
                []
            )
        ) {

            const text =
                String(
                    value ??
                    ''
                )
                    .replace(
                        /<[^>]*>/g,
                        ''
                    )
                    .replace(
                        /&nbsp;/gi,
                        ' '
                    )
                    .replace(
                        /\s+/g,
                        ' '
                    )
                    .trim();


            if (
                !text ||
                seen.has(
                    text
                )
            )
                continue;


            seen.add(
                text
            );

            result.push(
                text
            );
        }


        return result;
    }


    function saleTextBy(
        rows,
        predicate
    ) {

        const row =
            (
                rows ||
                []
            ).find(
                predicate
            );


        return (
            row?.text ||
            ''
        );
    }


    function saleFindNodes(
        root,
        predicate,
        options = {}
    ) {

        const result =
            [];


        if (!root)
            return result;


        const includeInactive =
            options.includeInactive ===
            true;


        const visit =
            node => {

                if (!node)
                    return;


                if (
                    (
                        includeInactive ||
                        isActive(
                            node
                        )
                    ) &&
                    predicate(
                        node
                    )
                ) {

                    result.push(
                        node
                    );
                }


                for (
                    const child
                    of (
                        node.children ||
                        []
                    )
                ) {

                    visit(
                        child
                    );
                }
            };


        visit(
            root
        );


        return result;
    }


    function saleFindButtonRow(
        predicate
    ) {

        if (
            typeof gameButtonRows !==
            'function'
        )
            return null;


        return (
            gameButtonRows()
                .find(
                    predicate
                ) ||
            null
        );
    }


    const SALE_VISIBLE_STABLE_MS =
        650;

    const SALE_VISIBLE_POLL_MS =
        80;


    function saleNodeIsVisiblyActive(
        node
    ) {

        if (!node)
            return false;


        /*
         * Cocos 2.4.x에서는 부모 opacity가 0이어도
         * cascadeOpacity 설정/렌더 구조에 따라 자식 UI가 실제 표시될 수 있다.
         *
         * 따라서 opacity는 "보임" 판정에 사용하지 않는다.
         * 실제 화면 진입 여부는 activeInHierarchy + 안정 시간 +
         * 필요 시 readyCheck(콘텐츠 생성 완료)로 판단한다.
         */
        for (
            let current = node;
            current;
            current = current.parent
        ) {

            if (
                current.active ===
                    false ||
                current.activeInHierarchy ===
                    false
            ) {

                return false;
            }


            if (
                current ===
                scene()
            )
                break;
        }


        return true;
    }


    async function saleWaitForNode(
        name,
        options = {}
    ) {

        const timeout =
            Math.max(
                100,
                Number(
                    options.timeout ??
                    3200
                )
            );

        const minVisibleMs =
            Math.max(
                0,
                Number(
                    options.minVisibleMs ??
                    options.visibleStableMs ??
                    SALE_VISIBLE_STABLE_MS
                )
            );

        const pollMs =
            Math.max(
                30,
                Number(
                    options.pollMs ??
                    SALE_VISIBLE_POLL_MS
                )
            );


        /*
         * timeout은 "화면이 나타날 때까지"의 시간으로 취급하고,
         * 일단 나타난 후에는 minVisibleMs를 채울 시간을 추가로 허용한다.
         */
        const searchDeadline =
            Date.now() +
            timeout;

        const hardDeadline =
            searchDeadline +
            minVisibleMs +
            pollMs * 2;


        let visibleSince =
            0;


        while (
            !disposed &&
            Date.now() <
                hardDeadline
        ) {

            const node =
                findActiveNodeByName(
                    name
                );


            const visible =
                saleNodeIsVisiblyActive(
                    node
                );


            let ready =
                visible;


            if (
                ready &&
                typeof options.readyCheck ===
                    'function'
            ) {

                try {

                    ready =
                        options.readyCheck(
                            node
                        ) !== false;

                } catch {

                    ready =
                        false;
                }
            }


            /*
             * Cocos 가상/동적 UI는 화면이 유지되는 동안에도 같은 이름의
             * Node 객체 자체를 교체할 수 있다.
             *
             * 따라서 객체 identity가 아니라 "동일 의미의 화면이 계속 준비됨"
             * 상태만 안정 시간 동안 유지되면 준비 완료로 판정한다.
             */
            if (ready) {

                if (!visibleSince) {

                    visibleSince =
                        Date.now();
                }


                if (
                    Date.now() -
                    visibleSince >=
                    minVisibleMs
                ) {

                    /*
                     * 안정 시간이 지난 시점의 최신 live node를 반환한다.
                     */
                    return (
                        findActiveNodeByName(
                            name
                        ) ||
                        node
                    );
                }

            } else {

                visibleSince =
                    0;


                if (
                    Date.now() >=
                    searchDeadline
                ) {

                    return null;
                }
            }


            await saleSleep(
                pollMs
            );
        }


        return null;
    }


    function salePanelFrame(
        root
    ) {

        if (!root)
            return null;


        for (
            let node = root;
            node && node !== scene();
            node = node.parent
        ) {

            if (
                /^UIFrame/
                    .test(
                        String(
                            node.name ||
                            ''
                        )
                    )
            ) {

                return node;
            }
        }


        return null;
    }


    function saleCloseRowScore(
        row,
        root,
        scope
    ) {

        if (
            !row?.enabled ||
            !row?.supported
        )
            return -1;


        if (
            scope &&
            !withinGameRoot(
                row.node,
                scope
            )
        )
            return -1;


        const path =
            String(
                row.path ||
                ''
            );

        const name =
            String(
                row.name ||
                ''
            );

        const handlers =
            (
                row.events ||
                []
            ).map(
                event =>
                    String(
                        event?.handler ||
                        ''
                    )
            );


        const closeHandler =
            handlers.some(
                handler =>
                    /^(?:close|closeBtnClick|onCloseClick|onClickClose|onBtnClose|onClose|closePanel|hide|onBack|onClickBack|onBtnBack)$/
                        .test(
                            handler
                        )
            );


        const closeName =
            /^(?:CLOSE|close|btn_close|closeBtn|btnClose|back|btn_back|backBtn)$/i
                .test(
                    name
                );


        if (
            !closeHandler &&
            !closeName
        )
            return -1;


        let score =
            0;


        if (
            /^CLOSE$/i.test(
                name
            )
        )
            score += 1200;

        if (
            /^(?:btn_close|closeBtn|close)$/i
                .test(
                    name
                )
        )
            score += 1000;

        if (
            closeHandler
        )
            score += 700;

        if (
            root &&
            withinGameRoot(
                row.node,
                root
            )
        )
            score += 300;

        if (
            /\/CLOSE$/i.test(
                path
            )
        )
            score += 200;


        return score;
    }


    async function closeSalePanelByName(
        name,
        options = {}
    ) {

        let root =
            findActiveNodeByName(
                name
            );


        if (!root) {

            return {
                ok: true,
                alreadyClosed:
                    true,
                panel:
                    name
            };
        }


        const timeout =
            Math.max(
                300,
                Number(
                    options.timeout ??
                    2200
                )
            );


        const scopes =
            [
                root,
                salePanelFrame(
                    root
                )
            ]
                .filter(
                    Boolean
                );


        for (
            const scope
            of scopes
        ) {

            const candidates =
                (
                    typeof gameButtonRows ===
                        'function'
                        ? gameButtonRows()
                        : []
                )
                    .map(
                        row => ({
                            row,
                            score:
                                saleCloseRowScore(
                                    row,
                                    root,
                                    scope
                                )
                        })
                    )
                    .filter(
                        item =>
                            item.score >=
                            0
                    )
                    .sort(
                        (a, b) =>
                            b.score -
                            a.score
                    );


            if (
                candidates.length
            ) {

                const target =
                    candidates[0].row;


                try {

                    await pressGameButton(
                        target.id,
                        {
                            waitMs:
                                200
                        }
                    );

                } catch {}


                const deadline =
                    Date.now() +
                    timeout;


                root =
                    findActiveNodeByName(
                        name
                    );


                while (
                    !disposed &&
                    root &&
                    Date.now() <
                        deadline
                ) {

                    await saleSleep(
                        80
                    );


                    root =
                        findActiveNodeByName(
                            name
                        );
                }


                if (!root) {

                    return {
                        ok: true,
                        panel:
                            name,
                        method:
                            'button',
                        target:
                            describeGameButton(
                                target
                            )
                    };
                }
            }
        }


        /*
         * Button을 특정하지 못하는 화면은 컴포넌트의 명시적
         * close/back 계열 메서드만 fallback으로 허용한다.
         */
        root =
            findActiveNodeByName(
                name
            );


        if (root) {

            const methodNames = [
                'close',
                'closeBtnClick',
                'onCloseClick',
                'onClickClose',
                'onBtnClose',
                'onClose',
                'closePanel',
                'hide',
                'onBack',
                'onClickBack',
                'onBtnBack'
            ];


            const methodRoots =
                [
                    root,
                    salePanelFrame(
                        root
                    )
                ]
                    .filter(
                        Boolean
                    );


            for (
                const methodRoot
                of methodRoots
            ) {

                for (
                    const component
                    of (
                        methodRoot
                            ?._components ||
                        []
                    )
                ) {

                    for (
                        const methodName
                        of methodNames
                    ) {

                        if (
                            typeof component?.[
                                methodName
                            ] !==
                            'function'
                        )
                            continue;


                        try {

                            component[
                                methodName
                            ].call(
                                component
                            );

                        } catch {

                            continue;
                        }


                        const deadline =
                            Date.now() +
                            timeout;


                        let current =
                            findActiveNodeByName(
                                name
                            );


                        while (
                            !disposed &&
                            current &&
                            Date.now() <
                                deadline
                        ) {

                            await saleSleep(
                                80
                            );


                            current =
                                findActiveNodeByName(
                                    name
                                );
                        }


                        if (!current) {

                            return {
                                ok: true,
                                panel:
                                    name,
                                method:
                                    `component.${methodName}`,
                                component:
                                    componentName(
                                        component
                                    )
                            };
                        }
                    }
                }
            }
        }


        return {
            ok: false,
            panel:
                name,
            reason:
                `${name} 닫기 실패`
        };
    }


    function findHeroDetailRoot() {

        return findActiveNodeByName(
            'HeroDetailPopup2024'
        );
    }


    function readHeroDetailIdentity() {

        const root =
            findHeroDetailRoot();


        if (!root) {

            return {
                ok: false,
                name:
                    '',
                tags:
                    [],
                tag:
                    null,
                level:
                    null,
                levelText:
                    '',
                power:
                    null,
                powerText:
                    ''
            };
        }


        const rows =
            collectTextsUnderNode(
                root,
                500
            );


        const name =
            saleTextBy(
                rows,
                row =>
                    row.name ===
                        'heroName' &&
                    /HeroDetailNameNode/
                        .test(
                            row.path ||
                            ''
                        )
            );


        const tags =
            saleUniqueStrings(
                rows
                    .filter(
                        row =>
                            row.name ===
                                'heroTag' &&
                            /HeroDetailNameNode/
                                .test(
                                    row.path ||
                                    ''
                                )
                    )
                    .map(
                        row =>
                            row.text
                    )
            );


        const levelText =
            saleTextBy(
                rows,
                row =>
                    row.name ===
                        'heroLevelLabel'
            );


        /*
         * HeroPowerUI는 전투력 숫자를 한 자리씩 여러 cc.Label로
         * 출력한다. 활성 Label의 순서를 유지한 채 이어 붙인다.
         */
        const powerDigits =
            rows
                .filter(
                    row =>
                        row.name ===
                            'num' &&
                        /HeroDetailNameNode\/powernode\/numlayout\/powerLab\/num$/
                            .test(
                                row.path ||
                                ''
                            )
                )
                .map(
                    row =>
                        String(
                            row.text ||
                            ''
                        )
                            .replace(
                                /\D/g,
                                ''
                            )
                )
                .filter(
                    Boolean
                );


        const powerText =
            powerDigits.join(
                ''
            );


        return {
            ok:
                !!name,
            name,
            tags,
            tag:
                tags[0] ||
                null,
            levelText,
            level:
                parseNumberText(
                    levelText
                ),
            powerText,
            power:
                powerText
                    ? Number(
                        powerText
                    )
                    : null
        };
    }


    function collectCurrentHeroSkills() {

        const detailRoot =
            findHeroDetailRoot();


        if (!detailRoot) {

            return {
                ok: false,
                available:
                    false,
                reason:
                    'HeroDetailPopup2024 없음',
                count:
                    0,
                items:
                    []
            };
        }


        const skillRoot =
            findActiveNodeByName(
                'HeroDetailSkillNode'
            );


        if (!skillRoot) {

            return {
                ok: true,
                available:
                    false,
                reason:
                    'HeroDetailSkillNode 없음',
                count:
                    0,
                items:
                    []
            };
        }


        const skillNodes =
            saleFindNodes(
                skillRoot,
                node =>
                    node.name ===
                        'skill' &&
                    /HeroDetailSkillNode\/skillsnode\/skillsnode\/skill$/
                        .test(
                            nodePath(
                                node
                            )
                        )
            );


        const items =
            [];


        for (
            let index = 0;
            index < skillNodes.length;
            index += 1
        ) {

            const node =
                skillNodes[index];

            const rows =
                collectTextsUnderNode(
                    node,
                    80
                );


            const levelText =
                saleTextBy(
                    rows,
                    row =>
                        row.name ===
                        'LabLevel'
                );


            /*
             * LabLevel이 없는 활성 skill 노드는 빈 슬롯일 수 있으므로
             * 실제 판매 정보에서는 제외한다.
             */
            if (!levelText)
                continue;


            items.push({
                slot:
                    items.length + 1,
                nodeIndex:
                    index,
                levelText,
                level:
                    parseNumberText(
                        levelText
                    ),
                path:
                    nodePath(
                        node
                    )
            });
        }


        /*
         * 현재 화면에서 직접 보이지 않는 내부 ID 후보가 있으면
         * 이미지/텍스처는 건드리지 않고 primitive 필드만 보조 저장.
         */
        const componentData =
            compactRelevantComponentFields(
                skillRoot,
                /Skill/i,
                /(id|skill|level|lv|hero|group|index|slot|type|select|current)/i
            )
                .slice(
                    0,
                    20
                );


        return {
            ok: true,
            available:
                true,
            count:
                items.length,
            items,
            componentData
        };
    }


    function findHeroDetailButton(
        options = {}
    ) {

        const root =
            findHeroDetailRoot();


        if (!root)
            return null;


        const pathIncludes =
            options.pathIncludes ||
            '';

        const name =
            options.name;

        const handler =
            options.handler;

        const text =
            options.text;


        return saleFindButtonRow(
            row => {

                if (
                    !row?.enabled ||
                    !row?.supported ||
                    !withinGameRoot(
                        row.node,
                        root
                    )
                )
                    return false;


                if (
                    name != null &&
                    row.name !==
                        name
                )
                    return false;


                if (
                    text != null &&
                    row.text !==
                        text
                )
                    return false;


                if (
                    pathIncludes &&
                    !String(
                        row.path ||
                        ''
                    ).includes(
                        pathIncludes
                    )
                )
                    return false;


                if (
                    handler &&
                    !(
                        row.events ||
                        []
                    ).some(
                        event =>
                            event?.handler ===
                            handler
                    )
                )
                    return false;


                return true;
            }
        );
    }


    async function selectHeroDetailToggle(
        name,
        options = {}
    ) {

        const row =
            findHeroDetailButton({
                name,
                handler:
                    'onToggleClick'
            });


        if (!row) {

            return {
                ok: false,
                available:
                    false,
                reason:
                    `${name} 탭 없음`
            };
        }


        if (
            row.checked ===
            true
        ) {

            return {
                ok: true,
                available:
                    true,
                alreadySelected:
                    true
            };
        }


        const pressed =
            await pressGameButton(
                row.id,
                {
                    waitMs:
                        options.waitMs ??
                        220
                }
            );


        return {
            ok:
                !!pressed?.ok,
            available:
                true,
            detail:
                pressed
        };
    }


    function compactRelevantComponentFields(
        root,
        componentPattern,
        keyPattern
    ) {

        const result =
            [];


        if (!root)
            return result;


        const nodes =
            saleFindNodes(
                root,
                () => true
            );


        for (
            const node
            of nodes
        ) {

            for (
                const component
                of (
                    node?._components ||
                    []
                )
            ) {

                const name =
                    componentName(
                        component
                    );


                if (
                    !componentPattern
                        .test(
                            name
                        )
                )
                    continue;


                const fields =
                    primitiveComponentFields(
                        component,
                        {
                            maxFields:
                                80
                        }
                    );

                const compact =
                    {};


                for (
                    const [
                        key,
                        value
                    ]
                    of Object.entries(
                        fields
                    )
                ) {

                    if (
                        keyPattern
                            .test(
                                key
                            )
                    ) {

                        compact[key] =
                            value;
                    }
                }


                if (
                    Object.keys(
                        compact
                    ).length
                ) {

                    result.push({
                        node:
                            node.name ||
                            '',
                        path:
                            nodePath(
                                node
                            ),
                        component:
                            name,
                        fields:
                            compact
                    });
                }


                if (
                    result.length >=
                    24
                )
                    return result;
            }
        }


        return result;
    }


    async function waitForHeroDetailReady(
        options = {}
    ) {

        const timeout =
            Math.max(
                800,
                Number(
                    options.timeout ??
                    3600
                )
            );

        const stableMs =
            Math.max(
                250,
                Number(
                    options.stableMs ??
                    options.screenVisibleStableMs ??
                    650
                )
            );

        const pollMs =
            Math.max(
                60,
                Number(
                    options.pollMs ??
                    100
                )
            );

        const differentFrom =
            String(
                options.differentFrom ??
                ''
            ).trim();


        const expectedName =
            String(
                options.expectedName ??
                ''
            ).trim();


        const deadline =
            Date.now() +
            timeout;


        let stableName =
            '';

        let stableSince =
            0;

        let lastIdentity =
            null;


        while (
            !disposed &&
            Date.now() <
                deadline
        ) {

            const root =
                findHeroDetailRoot();


            if (!root) {

                stableName =
                    '';

                stableSince =
                    0;

                await saleSleep(
                    pollMs
                );

                continue;
            }


            let identity =
                null;


            try {

                identity =
                    readHeroDetailIdentity();

            } catch (
                error
            ) {

                lastIdentity = {
                    ok: false,
                    error:
                        error?.message ||
                        String(
                            error
                        )
                };

                stableName =
                    '';

                stableSince =
                    0;

                await saleSleep(
                    pollMs
                );

                continue;
            }


            lastIdentity =
                identity;


            const name =
                String(
                    identity?.name ||
                    ''
                ).trim();


            if (
                !name ||
                (
                    differentFrom &&
                    name ===
                        differentFrom
                ) ||
                (
                    expectedName &&
                    name !==
                        expectedName
                )
            ) {

                stableName =
                    '';

                stableSince =
                    0;

                await saleSleep(
                    pollMs
                );

                continue;
            }


            if (
                name !==
                stableName
            ) {

                stableName =
                    name;

                stableSince =
                    Date.now();

            } else if (
                Date.now() -
                    stableSince >=
                stableMs
            ) {

                return {
                    ok: true,
                    root,
                    identity,
                    stableMs,
                    waitedMs:
                        timeout -
                        Math.max(
                            0,
                            deadline -
                            Date.now()
                        )
                };
            }


            await saleSleep(
                pollMs
            );
        }


        return {
            ok: false,
            reason:
                expectedName
                    ? `영웅 상세가 ${expectedName}(으)로 안정화되지 않음`
                    : (
                        differentFrom
                            ? `영웅 상세가 ${differentFrom}에서 다음 영웅으로 안정화되지 않음`
                            : '영웅 상세 이름이 안정적으로 표시되지 않음'
                      ),
            identity:
                lastIdentity,
            stableName:
                stableName ||
                null
        };
    }


    async function openFirstOwnedHeroDetail(
        heroItems,
        options = {}
    ) {

        if (
            findHeroDetailRoot()
        ) {

            return {
                ok: true,
                alreadyOpen:
                    true
            };
        }


        const knownIds =
            new Set(
                (
                    heroItems ||
                    []
                )
                    .filter(
                        item =>
                            Number.isFinite(
                                item
                                    ?.heroIdCandidate
                            ) &&
                            Number.isFinite(
                                item
                                    ?.level
                            )
                    )
                    .map(
                        item =>
                            Number(
                                item
                                    .heroIdCandidate
                            )
                    )
            );


        const deadline =
            Date.now() +
            Math.max(
                600,
                Number(
                    options.timeout ??
                    3000
                )
            );


        let target =
            null;


        while (
            !disposed &&
            !target &&
            Date.now() <
                deadline
        ) {

            const candidates =
                (
                    typeof gameButtonRows ===
                        'function'
                        ? gameButtonRows()
                        : []
                )
                    .filter(
                        row => {

                            if (
                                !row?.enabled ||
                                !row?.supported ||
                                row.name !==
                                    'frameBg' ||
                                !/HeroListPopup2023/
                                    .test(
                                        row.path ||
                                        ''
                                    ) ||
                                !(
                                    row.events ||
                                    []
                                ).some(
                                    event =>
                                        event?.handler ===
                                        'onItemClick'
                                )
                            )
                                return false;


                            const match =
                                String(
                                    row.path ||
                                    ''
                                ).match(
                                    /itemSpecialContent\/(\d+)\/HeroListItem2026/
                                );


                            if (!match)
                                return false;


                            return knownIds.has(
                                Number(
                                    match[1]
                                )
                            );
                        }
                    );


            target =
                candidates[0] ||
                null;


            if (!target) {

                await saleSleep(
                    100
                );
            }
        }


        if (!target) {

            return {
                ok: false,
                reason:
                    '화면에 표시된 보유 영웅 카드의 onItemClick 버튼을 찾지 못했습니다.'
            };
        }


        const pressed =
            await pressGameButton(
                target.id,
                {
                    waitMs:
                        250
                }
            );


        if (!pressed?.ok) {

            return {
                ok: false,
                reason:
                    pressed?.reason ||
                    '첫 영웅 상세 진입 실패'
            };
        }


        /*
         * 클릭 직후 바로 노드를 읽지 않는다.
         * HeroDetailPopup2024가 생기고 heroName이 실제 표시된 뒤
         * 일정 시간 같은 이름이 유지될 때까지 기다린다.
         */
        const ready =
            await waitForHeroDetailReady({
                timeout:
                    options.timeout ??
                    4200,

                stableMs:
                    options.stableMs ??
                    650
            });


        return {
            ok:
                !!ready?.ok,
            reason:
                ready?.ok
                    ? null
                    : (
                        ready?.reason ||
                        'HeroDetailPopup2024 준비 실패'
                      ),
            identity:
                ready?.identity ||
                null,
            target:
                describeGameButton(
                    target
                )
        };
    }


    function findCurrentTraitPanel() {

        const named =
            findActiveNodeByName(
                'HeroStrengthenPanelNew'
            );


        if (
            named &&
            saleNodeIsVisiblyActive(
                named
            )
        ) {

            const hasTalentNode =
                !!findDescendantByName(
                    named,
                    'HeroTalentNode'
                );

            const hasTalentItem =
                saleFindNodes(
                    named,
                    node =>
                        node.name ===
                        'heroTalentItem'
                ).length >
                0;


            if (
                hasTalentNode ||
                hasTalentItem
            ) {

                return named;
            }
        }


        let found =
            null;


        walk(
            scene(),
            node => {

                if (
                    found ||
                    !isActive(
                        node
                    )
                )
                    return;


                const name =
                    String(
                        node?.name ||
                        ''
                    );


                if (
                    !/panel|popup|content|talent/i
                        .test(
                            name
                        )
                )
                    return;


                const hasTalentNode =
                    !!findDescendantByName(
                        node,
                        'HeroTalentNode'
                    );

                const hasTalentItem =
                    saleFindNodes(
                        node,
                        child =>
                            child.name ===
                            'heroTalentItem'
                    ).length >
                    0;


                if (
                    hasTalentNode ||
                    hasTalentItem
                ) {

                    found =
                        node;
                }
            }
        );


        return found;
    }


    async function waitForCurrentTraitPanel(
        options = {}
    ) {

        const timeout =
            Math.max(
                300,
                Number(
                    options.timeout ??
                    2600
                )
            );

        const stableMs =
            Math.max(
                0,
                Number(
                    options.stableMs ??
                    250
                )
            );

        const deadline =
            Date.now() +
            timeout;


        let readySince =
            0;


        while (
            !disposed &&
            Date.now() <
                deadline
        ) {

            const panel =
                findCurrentTraitPanel();


            if (panel) {

                if (!readySince)
                    readySince =
                        Date.now();


                if (
                    Date.now() -
                    readySince >=
                    stableMs
                ) {

                    return (
                        findCurrentTraitPanel() ||
                        panel
                    );
                }

            } else {

                readySince =
                    0;
            }


            await saleSleep(
                80
            );
        }


        return null;
    }


    async function collectCurrentHeroTraits(
        options = {}
    ) {

        /*
         * 진단 결과:
         * - HeroStrengthenPanelNew가 이미 열린 상태일 수 있음
         * - 내부 HeroTalentNode / heroTalentItem이 실제 특성 데이터의 근거
         *
         * 따라서:
         * 1) 이미 열린 특성 패널이 있으면 즉시 재사용
         * 2) 없을 때만 toggle3 -> detailBtn 실행
         * 3) 패널 이름 단독이 아니라 특성 내용 노드로 최종 판정
         */
        let panel =
            findCurrentTraitPanel();


        let openedByCollector =
            false;


        if (!panel) {

            const toggle =
                await selectHeroDetailToggle(
                    'toggle3',
                    options
                );


            if (
                toggle.available ===
                false
            ) {

                return {
                    ok: true,
                    available:
                        false,
                    reason:
                        '특성 탭 없음',
                    items:
                        []
                };
            }


            if (!toggle.ok) {

                return {
                    ok: false,
                    available:
                        true,
                    reason:
                        '특성 탭 선택 실패'
                };
            }


            const detailDeadline =
                Date.now() +
                Math.max(
                    800,
                    Number(
                        options.tabVisibleTimeout ??
                        2200
                    )
                );


            let detailButton =
                null;


            while (
                !disposed &&
                Date.now() <
                    detailDeadline
            ) {

                /*
                 * toggle3 전환 직후 패널이 이미 열렸다면
                 * detailBtn을 다시 누르지 않고 바로 사용.
                 */
                panel =
                    findCurrentTraitPanel();


                if (panel)
                    break;


                detailButton =
                    findHeroDetailButton({
                        name:
                            'detailBtn',
                        handler:
                            'detailsClick'
                    });


                if (detailButton)
                    break;


                await saleSleep(
                    100
                );
            }


            if (
                !panel &&
                !detailButton
            ) {

                return {
                    ok: false,
                    available:
                        true,
                    detailAvailable:
                        false,
                    reason:
                        '특성 detailBtn(detailsClick) 확인 실패',
                    items:
                        []
                };
            }


            if (!panel) {

                const pressed =
                    await pressGameButton(
                        detailButton.id,
                        {
                            waitMs:
                                350
                        }
                    );


                if (!pressed?.ok) {

                    return {
                        ok: false,
                        available:
                            true,
                        reason:
                            pressed?.reason ||
                            '특성 세부 사항 진입 실패'
                    };
                }


                openedByCollector =
                    true;


                panel =
                    await waitForCurrentTraitPanel({
                        timeout:
                            options.panelTimeout ??
                            2800,
                        stableMs:
                            options.traitPanelStableMs ??
                            250
                    });
            }
        }


        if (!panel) {

            return {
                ok: false,
                available:
                    true,
                reason:
                    '특성 패널 확인 실패: HeroTalentNode/heroTalentItem 없음'
            };
        }


        let result;


        try {

            const allTexts =
                collectTextsUnderNode(
                    panel,
                    500
                );


            const talentTexts =
                allTexts.filter(
                    row =>
                        /\/Talentnode\/HeroTalentNode\//
                            .test(
                                row.path ||
                                ''
                            )
                );


            const equipped =
                saleUniqueStrings(
                    talentTexts
                        .filter(
                            row =>
                                /\/talentnode\/talent\/skill\/name$/
                                    .test(
                                        row.path ||
                                        ''
                                    )
                        )
                        .map(
                            row =>
                                row.text
                        )
                );


            const itemNodes =
                saleFindNodes(
                    panel,
                    node =>
                        node.name ===
                        'heroTalentItem'
                );


            const items =
                itemNodes
                    .map(
                        node => {

                            const rows =
                                collectTextsUnderNode(
                                    node,
                                    80
                                );


                            const name =
                                saleTextBy(
                                    rows,
                                    row =>
                                        row.name ===
                                        'Itemname'
                                )
                                ||
                                saleTextBy(
                                    rows,
                                    row =>
                                        row.name ===
                                            'name'
                                );


                            const addText =
                                saleTextBy(
                                    rows,
                                    row =>
                                        row.name ===
                                        'addNum'
                                );


                            const progressTexts =
                                saleUniqueStrings(
                                    rows
                                        .filter(
                                            row =>
                                                /\d+\s*\/\s*\d+/
                                                    .test(
                                                        row.text ||
                                                        ''
                                                    )
                                        )
                                        .map(
                                            row =>
                                                row.text
                                        )
                                );


                            let componentData =
                                null;


                            for (
                                const component
                                of (
                                    node
                                        ?._components ||
                                    []
                                )
                            ) {

                                if (
                                    componentName(
                                        component
                                    ) ===
                                    'HeroTalentItem'
                                ) {

                                    const fields =
                                        primitiveComponentFields(
                                            component,
                                            {
                                                maxFields:
                                                    100
                                            }
                                        );


                                    componentData = {};


                                    for (
                                        const [
                                            key,
                                            value
                                        ]
                                        of Object.entries(
                                            fields
                                        )
                                    ) {

                                        if (
                                            /(id|hero|talent|level|lv|value|num|quality|grade|rank|type|state|lock|own|have)/i
                                                .test(
                                                    key
                                                )
                                        ) {

                                            componentData[
                                                key
                                            ] = value;
                                        }
                                    }
                                }
                            }


                            return {
                                name:
                                    name ||
                                    null,
                                addText:
                                    addText ||
                                    null,
                                addValue:
                                    parseNumberText(
                                        addText
                                    ),
                                progressTexts,
                                texts:
                                    saleUniqueStrings(
                                        rows.map(
                                            row =>
                                                row.text
                                        )
                                    ).slice(
                                        0,
                                        16
                                    ),
                                componentData
                            };
                        }
                    )
                    .filter(
                        item =>
                            item.name ||
                            item.addText ||
                            item.progressTexts
                                .length ||
                            item.componentData
                    );


            result = {
                ok: true,
                available:
                    true,
                detailAvailable:
                    true,
                equipped,
                items,
                textCount:
                    talentTexts.length
            };

        } finally {

            if (
                openedByCollector
            ) {

                await closeSalePanelByName(
                    'HeroStrengthenPanelNew',
                    {
                        timeout:
                            options.closeTimeout ??
                            2200
                    }
                );


                await saleWaitForNode(
                    'HeroDetailPopup2024',
                    {
                        timeout:
                            options.returnVisibleTimeout ??
                            1800,

                        minVisibleMs:
                            options.returnVisibleStableMs ??
                            450
                    }
                );
            }
        }


        return result;
    }


    function collectTitanDetailData(
        slot
    ) {

        const root =
            findActiveNodeByName(
                'HeroEquipDetailPop'
            );


        if (!root) {

            return {
                ok: false,
                slot,
                reason:
                    'HeroEquipDetailPop 없음'
            };
        }


        const rows =
            collectTextsUnderNode(
                root,
                420
            );


        const name =
            saleTextBy(
                rows,
                row =>
                    row.name ===
                        'labName' &&
                    /\/titleNode\/New Layout\/labName$/
                        .test(
                            row.path ||
                            ''
                        )
            );


        const levelText =
            saleTextBy(
                rows,
                row =>
                    row.name ===
                        'lVLab'
            );


        const score =
            {};


        for (
            const type
            of [
                'land',
                'navy',
                'air'
            ]
        ) {

            const value =
                saleTextBy(
                    rows,
                    row =>
                        new RegExp(
                            `/scoreNode/${type}/scoreLabel$`
                        ).test(
                            row.path ||
                            ''
                        )
                );


            if (value) {

                score[type] =
                    parseNumberText(
                        value
                    );
            }
        }


        const optionGroup =
            section => {

                const names =
                    rows.filter(
                        row =>
                            row.name ===
                                'buffdes' &&
                            String(
                                row.path ||
                                ''
                            ).includes(
                                `/${section}/`
                            )
                    );

                const values =
                    rows.filter(
                        row =>
                            (
                                row.name ===
                                    'num1' ||
                                row.name ===
                                    'num2'
                            ) &&
                            String(
                                row.path ||
                                ''
                            ).includes(
                                `/${section}/`
                            )
                    );


                return {
                    names:
                        saleUniqueStrings(
                            names.map(
                                row =>
                                    row.text
                            )
                        ),
                    values:
                        saleUniqueStrings(
                            values.map(
                                row =>
                                    row.text
                            )
                        )
                };
            };


        const effectName =
            saleTextBy(
                rows,
                row =>
                    row.name ===
                        'effectName'
            );


        const effectTexts =
            saleUniqueStrings(
                rows
                    .filter(
                        row =>
                            /\/effectNode\//
                                .test(
                                    row.path ||
                                    ''
                                ) &&
                            (
                                row.type ===
                                    'cc.RichText' ||
                                row.name ===
                                    'RICHTEXT_CHILD'
                            )
                    )
                    .map(
                        row =>
                            row.text
                    )
            );


        const magicStoneCandidates =
            saleUniqueStrings(
                rows
                    .filter(
                        row =>
                            /(마석|magic.?stone|stone|gem|chip|crystal|moshi|mashi)/i
                                .test(
                                    [
                                        row.name,
                                        row.path,
                                        row.text
                                    ]
                                        .filter(
                                            Boolean
                                        )
                                        .join(
                                            ' '
                                        )
                                )
                    )
                    .map(
                        row =>
                            row.text
                    )
            );


        const componentData =
            compactRelevantComponentFields(
                root,
                /(HeroEquip|Equip|PropItem)/i,
                /(id|uid|level|lv|quality|grade|rank|type|part|slot|hero|stone|gem|chip|magic|crystal|buff|effect)/i
            );


        const qualityCandidates =
            [];


        for (
            const row
            of componentData
        ) {

            for (
                const [
                    key,
                    value
                ]
                of Object.entries(
                    row.fields ||
                    {}
                )
            ) {

                if (
                    /(quality|grade|rank)/i
                        .test(
                            key
                        )
                ) {

                    qualityCandidates.push({
                        component:
                            row.component,
                        key,
                        value
                    });
                }
            }
        }


        return {
            ok: true,
            slot,
            equipped:
                !!name ||
                !!levelText,
            name:
                name ||
                null,
            levelText:
                levelText ||
                null,
            level:
                parseNumberText(
                    levelText
                ),
            score,
            baseOptions:
                optionGroup(
                    'basebuffNode'
                ),
            randomOptions:
                optionGroup(
                    'randBuffNode'
                ),
            specialEffect: {
                name:
                    effectName ||
                    null,
                texts:
                    effectTexts
            },
            qualityCandidates,
            magicStoneCandidates,
            componentData:
                componentData.slice(
                    0,
                    12
                )
        };
    }


    async function collectCurrentHeroTitan(
        options = {}
    ) {

        const entry =
            findHeroDetailButton({
                name:
                    'btn_heroEquip',
                handler:
                    'onClickHeroEquipBtn'
            });


        if (!entry) {

            return {
                ok: true,
                available:
                    false,
                reason:
                    '타이탄 장비 진입 버튼 없음',
                slots:
                    []
            };
        }


        const pressed =
            await pressGameButton(
                entry.id,
                {
                    waitMs:
                        250
                }
            );


        if (!pressed?.ok) {

            return {
                ok: false,
                available:
                    true,
                reason:
                    pressed?.reason ||
                    '타이탄 장비 진입 실패'
            };
        }


        const panel =
            await saleWaitForNode(
                'HeroEquipWearPanel',
                {
                    timeout:
                        options.panelTimeout ??
                        3000,

                    minVisibleMs:
                        options.screenVisibleStableMs ??
                        SALE_VISIBLE_STABLE_MS
                }
            );


        if (!panel) {

            /*
             * 버튼이 존재해도 요구 레벨이 부족한 영웅은
             * 실제 장비 화면이 열리지 않을 수 있다.
             */
            return {
                ok: true,
                available:
                    false,
                reason:
                    'HeroEquipWearPanel 미표시',
                slots:
                    []
            };
        }


        const slots =
            [];


        try {

            for (
                let slot = 1;
                slot <= 6;
                slot += 1
            ) {

                const slotText =
                    String(
                        slot
                    ).padStart(
                        2,
                        '0'
                    );


                const slotStep =
                    await runCollectorStepWithRetries(
                        `타이탄 ${slotText}번 부위`,
                        async () => {

                            if (
                                findActiveNodeByName(
                                    'HeroEquipDetailPop'
                                )
                            ) {

                                await closeSalePanelByName(
                                    'HeroEquipDetailPop'
                                );
                            }


                            const liveRow =
                                saleFindButtonRow(
                                    row =>
                                        row?.enabled &&
                                        row?.supported &&
                                        new RegExp(
                                            `/HeroEquipWearPanel/wearNode/ui/${slotText}/Item$`
                                        ).test(
                                            row.path ||
                                            ''
                                        ) &&
                                        (
                                            row.events ||
                                            []
                                        ).some(
                                            event =>
                                                event?.handler ===
                                                'onItemClick'
                                        )
                                );


                            if (!liveRow) {

                                return {
                                    ok: true,
                                    slot,
                                    equipped:
                                        false,
                                    reason:
                                        '착용 장비 없음'
                                };
                            }


                            const openResult =
                                await pressGameButton(
                                    liveRow.id,
                                    {
                                        waitMs:
                                            180
                                    }
                                );


                            if (!openResult?.ok) {

                                return {
                                    ok: false,
                                    slot,
                                    reason:
                                        openResult?.reason ||
                                        '장비 상세 버튼 실행 실패'
                                };
                            }


                            const detail =
                                await saleWaitForNode(
                                    'HeroEquipDetailPop',
                                    {
                                        timeout:
                                            options.detailTimeout ??
                                            2200,

                                        minVisibleMs:
                                            options.screenVisibleStableMs ??
                                            SALE_VISIBLE_STABLE_MS
                                    }
                                );


                            if (!detail) {

                                if (
                                    !String(
                                        liveRow.text ||
                                        ''
                                    ).trim()
                                ) {

                                    return {
                                        ok: true,
                                        slot,
                                        equipped:
                                            false,
                                        reason:
                                            '착용 장비 없음'
                                    };
                                }


                                return {
                                    ok: false,
                                    slot,
                                    reason:
                                        'HeroEquipDetailPop 확인 실패'
                                };
                            }


                            const data =
                                collectTitanDetailData(
                                    slot
                                );


                            await closeSalePanelByName(
                                'HeroEquipDetailPop',
                                {
                                    timeout:
                                        options.closeTimeout ??
                                        1800
                                }
                            );


                            return data;
                        },
                        {
                            maxRetries:
                                options.maxRetries ??
                                3,
                            retryDelay:
                                options.retryDelay ??
                                350,
                            isSuccess:
                                value =>
                                    value?.ok ===
                                    true
                        }
                    );


                const slotData =
                    slotStep.value || {
                        ok: false,
                        slot,
                        reason:
                            slotStep.reason ||
                            '장비 수집 실패'
                    };


                slots.push({
                    ...slotData,
                    attempts:
                        slotStep
                            .attempts
                });
            }


            return {
                ok:
                    slots.every(
                        item =>
                            item.ok ===
                            true
                    ),
                available:
                    true,
                equippedCount:
                    slots.filter(
                        item =>
                            item.equipped
                    ).length,
                slots
            };

        } finally {

            if (
                findActiveNodeByName(
                    'HeroEquipDetailPop'
                )
            ) {

                await closeSalePanelByName(
                    'HeroEquipDetailPop'
                );
            }


            await closeSalePanelByName(
                'HeroEquipWearPanel',
                {
                    timeout:
                        options.closeTimeout ??
                        2200
                }
            );


            await saleWaitForNode(
                'HeroDetailPopup2024',
                {
                    timeout:
                        options.returnVisibleTimeout ??
                        1800,

                    minVisibleMs:
                        options.returnVisibleStableMs ??
                        450
                }
            );
        }
    }


    function awakenEffectTexts(
        rows,
        copyOnly = null
    ) {

        const selected =
            (
                rows ||
                []
            ).filter(
                row => {

                    const path =
                        String(
                            row.path ||
                            ''
                        );


                    if (
                        !/\/basebuffNode(?: copy)?\/layout\/desc\/lbl/
                            .test(
                                path
                            )
                    )
                        return false;


                    if (
                        copyOnly ===
                        true &&
                        !/\/basebuffNode copy\//
                            .test(
                                path
                            )
                    )
                        return false;


                    if (
                        copyOnly ===
                        false &&
                        /\/basebuffNode copy\//
                            .test(
                                path
                            )
                    )
                        return false;


                    return (
                        row.type ===
                            'cc.RichText' ||
                        row.name ===
                            'RICHTEXT_CHILD'
                    );
                }
            );


        const rich =
            saleUniqueStrings(
                selected
                    .filter(
                        row =>
                            row.type ===
                            'cc.RichText'
                    )
                    .map(
                        row =>
                            row.text
                    )
            );


        if (
            rich.length
        )
            return rich;


        return saleUniqueStrings(
            selected.map(
                row =>
                    row.text
            )
        );
    }


    function compactAwakenInspection(
        inspected,
        fallback = {}
    ) {

        if (!inspected) {

            return {
                ok: false,
                ...fallback,
                reason:
                    '각성 스킬 조사 결과 없음'
            };
        }


        return {
            ok:
                !!inspected.ok,
            index:
                inspected.skill
                    ?.skillIndex ??
                fallback.index ??
                null,
            title:
                inspected.title ||
                fallback.title ||
                null,
            skillId:
                inspected.skill
                    ?.skillId ??
                null,
            heroId:
                inspected.skill
                    ?.heroId ??
                null,
            currentLevel:
                inspected.skill
                    ?.currentLevel ??
                fallback.currentLevel ??
                null,
            currentStage:
                inspected.stage
                    ?.current ??
                fallback.currentStage ??
                null,
            nextStage:
                inspected.stage
                    ?.next ??
                null,
            observedMaxStage:
                inspected.maxPreview
                    ?.observedMaxStage ??
                null,
            currentEffect:
                awakenEffectTexts(
                    inspected.texts,
                    false
                ),
            nextEffect:
                awakenEffectTexts(
                    inspected.texts,
                    true
                ),
            maxPreviewEffect:
                awakenEffectTexts(
                    inspected.maxPreview
                        ?.snapshot
                        ?.texts ||
                    [],
                    null
                ),
            unlockTexts:
                saleUniqueStrings(
                    (
                        inspected.unlockTexts ||
                        []
                    ).map(
                        row =>
                            row.text
                    )
                ),
            extraEffects:
                saleUniqueStrings(
                    (
                        inspected.extraEffects ||
                        []
                    ).map(
                        row =>
                            row.text
                    )
                ),
            restore: {
                restored:
                    inspected.maxPreview
                        ?.restored ??
                    true,
                restoreMode:
                    inspected.maxPreview
                        ?.restoreMode ??
                    null
            }
        };
    }


    async function collectCurrentHeroAwakening(
        options = {}
    ) {

        const toggle =
            await selectHeroDetailToggle(
                'toggle4',
                options
            );


        if (
            toggle.available ===
            false
        ) {

            return {
                ok: true,
                available:
                    false,
                reason:
                    '각성 탭 없음',
                level:
                    null,
                skills:
                    []
            };
        }


        if (!toggle.ok) {

            return {
                ok: false,
                available:
                    true,
                reason:
                    '각성 탭 선택 실패',
                skills:
                    []
            };
        }


        const root =
            await saleWaitForNode(
                'HeroDetailAwaken',
                {
                    timeout:
                        options.tabVisibleTimeout ??
                        2400,

                    minVisibleMs:
                        options.screenVisibleStableMs ??
                        SALE_VISIBLE_STABLE_MS
                }
            );


        if (!root) {

            return {
                ok: false,
                available:
                    true,
                reason:
                    'HeroDetailAwaken 확인 실패',
                skills:
                    []
            };
        }


        const mainTexts =
            collectTextsUnderNode(
                root,
                300
            );


        const awakenLevelText =
            saleTextBy(
                mainTexts,
                row =>
                    row.name ===
                        'labAwakenLevel' &&
                    /\/MainNode\/awakenedNode\/labAwakenLevel$/
                        .test(
                            row.path ||
                            ''
                        )
            );


        const skills =
            [];


        for (
            let index = 0;
            index < 4;
            index += 1
        ) {

            const skillNode =
                saleFindNodes(
                    root,
                    node =>
                        node.name ===
                            String(
                                index
                            ) &&
                        new RegExp(
                            `/Skillcontent1/${index}$`
                        ).test(
                            nodePath(
                                node
                            )
                        )
                )[0] ||
                null;


            if (!skillNode) {

                skills.push({
                    ok: true,
                    index,
                    available:
                        false,
                    unlocked:
                        false,
                    reason:
                        '각성 스킬 슬롯 없음'
                });

                continue;
            }


            const slotTexts =
                collectTextsUnderNode(
                    skillNode,
                    80
                );


            const currentLevelText =
                saleTextBy(
                    slotTexts,
                    row =>
                        row.name ===
                            'labLevel'
                );


            const lockText =
                saleTextBy(
                    slotTexts,
                    row =>
                        row.name ===
                            'labLockLevel'
                )
                ||
                saleTextBy(
                    slotTexts,
                    row =>
                        /도달 시 해제/
                            .test(
                                row.text ||
                                ''
                            )
                );


            const skillStep =
                await runCollectorStepWithRetries(
                    `각성 스킬 ${index + 1}`,
                    async () => {

                        if (
                            findActiveNodeByName(
                                'HeroAwakenSkillUpPop'
                            )
                        ) {

                            await closeSalePanelByName(
                                'HeroAwakenSkillUpPop'
                            );
                        }


                        const row =
                            saleFindButtonRow(
                                item =>
                                    item?.enabled &&
                                    item?.supported &&
                                    new RegExp(
                                        `/HeroDetailAwaken/MainNode/awakenedNode/Skillcontent1/${index}$`
                                    ).test(
                                        item.path ||
                                        ''
                                    ) &&
                                    (
                                        item.events ||
                                        []
                                    ).some(
                                        event =>
                                            event?.handler ===
                                            'onItemClick'
                                    )
                            );


                        if (!row) {

                            if (lockText) {

                                return {
                                    ok: true,
                                    available:
                                        true,
                                    index,
                                    unlocked:
                                        false,
                                    lockText,
                                    currentLevelText:
                                        currentLevelText ||
                                        null,
                                    currentStage:
                                        parseStageNumber(
                                            currentLevelText
                                        )
                                };
                            }


                            return {
                                ok: false,
                                index,
                                reason:
                                    '각성 스킬 onItemClick 버튼 없음'
                            };
                        }


                        await pressGameButton(
                            row.id,
                            {
                                waitMs:
                                    180
                            }
                        );


                        const popup =
                            await saleWaitForNode(
                                'HeroAwakenSkillUpPop',
                                {
                                    timeout:
                                        options.skillPopupTimeout ??
                                        1900,

                                    minVisibleMs:
                                        options.screenVisibleStableMs ??
                                        SALE_VISIBLE_STABLE_MS
                                }
                            );


                        if (!popup) {

                            if (lockText) {

                                return {
                                    ok: true,
                                    available:
                                        true,
                                    index,
                                    unlocked:
                                        false,
                                    lockText,
                                    currentLevelText:
                                        currentLevelText ||
                                        null,
                                    currentStage:
                                        parseStageNumber(
                                            currentLevelText
                                        )
                                };
                            }


                            return {
                                ok: false,
                                index,
                                reason:
                                    'HeroAwakenSkillUpPop 확인 실패'
                            };
                        }


                        const inspected =
                            await inspectAwakenSkillData({
                                includeMaxPreview:
                                    true
                            });


                        const compact =
                            compactAwakenInspection(
                                inspected,
                                {
                                    index,
                                    currentStage:
                                        parseStageNumber(
                                            currentLevelText
                                        )
                                }
                            );


                        if (
                            findActiveNodeByName(
                                'HeroAwakenSkillUpPop'
                            )
                        ) {

                            await closeSalePanelByName(
                                'HeroAwakenSkillUpPop'
                            );


                            await saleWaitForNode(
                                'HeroDetailAwaken',
                                {
                                    timeout:
                                        options.returnVisibleTimeout ??
                                        1600,

                                    minVisibleMs:
                                        options.returnVisibleStableMs ??
                                        400
                                }
                            );
                        }


                        return {
                            ...compact,
                            available:
                                true,
                            unlocked:
                                true,
                            lockText:
                                lockText ||
                                null
                        };
                    },
                    {
                        maxRetries:
                            options.maxRetries ??
                            3,
                        retryDelay:
                            options.retryDelay ??
                            350,
                        isSuccess:
                            value =>
                                value?.ok ===
                                true
                    }
                );


            skills.push({
                ...(
                    skillStep.value ||
                    {
                        ok: false,
                        index,
                        reason:
                            skillStep.reason ||
                            '각성 스킬 수집 실패'
                    }
                ),
                attempts:
                    skillStep
                        .attempts
            });
        }


        if (
            findActiveNodeByName(
                'HeroAwakenSkillUpPop'
            )
        ) {

            await closeSalePanelByName(
                'HeroAwakenSkillUpPop'
            );
        }


        await saleWaitForNode(
            'HeroDetailAwaken',
            {
                timeout:
                    options.returnVisibleTimeout ??
                    1600,

                minVisibleMs:
                    options.returnVisibleStableMs ??
                    400
            }
        );


        return {
            ok:
                skills.every(
                    skill =>
                        skill.ok ===
                        true
                ),
            available:
                true,
            levelText:
                awakenLevelText ||
                null,
            level:
                parseNumberText(
                    awakenLevelText
                ),
            skills
        };
    }


    async function moveToNextHeroDetail(
        previousName,
        options = {}
    ) {

        const next =
            findHeroDetailButton({
                name:
                    'btn_fanye_2',
                handler:
                    'onNextHeroClick',
                pathIncludes:
                    '/changeBtnsNode/'
            });


        if (!next) {

            return {
                ok: false,
                reason:
                    '다음 영웅 버튼 없음'
            };
        }


        const pressed =
            await pressGameButton(
                next.id,
                {
                    waitMs:
                        180
                }
            );


        if (!pressed?.ok) {

            return {
                ok: false,
                reason:
                    pressed?.reason ||
                    '다음 영웅 버튼 실행 실패'
            };
        }


        /*
         * 다음 영웅으로 이름이 바뀐 것만 확인하지 않고,
         * 바뀐 이름이 일정 시간 유지된 뒤에 다음 수집으로 넘긴다.
         */
        const ready =
            await waitForHeroDetailReady({
                timeout:
                    options.timeout ??
                    4200,

                stableMs:
                    options.stableMs ??
                    650,

                differentFrom:
                    previousName
            });


        return {
            ok:
                !!ready?.ok,
            reason:
                ready?.ok
                    ? null
                    : (
                        ready?.reason ||
                        '다음 영웅으로 변경되지 않음'
                      ),
            identity:
                ready?.identity ||
                null
        };
    }


    function findHeroListCardButtonById(
        heroId
    ) {

        const id =
            Number(
                heroId
            );


        if (!Number.isFinite(id))
            return null;


        const pattern =
            new RegExp(
                `/itemSpecialContent/${id}/HeroListItem2026(?:/|$)`
            );


        return (
            gameButtonRows()
                .find(
                    row =>
                        row?.enabled &&
                        row?.supported &&
                        row.name ===
                            'frameBg' &&
                        pattern.test(
                            String(
                                row.path ||
                                ''
                            )
                        ) &&
                        (
                            row.events ||
                            []
                        ).some(
                            event =>
                                event?.handler ===
                                'onItemClick'
                        )
                ) ||
            null
        );
    }


    async function closeHeroDetailForListFallback(
        options = {}
    ) {

        if (!findHeroDetailRoot()) {

            return {
                ok: true,
                alreadyClosed:
                    true
            };
        }


        return closeSalePanelByName(
            'HeroDetailPopup2024',
            {
                timeout:
                    options.timeout ??
                    2600
            }
        );
    }


    async function openHeroFromListItem(
        hero,
        options = {}
    ) {

        const heroId =
            Number(
                hero?.heroIdCandidate
            );

        const expectedName =
            String(
                hero?.name ||
                ''
            ).trim();


        if (
            !Number.isFinite(
                heroId
            ) ||
            !expectedName
        ) {

            return {
                ok: false,
                reason:
                    '목록 fallback 대상 영웅 정보 부족'
            };
        }


        const closeResult =
            await closeHeroDetailForListFallback(
                options
            );


        if (!closeResult?.ok) {

            return {
                ok: false,
                reason:
                    closeResult?.reason ||
                    '현재 영웅 상세 닫기 실패'
            };
        }


        if (!findHeroListRoot()) {

            return {
                ok: false,
                reason:
                    'fallback 중 영웅 목록 화면 없음'
            };
        }


        const scrollInfo =
            findHeroListScrollView();


        if (!scrollInfo) {

            return {
                ok: false,
                reason:
                    'fallback 중 영웅 목록 ScrollView 없음'
            };
        }


        const settleMs =
            Math.max(
                450,
                Number(
                    options.heroFallbackSettleMs ??
                    650
                )
            );


        const tryOpenCurrent =
            async () => {

                const button =
                    findHeroListCardButtonById(
                        heroId
                    );


                if (!button)
                    return null;


                const pressed =
                    await pressGameButton(
                        button.id,
                        {
                            waitMs:
                                220
                        }
                    );


                if (!pressed?.ok) {

                    return {
                        ok: false,
                        reason:
                            pressed?.reason ||
                            `${expectedName} 카드 클릭 실패`
                    };
                }


                const ready =
                    await waitForHeroDetailReady({
                        timeout:
                            options.heroDetailOpenTimeout ??
                            4500,

                        stableMs:
                            options.screenVisibleStableMs ??
                            650,

                        expectedName
                    });


                return {
                    ok:
                        !!ready?.ok,
                    reason:
                        ready?.ok
                            ? null
                            : (
                                ready?.reason ||
                                `${expectedName} 상세 열기 실패`
                              ),
                    identity:
                        ready?.identity ||
                        null
                };
            };


        const preferred =
            Number(
                hero?.listPosition
            );


        if (
            Number.isFinite(
                preferred
            )
        ) {

            await moveHeroListScroll(
                scrollInfo,
                preferred,
                {
                    scrollDuration:
                        options.heroScrollDuration ??
                        0.40,

                    scrollSettleMs:
                        settleMs
                }
            );


            const direct =
                await tryOpenCurrent();


            if (direct)
                return direct;
        }


        const scanSteps =
            Math.max(
                8,
                Math.min(
                    24,
                    Number(
                        options.heroFallbackScanSteps ??
                        12
                    )
                )
            );


        for (
            let index = 0;
            index <= scanSteps;
            index += 1
        ) {

            const position =
                index /
                scanSteps;


            await moveHeroListScroll(
                scrollInfo,
                position,
                {
                    scrollDuration:
                        options.heroScrollDuration ??
                        0.40,

                    scrollSettleMs:
                        settleMs
                }
            );


            const result =
                await tryOpenCurrent();


            if (result)
                return result;
        }


        return {
            ok: false,
            reason:
                `영웅 목록에서 ${expectedName}(${heroId}) 카드를 찾지 못함`
        };
    }


    async function openNextUnvisitedHeroFromList(
        known,
        visited,
        options = {}
    ) {

        const target =
            (
                known ||
                []
            ).find(
                hero =>
                    hero?.name &&
                    !visited.has(
                        hero.name
                    )
            );


        if (!target) {

            return {
                ok: false,
                reason:
                    '미수집 영웅 없음'
            };
        }


        const opened =
            await openHeroFromListItem(
                target,
                options
            );


        return {
            ...opened,
            fallback:
                true,
            target: {
                heroIdCandidate:
                    target.heroIdCandidate,
                name:
                    target.name,
                listPosition:
                    target.listPosition ??
                    null
            }
        };
    }


    function parseTraitProgress(
        text
    ) {

        const match =
            String(
                text ||
                ''
            ).match(
                /(\d+)\s*\/\s*(\d+)/
            );


        if (!match)
            return null;


        const current =
            Number(
                match[1]
            );

        const max =
            Number(
                match[2]
            );


        if (
            !Number.isFinite(
                current
            ) ||
            !Number.isFinite(
                max
            ) ||
            max <= 0
        ) {

            return null;
        }


        return {
            current,
            max,
            full:
                current >= max
        };
    }


    function inspectTraitCompletion(
        trait
    ) {

        const sourceItems =
            Array.isArray(
                trait?.items
            )
                ? trait.items
                : [];


        /*
         * 특성 이름 기준으로 중복 제거.
         * 같은 화면의 숨은/재사용 노드가 중복으로 잡혀도
         * 실제 4개 특성만 판정하도록 한다.
         */
        const unique =
            new Map();


        for (
            const item
            of sourceItems
        ) {

            const name =
                String(
                    item?.name ||
                    ''
                ).trim();


            if (!name)
                continue;


            const progressList =
                (
                    Array.isArray(
                        item?.progressTexts
                    )
                        ? item.progressTexts
                        : []
                )
                    .map(
                        parseTraitProgress
                    )
                    .filter(
                        Boolean
                    );


            /*
             * 동일 item에서 여러 progress가 잡힌 경우
             * 가장 큰 max값을 대표 progress로 사용.
             */
            const progress =
                progressList
                    .sort(
                        (a, b) =>
                            b.max -
                            a.max
                    )[0] ||
                null;


            const row = {
                name,
                progressText:
                    (
                        item?.progressTexts ||
                        []
                    )[0] ||
                    null,
                current:
                    progress?.current ??
                    null,
                max:
                    progress?.max ??
                    null,
                full:
                    progress?.full ===
                    true
            };


            const previous =
                unique.get(
                    name
                );


            if (
                !previous ||
                (
                    row.max != null &&
                    (
                        previous.max ==
                            null ||
                        row.max >
                            previous.max
                    )
                )
            ) {

                unique.set(
                    name,
                    row
                );
            }
        }


        const items =
            [
                ...unique.values()
            ];


        const expectedCount =
            4;


        const hasAllFour =
            items.length ===
            expectedCount;


        const allFull =
            hasAllFour &&
            items.every(
                item =>
                    item.full ===
                    true
            );


        return {
            expectedCount,
            actualCount:
                items.length,
            hasAllFour,
            allFull,
            fullCount:
                items.filter(
                    item =>
                        item.full ===
                        true
                ).length,
            items
        };
    }


    /*
     * 상세 조사 대상 영웅 화이트리스트.
     *
     * 국제화를 위해 영웅 이름은 코드에 저장하지 않는다.
     * heroIdCandidate만 판정 기준으로 사용한다.
     *
     * 스킬/특성/타이탄/각성 상세 진입은 아래 ID만 수행한다.
     */
    const TARGET_DETAIL_HERO_IDS =
        new Set([
        169,
        174,
        170,
        172,
        173,
        165,
        234,
        241,
        240,
        239,
        232,
        237,
        334,
        338,
        332,
        337,
        336,
        333
        ]);


    async function collectDetailedHeroSaleData(
        heroItems,
        options = {}
    ) {

        const allKnown =
            Array.isArray(
                heroItems
            )
                ? heroItems
                : [];


        /*
         * 상세 조사는 heroId 화이트리스트에 포함된 영웅만 수행한다.
         *
         * rarity/name을 상세 조사 대상 판정에 사용하지 않는다.
         * 따라서 클라이언트 언어가 바뀌어도 대상 영웅이 바뀌지 않는다.
         */
        const known =
            allKnown.filter(
                item =>
                    TARGET_DETAIL_HERO_IDS.has(
                        Number(
                            item?.heroIdCandidate
                        )
                    )
            );


        const raritySkipped = {
            sr:
                allKnown.filter(
                    item =>
                        item?.rarity ===
                        'SR'
                ).length,

            r:
                allKnown.filter(
                    item =>
                        item?.rarity ===
                        'R'
                ).length,

            nonSsr:
                allKnown.filter(
                    item =>
                        item?.rarity ===
                        'NON_SSR'
                ).length,

            unknown:
                allKnown.filter(
                    item =>
                        item?.rarity ===
                        'UNKNOWN'
                ).length
        };


        const byName =
            new Map(
                known
                    .filter(
                        item =>
                            item?.name
                    )
                    .map(
                        item => [
                            item.name,
                            item
                        ]
                    )
            );


        const foundTargetHeroIds =
            new Set(
                known
                    .map(
                        item =>
                            Number(
                                item?.heroIdCandidate
                            )
                    )
                    .filter(
                        Number.isFinite
                    )
            );


        const missingTargetHeroIds =
            [
                ...TARGET_DETAIL_HERO_IDS
            ]
                .filter(
                    heroId =>
                        !foundTargetHeroIds.has(
                            heroId
                        )
                );


        const targetCount =
            known.length;


        const enriched =
            new Map();

        const visited =
            new Set();


        const summary = {
            sourceHeroCount:
                allKnown.length,

            targetMode:
                'HERO_ID_WHITELIST',

            configuredTargetCount:
                TARGET_DETAIL_HERO_IDS.size,

            targetHeroIds:
                [
                    ...TARGET_DETAIL_HERO_IDS
                ],

            foundTargetHeroIds:
                [
                    ...foundTargetHeroIds
                ],

            missingTargetHeroIds,

            targetCount,

            raritySkipped,

            processedCount:
                0,
            skills: {
                available:
                    0,
                unavailable:
                    0,
                failed:
                    0,
                heroesWithSkills:
                    0,
                totalSkillCount:
                    0,
                level5PlusCount:
                    0,
                levelCounts:
                    {}
            },
            trait: {
                available:
                    0,
                unavailable:
                    0,
                skipped:
                    0,
                failed:
                    0,
                allMaxedHeroCount:
                    0
            },
            titan: {
                available:
                    0,
                unavailable:
                    0,
                skipped:
                    0,
                unknown:
                    0,
                failed:
                    0,
                equippedHeroCount:
                    0
            },
            awakening: {
                available:
                    0,
                unavailable:
                    0,
                skipped:
                    0,
                unknown:
                    0,
                failed:
                    0,
                awakenedHeroCount:
                    0
            }
        };


        const navigation = {
            openFirst:
                null,
            nextFailures:
                [],
            fallbackOpens:
                [],
            closeDetail:
                null,
            closeList:
                null
        };


        let fatalError =
            null;


        const report =
            (type, detail) => {

                try {
                    options.onProgress?.(
                        type,
                        detail
                    );
                } catch {}
            };


        try {

            const first =
                await runCollectorStepWithRetries(
                    '첫 영웅 상세 진입',
                    () =>
                        (
                            known[0]
                                ? openHeroFromListItem(
                                    known[0],
                                    {
                                        ...options,
                                        heroDetailOpenTimeout:
                                            options.heroDetailOpenTimeout ??
                                            4500,

                                        screenVisibleStableMs:
                                            options.screenVisibleStableMs ??
                                            650
                                    }
                                  )
                                : Promise.resolve({
                                    ok: false,
                                    reason:
                                        '상세 조사 대상 영웅을 찾지 못했습니다.'
                                  })
                        ),
                    {
                        maxRetries:
                            options.maxRetries ??
                            3,
                        retryDelay:
                            options.retryDelay ??
                            350
                    }
                );


            navigation.openFirst =
                first;


            if (!first.ok) {

                fatalError =
                    first.reason ||
                    '첫 영웅 상세 진입 실패';

            } else {

                for (
                    let sequence = 0;
                    sequence < targetCount;
                    sequence += 1
                ) {

                    /*
                     * 프레임 노드 identity가 바뀌는지 여부는 보지 않는다.
                     * 화면에 실제 heroName이 표시되고 같은 이름이
                     * 최소 안정시간 동안 유지되는지만 확인한다.
                     */
                    const detailReady =
                        await waitForHeroDetailReady({
                            timeout:
                                options.heroDetailVisibleTimeout ??
                                4200,

                            stableMs:
                                options.screenVisibleStableMs ??
                                650
                        });


                    if (!detailReady.ok) {

                        fatalError =
                            detailReady.reason ||
                            '영웅 상세 화면 준비 실패';

                        break;
                    }


                    const identity =
                        detailReady.identity;


                    if (!identity?.name) {

                        fatalError =
                            '현재 영웅 이름 확인 실패';

                        break;
                    }


                    /*
                     * 다음 화살표가 화이트리스트 외 영웅으로 이동한 경우
                     * 상세조사를 하지 않고 다음 미수집 대상 영웅을 목록에서 연다.
                     */
                    if (
                        !byName.has(
                            identity.name
                        )
                    ) {

                        const nonSsrFallback =
                            await openNextUnvisitedHeroFromList(
                                known,
                                visited,
                                options
                            );


                        navigation
                            .fallbackOpens
                            .push({
                                from:
                                    identity.name,
                                reason:
                                    '화이트리스트 외 영웅 상세 스킵',
                                ok:
                                    !!nonSsrFallback?.ok,
                                value:
                                    nonSsrFallback
                            });


                        if (!nonSsrFallback?.ok) {

                            fatalError =
                                nonSsrFallback?.reason ||
                                '다음 대상 영웅 목록 fallback 실패';

                            break;
                        }


                        sequence -=
                            1;

                        continue;
                    }


                    if (
                        visited.has(
                            identity.name
                        )
                    ) {

                        const repeatFallback =
                            await openNextUnvisitedHeroFromList(
                                known,
                                visited,
                                options
                            );


                        navigation
                            .fallbackOpens
                            .push({
                                from:
                                    identity.name,
                                reason:
                                    `영웅 순회가 ${identity.name}에서 반복됨`,
                                ok:
                                    !!repeatFallback?.ok,
                                value:
                                    repeatFallback
                            });


                        if (!repeatFallback?.ok) {

                            fatalError =
                                repeatFallback?.reason ||
                                `영웅 순회가 ${identity.name}에서 반복됨`;

                            break;
                        }


                        sequence -=
                            1;

                        continue;
                    }


                    visited.add(
                        identity.name
                    );


                    const base =
                        byName.get(
                            identity.name
                        ) || {
                            name:
                                identity.name,
                            level:
                                identity.level,
                            levelText:
                                identity.levelText
                        };


                    const skillStep =
                        await runCollectorStepWithRetries(
                            `${identity.name} 장착 스킬`,
                            async () =>
                                collectCurrentHeroSkills(),
                            {
                                maxRetries:
                                    options.maxRetries ??
                                    3,
                                retryDelay:
                                    options.retryDelay ??
                                    350,
                                isSuccess:
                                    value =>
                                        value?.ok ===
                                        true
                            }
                        );


                    const skills =
                        skillStep.value || {
                            ok: false,
                            available:
                                true,
                            reason:
                                skillStep.reason ||
                                '장착 스킬 수집 실패',
                            count:
                                0,
                            items:
                                []
                        };


                    skills.attempts =
                        skillStep
                            .attempts;


                    if (!skills.ok) {

                        summary.skills.failed +=
                            1;

                    } else if (
                        skills.available ===
                        false
                    ) {

                        summary.skills.unavailable +=
                            1;

                    } else {

                        summary.skills.available +=
                            1;
                    }


                    /*
                     * 스킬 판매 가치는 "몇 개 있나"보다 레벨이 중요하므로
                     * 실제 장착 스킬 level을 누적 집계한다.
                     */
                    const skillLevels =
                        (
                            Array.isArray(
                                skills?.items
                            )
                                ? skills.items
                                : []
                        )
                            .map(
                                item =>
                                    Number(
                                        item?.level
                                    )
                            )
                            .filter(
                                Number.isFinite
                            );


                    if (
                        skillLevels.length
                    ) {

                        summary.skills.heroesWithSkills +=
                            1;

                        summary.skills.totalSkillCount +=
                            skillLevels.length;


                        for (
                            const level
                            of skillLevels
                        ) {

                            const key =
                                String(
                                    level
                                );


                            summary.skills.levelCounts[key] =
                                (
                                    summary.skills.levelCounts[key] ||
                                    0
                                ) +
                                1;


                            if (
                                level >=
                                5
                            ) {

                                summary.skills.level5PlusCount +=
                                    1;
                            }
                        }
                    }


                    report(
                        'skills',
                        {
                            index:
                                sequence + 1,
                            total:
                                targetCount,
                            name:
                                identity.name,
                            count:
                                skills.count ||
                                0,
                            summary:
                                {
                                    ...summary.skills
                                }
                        }
                    );


                    /*
                     * 영웅 상세 탭 진입 조건 최적화
                     * - 특성: 5성 + 120레벨
                     * - 타이탄: 5성 + 120레벨 + 특성 4개 모두 최대치
                     * - 특성/타이탄: 5성 + 120레벨
                     * - 각성: 5성 + 120레벨 + 2번 슬롯 전속 스킬 Lv5 이상
                     *
                     * 조건 미충족 영웅은 해당 탭 자체를 누르지 않는다.
                     */
                    const heroStar =
                        Number(
                            base?.star ??
                            0
                        );


                    const heroLevel =
                        Number(
                            identity?.level ??
                            base?.level ??
                            0
                        );


                    const traitEligible =
                        heroStar === 5 &&
                        heroLevel === 120;


                    const equippedSkills =
                        Array.isArray(
                            skills?.items
                        )
                            ? skills.items
                            : [];


                    const equippedSkillLevels =
                        equippedSkills
                            .map(
                                item =>
                                    Number(
                                        item?.level ??
                                        0
                                    )
                            )
                            .filter(
                                Number.isFinite
                            );


                    const maxEquippedSkillLevel =
                        equippedSkillLevels.length
                            ? Math.max(
                                ...equippedSkillLevels
                              )
                            : 0;


                    /*
                     * 각성 조건에서 중요한 것은 "아무 스킬 Lv5+"가 아니다.
                     * 장착 스킬의 두 번째 칸(slot === 2)이 전속 스킬이며,
                     * 이 전속 스킬이 Lv5 이상이어야 각성이 존재할 수 있다.
                     */
                    const exclusiveSkill =
                        equippedSkills.find(
                            item =>
                                Number(
                                    item?.slot
                                ) ===
                                2
                        ) ||
                        null;


                    const exclusiveSkillLevel =
                        exclusiveSkill
                            ? Number(
                                exclusiveSkill.level
                              )
                            : null;


                    const exclusiveSkillLevelKnown =
                        !!exclusiveSkill &&
                        Number.isFinite(
                            exclusiveSkillLevel
                        );


                    const awakeningBaseEligible =
                        traitEligible &&
                        exclusiveSkillLevelKnown &&
                        exclusiveSkillLevel >= 5;


                    const eligibility = {
                        star:
                            heroStar,
                        level:
                            heroLevel,
                        trait: {
                            eligible:
                                traitEligible,
                            requirement:
                                '5성 · 120레벨'
                        },
                        titan: {
                            eligible:
                                false,
                            requirement:
                                '5성 · 120레벨 · 특성 4개 모두 최대치'
                        },
                        awakening: {
                            eligible:
                                false,
                            baseEligible:
                                awakeningBaseEligible,
                            requirement:
                                '5성 · 120레벨 · 2번 슬롯 전속 스킬 5레벨 이상',
                            exclusiveSkillSlot:
                                2,
                            exclusiveSkillLevelKnown,
                            exclusiveSkillLevel,
                            exclusiveSkill:
                                exclusiveSkill
                                    ? {
                                        slot:
                                            exclusiveSkill.slot,
                                        level:
                                            exclusiveSkill.level,
                                        levelText:
                                            exclusiveSkill.levelText ??
                                            null
                                      }
                                    : null,
                            maxEquippedSkillLevel
                        }
                    };


                    let traitStep =
                        null;


                    let trait =
                        null;


                    if (!traitEligible) {

                        trait = {
                            ok: true,
                            available: false,
                            skipped: true,
                            reason:
                                '특성 조건 미충족: 5성 · 120레벨 필요',
                            eligibility: {
                                star:
                                    heroStar,
                                level:
                                    heroLevel
                            },
                            items: [],
                            attempts: []
                        };

                    } else {

                        traitStep =
                            await runCollectorStepWithRetries(
                                `${identity.name} 특성`,
                                () =>
                                    collectCurrentHeroTraits({
                                        ...options,
                                        maxRetries:
                                            options.traitMaxRetries ??
                                            1
                                    }),
                                {
                                    /*
                                     * 특성 UI readiness를 수정했으므로
                                     * 실패 시 무의미한 4회 반복 대신 최대 2회만 시도.
                                     */
                                    maxRetries:
                                        options.traitMaxRetries ??
                                        1,
                                    retryDelay:
                                        options.retryDelay ??
                                        350,
                                    isSuccess:
                                        value =>
                                            value?.ok ===
                                            true
                                }
                            );


                        trait =
                            traitStep.value || {
                                ok: false,
                                available:
                                    true,
                                reason:
                                    traitStep.reason ||
                                    '특성 수집 실패'
                            };


                        trait.attempts =
                            traitStep
                                .attempts;
                    }


                    if (!trait.ok) {

                        summary.trait.failed +=
                            1;

                    } else if (
                        trait.skipped ===
                        true
                    ) {

                        summary.trait.skipped +=
                            1;

                    } else if (
                        trait.available ===
                        false
                    ) {

                        summary.trait.unavailable +=
                            1;

                    } else {

                        summary.trait.available +=
                            1;
                    }


                    report(
                        'traits',
                        {
                            index:
                                sequence + 1,
                            total:
                                targetCount,
                            name:
                                identity.name,
                            summary:
                                {
                                    ...summary.trait
                                }
                        }
                    );


                    /*
                     * 특성 판정은 3상태로 분리한다.
                     *
                     * 1) KNOWN + 데이터 있음
                     * 2) KNOWN + 실제로 비어 있음
                     * 3) UNKNOWN = 특성 수집 자체 실패
                     *
                     * UNKNOWN을 "특성 0개"로 오판하면 실제 타이탄/각성 보유 영웅을
                     * 전부 0개로 만들어버리므로 절대 empty로 취급하지 않는다.
                     */
                    const traitKnown =
                        trait?.ok ===
                        true;


                    const traitCompletion =
                        traitKnown
                            ? inspectTraitCompletion(
                                trait
                              )
                            : {
                                expectedCount:
                                    4,
                                actualCount:
                                    null,
                                hasAllFour:
                                    null,
                                allFull:
                                    null,
                                fullCount:
                                    null,
                                items:
                                    []
                              };


                    const traitHasData =
                        traitKnown &&
                        Number(
                            traitCompletion.actualCount
                        ) >
                            0;


                    const traitAllMaxed =
                        traitKnown &&
                        traitCompletion.allFull ===
                            true;


                    /*
                     * v0.9.1부터 조사 조건을 단순화한다.
                     *
                     * SSR 상세 조사 대상 중:
                     * - 특성: 5성 + 120레벨이면 조사
                     * - 타이탄: 5성 + 120레벨이면 조사
                     * - 각성: 5성 + 120레벨 +
                     *         2번 슬롯 전속 스킬 Lv5 이상일 때 조사
                     *
                     * 특성 개수/완성도는 조사 gate로 사용하지 않는다.
                     * 각성에 한해서 2번 슬롯 전속 스킬 레벨만 gate로 사용한다.
                     */
                    const titanEligible =
                        traitEligible;


                    const awakeningEligible =
                        awakeningBaseEligible;


                    eligibility.trait.known =
                        traitKnown;


                    eligibility.trait.hasData =
                        traitKnown
                            ? traitHasData
                            : null;


                    eligibility.trait.completion =
                        traitCompletion;


                    eligibility.trait.allMaxed =
                        traitKnown
                            ? traitAllMaxed
                            : null;


                    if (
                        traitAllMaxed
                    ) {

                        summary.trait.allMaxedHeroCount +=
                            1;
                    }


                    eligibility.titan.eligible =
                        titanEligible;


                    eligibility.titan.requirement =
                        '5성 · 120레벨';


                    eligibility.titan.traitGateUsed =
                        false;


                    eligibility.titan.traitKnown =
                        traitKnown;


                    eligibility.titan.traitAllMaxed =
                        traitKnown
                            ? traitAllMaxed
                            : null;


                    eligibility.titan.traitCompletion =
                        traitCompletion;


                    eligibility.awakening.eligible =
                        awakeningEligible;


                    eligibility.awakening.requirement =
                        '5성 · 120레벨 · 2번 슬롯 전속 스킬 5레벨 이상';


                    eligibility.awakening.traitGateUsed =
                        false;


                    eligibility.awakening.skillLevelGateUsed =
                        true;


                    eligibility.awakening.exclusiveSkillSlot =
                        2;


                    eligibility.awakening.exclusiveSkillLevelKnown =
                        exclusiveSkillLevelKnown;


                    eligibility.awakening.exclusiveSkillLevel =
                        exclusiveSkillLevel;


                    eligibility.awakening.traitKnown =
                        traitKnown;


                    eligibility.awakening.traitHasData =
                        traitKnown
                            ? traitHasData
                            : null;


                    eligibility.awakening.traitCompletion =
                        traitCompletion;


                    let titanStep =
                        null;


                    let titan =
                        null;


                    if (!titanEligible) {

                        titan = {
                            ok: true,
                            available: false,
                            skipped: true,
                            reason:
                                '타이탄 조건 미충족: 5성 · 120레벨 필요',
                            eligibility: {
                                star:
                                    heroStar,
                                level:
                                    heroLevel
                            },
                            slots: [],
                            attempts: []
                        };
                    } else {

                        titanStep =
                            await runCollectorStepWithRetries(
                                `${identity.name} 타이탄`,
                                () =>
                                    collectCurrentHeroTitan({
                                        ...options,
                                        maxRetries:
                                            options.maxRetries ??
                                            3
                                    }),
                                {
                                    maxRetries:
                                        options.maxRetries ??
                                        3,
                                    retryDelay:
                                        options.retryDelay ??
                                        350,
                                    isSuccess:
                                        value =>
                                            value?.ok ===
                                            true
                                }
                            );


                        titan =
                            titanStep.value || {
                                ok: false,
                                available:
                                    true,
                                reason:
                                    titanStep.reason ||
                                    '타이탄 수집 실패',
                                slots:
                                    []
                            };


                        titan.attempts =
                            titanStep
                                .attempts;
                    }


                    if (
                        titan.unknown ===
                        true
                    ) {

                        summary.titan.unknown +=
                            1;

                    } else if (!titan.ok) {

                        summary.titan.failed +=
                            1;

                    } else if (
                        titan.skipped ===
                        true
                    ) {

                        summary.titan.skipped +=
                            1;

                    } else if (
                        titan.available ===
                        false
                    ) {

                        summary.titan.unavailable +=
                            1;

                    } else {

                        summary.titan.available +=
                            1;


                        if (
                            Number(
                                titan.equippedCount ||
                                0
                            ) >
                            0
                        ) {

                            summary.titan.equippedHeroCount +=
                                1;
                        }
                    }


                    report(
                        'equipment',
                        {
                            index:
                                sequence + 1,
                            total:
                                targetCount,
                            name:
                                identity.name,
                            summary:
                                {
                                    ...summary.titan
                                }
                        }
                    );


                    let awakenStep =
                        null;


                    let awakening =
                        null;


                    if (!awakeningEligible) {

                        if (
                            traitEligible &&
                            !exclusiveSkillLevelKnown
                        ) {

                            /*
                             * 5성 120레벨인데 2번 슬롯 전속 스킬 레벨을
                             * 읽지 못한 경우 "미각성"으로 단정하지 않는다.
                             */
                            awakening = {
                                ok: false,
                                available: null,
                                skipped: false,
                                unknown: true,
                                blocked: true,
                                reason:
                                    '각성 판정 불가: 2번 슬롯 전속 스킬 레벨 확인 실패',
                                eligibility: {
                                    star:
                                        heroStar,
                                    level:
                                        heroLevel,
                                    exclusiveSkillSlot:
                                        2,
                                    exclusiveSkillLevelKnown:
                                        false,
                                    exclusiveSkillLevel:
                                        null,
                                    maxEquippedSkillLevel
                                },
                                level:
                                    null,
                                skills:
                                    [],
                                attempts:
                                    []
                            };

                        } else {

                            awakening = {
                                ok: true,
                                available: false,
                                skipped: true,
                                reason:
                                    !traitEligible
                                        ? '각성 조건 미충족: 5성 · 120레벨 필요'
                                        : `각성 조건 미충족: 2번 슬롯 전속 스킬 Lv${exclusiveSkillLevel} (<5)`,
                                eligibility: {
                                    star:
                                        heroStar,
                                    level:
                                        heroLevel,
                                    exclusiveSkillSlot:
                                        2,
                                    exclusiveSkillLevelKnown,
                                    exclusiveSkillLevel,
                                    maxEquippedSkillLevel
                                },
                                level:
                                    null,
                                skills:
                                    [],
                                attempts:
                                    []
                            };
                        }

                    } else {

                        awakenStep =
                            await runCollectorStepWithRetries(
                                `${identity.name} 각성`,
                                () =>
                                    collectCurrentHeroAwakening({
                                        ...options,
                                        maxRetries:
                                            options.maxRetries ??
                                            3
                                    }),
                                {
                                    maxRetries:
                                        options.maxRetries ??
                                        3,
                                    retryDelay:
                                        options.retryDelay ??
                                        350,
                                    isSuccess:
                                        value =>
                                            value?.ok ===
                                            true
                                }
                            );


                        awakening =
                            awakenStep.value || {
                                ok: false,
                                available:
                                    true,
                                reason:
                                    awakenStep.reason ||
                                    '각성 수집 실패',
                                skills:
                                    []
                            };


                        awakening.attempts =
                            awakenStep
                                .attempts;
                    }


                    if (
                        awakening.unknown ===
                        true
                    ) {

                        summary.awakening.unknown +=
                            1;

                    } else if (!awakening.ok) {

                        summary.awakening.failed +=
                            1;

                    } else if (
                        awakening.skipped ===
                        true
                    ) {

                        summary.awakening.skipped +=
                            1;

                    } else if (
                        awakening.available ===
                        false
                    ) {

                        summary.awakening.unavailable +=
                            1;

                    } else {

                        summary.awakening.available +=
                            1;


                        const awakened =
                            Number(
                                awakening.level ||
                                0
                            ) >
                                0
                            ||
                            (
                                awakening.skills ||
                                []
                            ).some(
                                skill =>
                                    Number(
                                        skill?.currentStage ||
                                        0
                                    ) >
                                    0
                            );


                        awakening.awakened =
                            awakened;


                        if (awakened) {

                            summary.awakening.awakenedHeroCount +=
                                1;
                        }
                    }


                    report(
                        'awakening',
                        {
                            index:
                                sequence + 1,
                            total:
                                targetCount,
                            name:
                                identity.name,
                            summary:
                                {
                                    ...summary.awakening
                                }
                        }
                    );


                    enriched.set(
                        identity.name,
                        {
                            ...base,
                            detail: {
                                name:
                                    identity.name,
                                tags:
                                    identity.tags ||
                                    [],
                                tag:
                                    identity.tag ||
                                    null,
                                level:
                                    identity.level,
                                levelText:
                                    identity.levelText,
                                power:
                                    identity.power,
                                powerText:
                                    identity.powerText
                            },
                            eligibility,
                            skills,
                            traits:
                                trait,
                            titan,
                            awakening
                        }
                    );


                    summary.processedCount =
                        enriched.size;


                    report(
                        'heroes',
                        {
                            index:
                                sequence + 1,
                            total:
                                targetCount,
                            name:
                                identity.name,
                            processed:
                                enriched.size
                        }
                    );


                    if (
                        enriched.size >=
                        targetCount
                    )
                        break;


                    const nextStep =
                        await runCollectorStepWithRetries(
                            `${identity.name} 다음 영웅`,
                            () =>
                                moveToNextHeroDetail(
                                    identity.name,
                                    {
                                        timeout:
                                            options.heroChangeTimeout ??
                                            2600,

                                        stableMs:
                                            options.screenVisibleStableMs ??
                                            650
                                    }
                                ),
                            {
                                /*
                                 * 동일 화면 반복을 막기 위해 화살표는 한 번만 시도.
                                 */
                                maxRetries:
                                    0,
                                retryDelay:
                                    0
                            }
                        );


                    if (!nextStep.ok) {

                        navigation
                            .nextFailures
                            .push({
                                hero:
                                    identity.name,
                                attempts:
                                    nextStep.attempts,
                                reason:
                                    nextStep.reason,
                                fallback:
                                    true
                            });


                        const fallbackStep =
                            await runCollectorStepWithRetries(
                                `${identity.name} 목록 fallback`,
                                () =>
                                    openNextUnvisitedHeroFromList(
                                        known,
                                        visited,
                                        {
                                            ...options,
                                            heroDetailOpenTimeout:
                                                options.heroDetailOpenTimeout ??
                                                4500
                                        }
                                    ),
                                {
                                    maxRetries:
                                        1,
                                    retryDelay:
                                        options.retryDelay ??
                                        350,
                                    isSuccess:
                                        value =>
                                            value?.ok ===
                                            true
                                }
                            );


                        navigation
                            .fallbackOpens
                            .push({
                                from:
                                    identity.name,
                                ok:
                                    fallbackStep.ok,
                                reason:
                                    fallbackStep.reason,
                                value:
                                    fallbackStep.value ||
                                    null,
                                attempts:
                                    fallbackStep.attempts
                            });


                        if (!fallbackStep.ok) {

                            fatalError =
                                fallbackStep.reason ||
                                nextStep.reason ||
                                '다음 미수집 영웅 목록 fallback 실패';

                            break;
                        }
                    }
                }
            }

        } catch (
            error
        ) {

            fatalError =
                error?.message ||
                String(
                    error
                );

            recordError(
                '영웅 상세 전체 수집',
                error
            );

        } finally {

            /*
             * 남아 있을 수 있는 하위 팝업부터 역순으로 정리.
             */
            for (
                const panelName
                of [
                    'HeroAwakenSkillUpPop',
                    'HeroEquipDetailPop',
                    'HeroEquipWearPanel',
                    'HeroStrengthenPanelNew'
                ]
            ) {

                if (
                    findActiveNodeByName(
                        panelName
                    )
                ) {

                    await closeSalePanelByName(
                        panelName
                    );
                }
            }


            if (
                findHeroDetailRoot()
            ) {

                navigation.closeDetail =
                    await closeSalePanelByName(
                        'HeroDetailPopup2024',
                        {
                            timeout:
                                options.finalCloseTimeout ??
                                2600
                        }
                    );
            } else {

                navigation.closeDetail = {
                    ok: true,
                    alreadyClosed:
                        true
                };
            }


            if (
                findHeroListRoot()
            ) {

                navigation.closeList =
                    await closeSalePanelByName(
                        'HeroListPopup2023',
                        {
                            timeout:
                                options.finalCloseTimeout ??
                                2600
                        }
                    );
            } else {

                navigation.closeList = {
                    ok: true,
                    alreadyClosed:
                        true
                };
            }
        }


        /*
         * 상세 순회 순서와 영웅 목록의 정렬 순서는 다를 수 있으므로
         * 최종 출력은 최초 목록 순서에 다시 맞춘다.
         */
        const items =
            known.map(
                item =>
                    enriched.get(
                        item.name
                    ) || {
                        ...item,
                        detail:
                            null,
                        skills: {
                            ok: false,
                            available:
                                null,
                            reason:
                                '상세 미수집',
                            count:
                                0,
                            items:
                                []
                        },
                        traits: {
                            ok: false,
                            available:
                                null,
                            reason:
                                '상세 미수집'
                        },
                        titan: {
                            ok: false,
                            available:
                                null,
                            reason:
                                '상세 미수집',
                            slots:
                                []
                        },
                        awakening: {
                            ok: false,
                            available:
                                null,
                            reason:
                                '상세 미수집',
                            skills:
                                []
                        }
                    }
            );


        const complete =
            targetCount ===
                0 ||
            enriched.size >=
                targetCount;


        const closed =
            !!navigation.closeDetail
                ?.ok &&
            !!navigation.closeList
                ?.ok;


        const qualityOk =
            summary.skills.failed ===
                0 &&
            summary.trait.failed ===
                0 &&
            summary.titan.failed ===
                0 &&
            summary.titan.unknown ===
                0 &&
            summary.awakening.failed ===
                0 &&
            summary.awakening.unknown ===
                0;


        /*
         * 영웅 상세 수집 성공 여부와 하위 Collector 품질을 분리한다.
         *
         * ok/traversalOk:
         *   영웅 자체 순회가 끝까지 완료됐는가
         *
         * qualityOk:
         *   스킬/특성/타이탄/각성 등 하위 상세까지 모두 문제없는가
         *
         * 특성 실패 하나 때문에 영웅 전체를 실패로 표시하지 않는다.
         */
        return {
            ok:
                complete &&
                !fatalError,
            traversalOk:
                complete &&
                !fatalError,
            qualityOk,
            closed,
            fatalError,
            count:
                items.length,
            collectedCount:
                enriched.size,
            summary,
            navigation,
            items
        };
    }


    async function collectCharacterSaleData(options = {}) {
        const startedAt = Date.now();

        const maxRetries =
            Math.max(
                0,
                Math.min(
                    3,
                    Number(
                        options.maxRetries ??
                        3
                    )
                )
            );

        const retryDelay =
            Math.max(
                100,
                Number(
                    options.retryDelay ??
                    350
                )
            );

        const notify =
            (key, status, detail = null) => {
                try {
                    options.onProgress?.({
                        key,
                        status,
                        detail,
                        at: Date.now()
                    });
                } catch {}
            };

        /*
         * 프로필이 실제로 열린 시점에 기본 Label을 먼저 확보한다.
         * 따라서 UI의 '프로필 기본 정보' 완료도 전체 8개 탭이 끝난 뒤가 아니라
         * 프로필 화면이 준비된 즉시 표시된다.
         */
        let headerLabels = [];
        let basicCandidates = {
            nickname: [],
            server: [],
            level: [],
            vip: [],
            power: []
        };
        let profileReady = false;

        notify(
            'profileBasic',
            'running'
        );

        const suppliedProfileOptions =
            options.profile &&
            typeof options.profile === 'object'
                ? options.profile
                : options;

        const profileOptions = {
            ...suppliedProfileOptions,

            maxRetries,

            retryDelay,

            onProgress:
                event => {

                    /*
                     * 기존 사용자가 profile.onProgress를 별도로 넘겼다면 같이 전달.
                     */
                    try {
                        suppliedProfileOptions
                            ?.onProgress
                            ?.(event);
                    } catch {}

                    if (
                        event?.type ===
                        'profile-ready'
                    ) {
                        profileReady = true;

                        headerLabels =
                            collectProfileHeaderLabels();

                        basicCandidates =
                            classifyProfileHeaderLabels(
                                headerLabels
                            );

                        notify(
                            'profileBasic',
                            'done',
                            {
                                labelCount:
                                    headerLabels.length
                            }
                        );

                        return;
                    }

                    if (
                        event?.type ===
                            'profile-open-retry'
                    ) {

                        notify(
                            'profileBasic',
                            'running',
                            {
                                attempt:
                                    event.attempt,
                                maxAttempts:
                                    event.maxAttempts,
                                reason:
                                    event.reason
                            }
                        );

                        return;
                    }


                    if (
                        event?.type ===
                            'tab-retry'
                    ) {

                        notify(
                            event.toggle,
                            'running',
                            {
                                index:
                                    event.index,

                                total:
                                    event.total,

                                label:
                                    event.label,

                                attempt:
                                    event.attempt,

                                maxAttempts:
                                    event.maxAttempts,

                                reason:
                                    event.reason
                            }
                        );

                        return;
                    }


                    if (
                        event?.type ===
                        'tab-start'
                    ) {
                        notify(
                            event.toggle,
                            'running',
                            {
                                index:
                                    event.index,

                                total:
                                    event.total,

                                label:
                                    event.label
                            }
                        );

                        return;
                    }

                    if (
                        event?.type ===
                        'tab-complete'
                    ) {
                        notify(
                            event.toggle,
                            event.ok
                                ? 'done'
                                : 'error',
                            {
                                index:
                                    event.index,

                                total:
                                    event.total,

                                label:
                                    event.label,

                                ownedCount:
                                    saleOwnedProfileItems(
                                        event.toggle,
                                        event.data
                                            ?.items
                                    ).length,

                                rawOwnedCount:
                                    event.data
                                        ?.ownedCount ??
                                    null,

                                attempts:
                                    event.data
                                        ?.attempts
                                        ?.length ??
                                    1
                            }
                        );
                    }
                }
        };

        const profileData =
            await profileModule.collectAll(
                profileOptions
            );

        /*
         * 프로필 진입 자체가 실패한 경우에는 profile-ready가 오지 않는다.
         */
        if (!profileReady) {
            notify(
                'profileBasic',
                'error',
                {
                    reason:
                        profileData?.reason ||
                        profileData?.detail?.reason ||
                        '프로필 화면 준비 실패'
                }
            );
        }

        /*
         * 방어적으로 마지막 시점에도 Label을 확보한다.
         */
        if (
            profileReady &&
            !headerLabels.length
        ) {
            headerLabels =
                collectProfileHeaderLabels();

            basicCandidates =
                classifyProfileHeaderLabels(
                    headerLabels
                );
        }

        /*
         * 프로필 수집이 끝났으면 프로필을 닫고 영웅 목록으로 이동한다.
         * 닫기 / 영웅 화면 진입 / 영웅 목록 수집 각각 실패 시
         * 최초 시도 이후 최대 3회 재시도한다.
         */
        /*
         * 프로필 수집이 실패했다면 화면을 닫지 않는다.
         * 오류 화면을 그대로 남겨 진단 가능하게 하고,
         * 영웅 단계로도 진행하지 않는다.
         */
        const profileCollectOk =
            !!profileData?.ok;


        const profileFailureReason =
            profileData?.reason ||
            profileData?.detail?.reason ||
            (
                profileCollectOk
                    ? null
                    : '프로필 수집 실패'
            );


        const profileCloseStep =
            profileCollectOk
                ? await runCollectorStepWithRetries(
                    '프로필 닫기',
                    async () => {

                        if (
                            !findProfileRoot()
                        ) {

                            return {
                                ok: true,
                                alreadyClosed:
                                    true
                            };
                        }


                        return closeOwnProfile({
                            timeout:
                                options
                                    .profileCloseTimeout ??
                                3000
                        });
                    },
                    {
                        maxRetries,
                        retryDelay
                    }
                )
                : {
                    ok: false,
                    skipped:
                        true,
                    reason:
                        profileFailureReason,
                    value: {
                        ok: false,
                        skipped:
                            true,
                        reason:
                            profileFailureReason
                    },
                    attempts: []
                };


        let heroOpenStep =
            {
                ok: false,
                value: null,
                attempts: [],
                reason:
                    profileCloseStep.ok
                        ? '영웅 화면 진입 전'
                        : (
                            !profileCollectOk
                                ? `프로필 수집 실패: ${profileFailureReason}`
                                : '프로필 닫기 실패'
                          )
            };

        let heroCollectStep =
            {
                ok: false,
                value: {
                    ok: false,
                    reason:
                        profileCloseStep.ok
                            ? '영웅 조사 전'
                            : (
                                !profileCollectOk
                                    ? `프로필 수집 실패: ${profileFailureReason}`
                                    : '프로필 닫기 실패'
                              ),
                    count:
                        0,
                    items:
                        []
                },
                attempts: []
            };


        notify(
            'heroes',
            'running',
            {
                phase:
                    'open'
            }
        );


        if (
            profileCloseStep.ok
        ) {

            heroOpenStep =
                await runCollectorStepWithRetries(
                    '영웅 화면 진입',
                    () =>
                        openHeroListScreen({
                            timeout:
                                options
                                    .heroOpenTimeout ??
                                3500
                        }),
                    {
                        maxRetries,
                        retryDelay,
                        onRetry:
                            retry =>
                                notify(
                                    'heroes',
                                    'running',
                                    {
                                        phase:
                                            'open',
                                        attempt:
                                            retry.attempt,
                                        maxAttempts:
                                            retry.maxAttempts
                                    }
                                )
                    }
                );
        }


        if (
            heroOpenStep.ok
        ) {

            notify(
                'heroes',
                'running',
                {
                    phase:
                        'collect'
                }
            );


            heroCollectStep =
                await runCollectorStepWithRetries(
                    '영웅 목록 수집',
                    () =>
                        collectHeroListData({
                            ...options,
                            maxRetries
                        }),
                    {
                        maxRetries,
                        retryDelay,
                        isSuccess:
                            value =>
                                !!value?.ok &&
                                Number(
                                    value?.count ||
                                    0
                                ) >
                                0,
                        onRetry:
                            retry =>
                                notify(
                                    'heroes',
                                    'running',
                                    {
                                        phase:
                                            'collect',
                                        attempt:
                                            retry.attempt,
                                        maxAttempts:
                                            retry.maxAttempts
                                    }
                                )
                    }
                );
        }


        const heroData =
            heroCollectStep.value || {
                ok: false,
                reason:
                    heroCollectStep.reason ||
                    heroOpenStep.reason ||
                    '영웅 조사 실패',
                count:
                    0,
                items:
                    []
            };


        let heroDetailData = {
            ok: false,
            traversalOk:
                false,
            qualityOk:
                false,
            closed:
                false,
            count:
                heroData?.count ??
                0,
            collectedCount:
                0,
            items:
                Array.isArray(
                    heroData?.items
                )
                    ? heroData.items
                    : [],
            summary: {
                targetCount:
                    heroData?.count ??
                    0,
                processedCount:
                    0,
                skills: {
                    available: 0,
                    unavailable: 0,
                    failed: 0,
                    heroesWithSkills: 0,
                    totalSkillCount: 0,
                    level5PlusCount: 0,
                    levelCounts: {}
                },
                trait: {
                    available: 0,
                    unavailable: 0,
                    skipped: 0,
                    failed: 0,
                    allMaxedHeroCount: 0
                },
                titan: {
                    available: 0,
                    unavailable: 0,
                    skipped: 0,
                    unknown: 0,
                    failed: 0,
                    equippedHeroCount: 0
                },
                awakening: {
                    available: 0,
                    unavailable: 0,
                    skipped: 0,
                    unknown: 0,
                    failed: 0,
                    awakenedHeroCount: 0
                }
            },
            navigation: {},
            fatalError:
                heroCollectStep.ok
                    ? '영웅 상세 조사 전'
                    : '영웅 목록 수집 실패'
        };


        if (
            heroCollectStep.ok &&
            Array.isArray(
                heroData?.items
            ) &&
            heroData.items.length
        ) {

            notify(
                'skills',
                'running'
            );

            notify(
                'traits',
                'running'
            );

            notify(
                'equipment',
                'running'
            );

            notify(
                'awakening',
                'running'
            );


            heroDetailData =
                await collectDetailedHeroSaleData(
                    heroData.items,
                    {
                        ...options,
                        maxRetries,
                        retryDelay,

                        onProgress:
                            (key, detail) => {

                                notify(
                                    key,
                                    'running',
                                    detail
                                );
                            }
                    }
                );


            const skillSummary =
                heroDetailData.summary
                    ?.skills ||
                {};


            const skillLevelEntries =
                Object.entries(
                    skillSummary.levelCounts ||
                    {}
                )
                    .map(
                        ([level, count]) => [
                            Number(level),
                            Number(count)
                        ]
                    )
                    .filter(
                        ([level, count]) =>
                            Number.isFinite(level) &&
                            Number.isFinite(count) &&
                            count >
                                0
                    )
                    .sort(
                        (a, b) =>
                            b[0] -
                            a[0]
                    );


            const skillLevelText =
                skillLevelEntries.length
                    ? skillLevelEntries
                        .map(
                            ([level, count]) =>
                                `Lv${level} ${count}개`
                        )
                        .join(
                            ' · '
                        )
                    : '레벨 데이터 없음';


            notify(
                'skills',
                skillSummary.failed
                    ? 'error'
                    : 'done',
                {
                    displayText:
                        skillLevelText,
                    ...skillSummary
                }
            );


            const traitSummary =
                heroDetailData.summary
                    ?.trait ||
                {};


            notify(
                'traits',
                traitSummary.failed
                    ? 'error'
                    : 'done',
                {
                    displayText:
                        `조사 ${traitSummary.available || 0}명 · 4/4 MAX ${traitSummary.allMaxedHeroCount || 0}명` +
                        (
                            traitSummary.failed
                                ? ` · 실패 ${traitSummary.failed}명`
                                : ''
                        ),
                    ...traitSummary
                }
            );


            const titanSummary =
                heroDetailData.summary
                    ?.titan ||
                {};


            notify(
                'equipment',
                (
                    titanSummary.failed ||
                    titanSummary.unknown
                )
                    ? 'error'
                    : 'done',
                {
                    displayText:
                        `장착 ${titanSummary.equippedHeroCount || 0}명` +
                        (
                            titanSummary.unknown
                                ? ` · 판정불가 ${titanSummary.unknown}명`
                                : ''
                        ),
                    ...titanSummary
                }
            );


            const awakeningSummary =
                heroDetailData.summary
                    ?.awakening ||
                {};


            notify(
                'awakening',
                (
                    awakeningSummary.failed ||
                    awakeningSummary.unknown
                )
                    ? 'error'
                    : 'done',
                {
                    displayText:
                        `각성 ${awakeningSummary.awakenedHeroCount || 0}명` +
                        (
                            awakeningSummary.unknown
                                ? ` · 판정불가 ${awakeningSummary.unknown}명`
                                : ''
                        ),
                    ...awakeningSummary
                }
            );
        }


        notify(
            'heroes',
            heroCollectStep.ok &&
            heroDetailData.traversalOk
                ? 'done'
                : 'error',
            {
                ownedCount:
                    heroDetailData?.collectedCount ??
                    heroData?.count ??
                    0,

                unit:
                    '명',

                displayText:
                    `${heroDetailData?.collectedCount ?? 0}명 수집 완료`,

                count:
                    heroData?.count ??
                    0,

                detailCollectedCount:
                    heroDetailData?.collectedCount ??
                    0,

                openAttempts:
                    heroOpenStep
                        ?.attempts
                        ?.length ??
                    0,

                collectAttempts:
                    heroCollectStep
                        ?.attempts
                        ?.length ??
                    0,

                reason:
                    heroDetailData?.fatalError ||
                    heroData?.reason ||
                    heroCollectStep?.reason ||
                    heroOpenStep?.reason ||
                    null
            }
        );


        const saleData = {
            /*
             * 전체 수집 성공은 핵심 구조(프로필 + 영웅 목록 + 영웅 순회) 기준.
             * 하위 상세 품질 문제는 qualityOk 및 각 세부 항목에서 별도 표현한다.
             */
            ok:
                !!profileData?.ok &&
                !!heroCollectStep?.ok &&
                !!heroDetailData?.traversalOk,

            qualityOk:
                !!heroDetailData?.qualityOk,

            schemaVersion:
                SALE_SCHEMA_VERSION,

            collectedAt:
                new Date().toISOString(),

            elapsedMs:
                Date.now() - startedAt,

            source: {
                version:
                    VERSION,

                navigatorVersion:
                    VERSION,

                profileCollectorVersion:
                    VERSION,

                heroCollectorVersion:
                    VERSION,

                schemaVersion:
                    VERSION,

                integrationVersion:
                    VERSION
            },

            account: {
                nickname: null,
                server: null,
                level: null,
                vip: null,
                power: null,

                candidates:
                    basicCandidates
            },

            profile:
                normalizeSaleProfile(
                    profileData
                ),

            heroes: {
                ok:
                    !!heroCollectStep?.ok &&
                    !!heroDetailData?.traversalOk,

                detailOk:
                    !!heroDetailData?.traversalOk,

                detailQualityOk:
                    !!heroDetailData?.qualityOk,

                closed:
                    !!heroDetailData?.closed,

                count:
                    heroData?.count ??
                    0,

                collectedCount:
                    heroDetailData
                        ?.collectedCount ??
                    0,

                items:
                    Array.isArray(
                        heroDetailData?.items
                    )
                        ? heroDetailData.items
                        : (
                            Array.isArray(
                                heroData?.items
                            )
                                ? heroData.items
                                : []
                          ),

                detailSummary:
                    heroDetailData
                        ?.summary ||
                    null,

                fatalError:
                    heroDetailData
                        ?.fatalError ??
                    null,

                detailQualityIssues: {
                    skillsFailed:
                        heroDetailData?.summary?.skills?.failed ??
                        0,
                    traitsFailed:
                        heroDetailData?.summary?.trait?.failed ??
                        0,
                    titanUnknown:
                        heroDetailData?.summary?.titan?.unknown ??
                        0,
                    awakeningUnknown:
                        heroDetailData?.summary?.awakening?.unknown ??
                        0
                },

                scrollSupported:
                    !!heroData?.scrollSupported,

                samples:
                    heroData?.samples ||
                    [],

                navigation: {
                    profileClose:
                        profileCloseStep,

                    heroOpen:
                        heroOpenStep,

                    heroCollectAttempts:
                        heroCollectStep
                            ?.attempts ||
                        [],

                    heroDetails:
                        heroDetailData
                            ?.navigation ||
                        null
                }
            },

            diagnostics: {
                profileHeaderLabels:
                    headerLabels,

                profileOk:
                    !!profileData?.ok,

                profileStage:
                    profileData?.stage ||
                    null,

                profileError:
                    profileData?.reason ||
                    profileData?.detail?.reason ||
                    null,

                profileCloseSkipped:
                    !!profileCloseStep?.skipped,

                heroOk:
                    !!heroCollectStep?.ok,

                heroDetailTraversalOk:
                    !!heroDetailData
                        ?.traversalOk,

                heroDetailQualityOk:
                    !!heroDetailData
                        ?.qualityOk,

                heroDetailStructuralOk:
                    !!heroDetailData
                        ?.traversalOk,

                heroTabsClosed:
                    !!heroDetailData
                        ?.closed,

                heroDetailFatalError:
                    heroDetailData
                        ?.fatalError ??
                    null,

                heroDetailCollectedCount:
                    heroDetailData
                        ?.collectedCount ??
                    0,

                retryPolicy: {
                    maxRetries,
                    maxAttempts:
                        maxRetries + 1,
                    retryDelay
                }
            },

            pendingCollectors: [
                'inventory'
            ]
        };

        window.TOPWAR_CHARACTER_SALE_DATA =
            saleData;

        console.log(
            '[TOPWAR_CHARACTER_SALE] 수집 완료',
            saleData
        );

        return saleData;
    }

    function getCharacterSaleData() {
        return window.TOPWAR_CHARACTER_SALE_DATA || null;
    }

    async function copyTextToClipboard(text) {
        const value = String(text ?? '');

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(value);
                return { ok: true, method: 'clipboard' };
            }
        } catch {}

        try {
            const textarea = document.createElement('textarea');
            textarea.value = value;
            textarea.style.cssText =
                'position:fixed;left:-10000px;top:-10000px;opacity:0';

            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();

            const ok = document.execCommand?.('copy') === true;
            textarea.remove();

            return {
                ok,
                method: 'execCommand',
                reason: ok ? undefined : '복사 명령 실패'
            };
        } catch (error) {
            return {
                ok: false,
                reason: error?.message || String(error)
            };
        }
    }

    async function copyCharacterSaleJson() {
        const data = getCharacterSaleData();

        if (!data) {
            return {
                ok: false,
                reason: '먼저 판매 정보를 수집하세요.'
            };
        }

        const copied =
            await copyTextToClipboard(
                JSON.stringify(
                    data,
                    null,
                    2
                )
            );

        return {
            ...copied,
            data
        };
    }

    function inspectCharacterSaleLabels() {
        const labels = collectProfileHeaderLabels();

        return {
            ok: !!profileModule.findProfileRoot(),
            labels,
            candidates:
                classifyProfileHeaderLabels(
                    labels
                )
        };
    }


    /* ============================================================
     * HERO TEXT INSPECTOR
     *
     * 영웅 Collector 구현 전 조사용.
     * 이미지/Sprite는 수집하지 않는다.
     *
     * 수집 대상:
     * - 현재 활성 화면의 cc.Label / cc.RichText
     * - Node 경로
     * - 해당 Node의 Component 이름
     * - Hero/General/Commander 계열 경로 후보
     * - 영웅 관련 버튼 이벤트 후보
     *
     * 결과:
     *   window.TOPWAR_HERO_TEXT_INSPECTION
     * ============================================================ */

    const HERO_TEXT_HINT =
        /(hero|general|commander)/i;


    /*
     * 조사 중 게임 화면 오조작 방지용 보호기.
     * 화면 전체를 덮어 클릭/터치를 차단하고, 보호기 내부의 중지 버튼만 허용한다.
     */
    let activeInspectionGuard =
        null;


    function openInspectionGuard(
        options = {}
    ) {

        if (
            activeInspectionGuard
        ) {

            try {
                if (
                    activeInspectionGuard.element &&
                    typeof activeInspectionGuard.element.remove === 'function'
                ) {
                    activeInspectionGuard.element.remove();
                }
            } catch {}

            activeInspectionGuard =
                null;
        }


        const guard = {
            cancelled:
                false,

            element:
                null,

            message:
                null,

            stopButton:
                null
        };


        const overlay =
            document.createElement(
                'div'
            );

        overlay.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:2147483647',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'background:rgba(0,0,0,.62)',
            'backdrop-filter:blur(2px)',
            'pointer-events:auto',
            'touch-action:none',
            'user-select:none'
        ].join(';');


        const box =
            document.createElement(
                'div'
            );

        box.style.cssText = [
            'min-width:280px',
            'max-width:min(90vw,460px)',
            'padding:18px',
            'border-radius:12px',
            'border:1px solid rgba(255,255,255,.22)',
            'background:#171b1d',
            'box-shadow:0 12px 40px rgba(0,0,0,.55)',
            'color:#fff',
            'font-family:Arial,sans-serif',
            'text-align:center'
        ].join(';');

        overlay.appendChild(
            box
        );


        const title =
            document.createElement(
                'div'
            );

        title.textContent =
            options.title ||
            '정보 조사 중';

        title.style.cssText =
            'font-size:16px;font-weight:700;margin-bottom:10px';

        box.appendChild(
            title
        );


        const spinner =
            document.createElement(
                'div'
            );

        spinner.style.cssText = [
            'width:28px',
            'height:28px',
            'margin:4px auto 12px',
            'border:3px solid #555',
            'border-top-color:#ddd',
            'border-radius:50%',
            'animation:topwar-sale-spin .75s linear infinite'
        ].join(';');

        box.appendChild(
            spinner
        );


        const message =
            document.createElement(
                'div'
            );

        message.textContent =
            options.message ||
            '조사 중에는 게임 화면 클릭이 차단됩니다.';

        message.style.cssText =
            'font-size:12px;line-height:1.55;color:#d8d8d8;margin-bottom:14px;white-space:pre-line';

        box.appendChild(
            message
        );


        const stopButton =
            document.createElement(
                'button'
            );

        stopButton.type =
            'button';

        stopButton.textContent =
            '조사 중지';

        stopButton.style.cssText = [
            'min-width:120px',
            'height:36px',
            'border:1px solid #b65b5b',
            'border-radius:7px',
            'background:#733939',
            'color:#fff',
            'font-weight:700',
            'cursor:pointer'
        ].join(';');

        box.appendChild(
            stopButton
        );


        stopButton.addEventListener(
            'click',
            event => {

                event.preventDefault();
                event.stopPropagation();

                if (
                    guard.cancelled
                )
                    return;


                guard.cancelled =
                    true;

                stopButton.disabled =
                    true;

                stopButton.textContent =
                    '중지 요청됨';

                message.textContent =
                    '현재 조사 단계를 안전하게 중지하고 있습니다...';
            }
        );


        /*
         * 오버레이 자체가 게임 Canvas 위를 덮기 때문에 일반 클릭/터치는 여기서 끝난다.
         * 우클릭 메뉴도 막아서 조사 중 실수로 게임 조작이 들어가는 것을 방지한다.
         */
        overlay.addEventListener(
            'contextmenu',
            event => {
                event.preventDefault();
            }
        );


        document.body.appendChild(
            overlay
        );


        guard.element =
            overlay;

        guard.message =
            message;

        guard.stopButton =
            stopButton;


        activeInspectionGuard =
            guard;


        return guard;
    }


    function closeInspectionGuard(
        guard
    ) {

        if (!guard)
            return;


        try {
            if (
                guard.element &&
                typeof guard.element.remove === 'function'
            ) {
                guard.element.remove();
            }
        } catch {}


        if (
            activeInspectionGuard ===
            guard
        ) {

            activeInspectionGuard =
                null;
        }
    }


    function stopActiveInspection() {

        if (
            !activeInspectionGuard
        ) {

            return {
                ok: false,
                reason:
                    '현재 진행 중인 조사가 없습니다.'
            };
        }


        activeInspectionGuard.cancelled =
            true;


        if (
            activeInspectionGuard
                .stopButton
        ) {

            activeInspectionGuard
                .stopButton
                .disabled =
                true;

            activeInspectionGuard
                .stopButton
                .textContent =
                '중지 요청됨';
        }


        if (
            activeInspectionGuard
                .message
        ) {

            activeInspectionGuard
                .message
                .textContent =
                '현재 조사 단계를 안전하게 중지하고 있습니다...';
        }


        return {
            ok: true
        };
    }


    async function inspectionYield() {

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    0
                )
        );
    }


    function activeComponentNames(node) {

        const names =
            [];

        try {

            for (
                const component
                of (
                    node?._components ||
                    []
                )
            ) {

                const name =
                    componentName(
                        component
                    );

                if (
                    name &&
                    !names.includes(
                        name
                    )
                ) {

                    names.push(
                        name
                    );
                }
            }

        } catch {}


        return names;
    }


    function readNodeTextComponents(node) {

        const rows =
            [];


        try {

            const label =
                (
                    node &&
                    typeof node.getComponent === 'function' &&
                    window.cc &&
                    window.cc.Label
                )
                    ? node.getComponent(window.cc.Label)
                    : null;

            const value =
                String(
                    label?.string ??
                    ''
                ).trim();

            if (value) {

                rows.push({
                    type:
                        'cc.Label',

                    text:
                        value
                });
            }

        } catch {}


        try {

            const rich =
                (
                    node &&
                    typeof node.getComponent === 'function' &&
                    window.cc &&
                    window.cc.RichText
                )
                    ? node.getComponent(window.cc.RichText)
                    : null;

            const value =
                String(
                    rich?.string ??
                    ''
                ).trim();

            if (value) {

                rows.push({
                    type:
                        'cc.RichText',

                    text:
                        value
                });
            }

        } catch {}


        return rows;
    }


    function primitiveComponentFields(
        component,
        options = {}
    ) {

        const maxFields =
            Math.max(
                20,
                Math.min(
                    300,
                    Number(
                        options.maxFields ??
                        120
                    )
                )
            );


        const result = {};
        let count = 0;


        const importantKey =
            /(hero|id|level|lv|star|grade|quality|rank|awake|awaken|skill|data|info|model|exp|state|own|have|lock)/i;


        const put =
            (key, value) => {

                if (
                    count >=
                    maxFields
                )
                    return;


                if (
                    value == null ||
                    typeof value === 'string' ||
                    typeof value === 'number' ||
                    typeof value === 'boolean'
                ) {

                    result[key] =
                        value;

                    count += 1;
                }
            };


        try {

            for (
                const key
                of Object.keys(
                    component || {}
                )
            ) {

                if (
                    count >=
                    maxFields
                )
                    break;


                let value;

                try {
                    value =
                        component[key];
                } catch {
                    continue;
                }


                if (
                    value == null ||
                    typeof value === 'string' ||
                    typeof value === 'number' ||
                    typeof value === 'boolean'
                ) {

                    /*
                     * Cocos 내부 플래그가 너무 많이 섞이므로,
                     * 일반 필드 또는 영웅 관련 이름의 필드를 우선 보존한다.
                     */
                    if (
                        !key.startsWith('_') ||
                        importantKey.test(key)
                    ) {

                        put(
                            key,
                            value
                        );
                    }

                    continue;
                }


                /*
                 * data/info/model 류의 평범한 Object는 한 단계만 펼친다.
                 * Node/Component/Sprite 같은 객체는 건드리지 않는다.
                 */
                if (
                    importantKey.test(key) &&
                    typeof value === 'object' &&
                    !Array.isArray(value) &&
                    value?.constructor === Object
                ) {

                    for (
                        const [childKey, childValue]
                        of Object.entries(
                            value
                        )
                    ) {

                        if (
                            count >=
                            maxFields
                        )
                            break;


                        if (
                            childValue == null ||
                            typeof childValue === 'string' ||
                            typeof childValue === 'number' ||
                            typeof childValue === 'boolean'
                        ) {

                            put(
                                `${key}.${childKey}`,
                                childValue
                            );
                        }
                    }
                }
            }

        } catch {}


        return result;
    }


    function directChildStates(node) {

        return (
            node?.children ||
            []
        ).map(
            child => ({
                name:
                    String(
                        child?.name ||
                        ''
                    ),

                active:
                    !!child?.active,

                activeInHierarchy:
                    !!child?.activeInHierarchy
            })
        );
    }


    function findDirectChild(
        node,
        name
    ) {

        return (
            node?.children ||
            []
        ).find(
            child =>
                child?.name ===
                name
        ) || null;
    }


    function findDescendantByName(
        root,
        name
    ) {

        if (!root)
            return null;


        let found =
            null;


        walk(
            root,
            node => {

                if (
                    found ||
                    node === root
                )
                    return;


                if (
                    node?.name ===
                    name
                ) {

                    found =
                        node;
                }
            },
            {
                includeInactive:
                    true
            }
        );


        return found;
    }


    function nodeLabelText(
        node
    ) {

        if (!node)
            return '';


        try {

            const label =
                node.getComponent?.(
                    window.cc?.Label
                );


            return String(
                label?.string ??
                ''
            ).trim();

        } catch {

            return '';
        }
    }


    function parseNumberText(
        value
    ) {

        const match =
            String(
                value ||
                ''
            )
                .replace(
                    /,/g,
                    ''
                )
                .match(
                    /-?\d+(?:\.\d+)?/
                );


        return match
            ? Number(
                match[0]
              )
            : null;
    }


    function heroRarityPrimitiveEvidence(
        value,
        options = {}
    ) {

        const maxDepth =
            Math.max(
                1,
                Math.min(
                    4,
                    Number(
                        options.maxDepth ??
                        3
                    )
                )
            );


        const maxRows =
            Math.max(
                20,
                Math.min(
                    300,
                    Number(
                        options.maxRows ??
                        120
                    )
                )
            );


        const rows =
            [];

        const seen =
            new WeakSet();


        const keyPattern =
            /(rarity|quality|heroquality|hero_quality|qualityid|quality_id|rarityid|rarity_id|grade|heroGrade)/i;


        const visit =
            (
                current,
                path,
                depth
            ) => {

                if (
                    current == null ||
                    depth >
                        maxDepth ||
                    rows.length >=
                        maxRows
                )
                    return;


                if (
                    typeof current !==
                    'object'
                )
                    return;


                try {

                    if (
                        seen.has(
                            current
                        )
                    )
                        return;


                    seen.add(
                        current
                    );

                } catch {}


                let keys =
                    [];


                try {

                    keys =
                        Object.keys(
                            current
                        );

                } catch {

                    return;
                }


                for (
                    const key
                    of keys
                ) {

                    if (
                        rows.length >=
                        maxRows
                    )
                        break;


                    let child;


                    try {

                        child =
                            current[key];

                    } catch {

                        continue;
                    }


                    const childPath =
                        path
                            ? `${path}.${key}`
                            : key;


                    if (
                        keyPattern.test(
                            key
                        ) &&
                        (
                            child == null ||
                            typeof child ===
                                'string' ||
                            typeof child ===
                                'number' ||
                            typeof child ===
                                'boolean'
                        )
                    ) {

                        rows.push({
                            source:
                                'component-field',
                            key:
                                childPath,
                            value:
                                child
                        });
                    }


                    if (
                        depth <
                            maxDepth &&
                        child &&
                        typeof child ===
                            'object' &&
                        !Array.isArray(
                            child
                        )
                    ) {

                        /*
                         * Node/Component 전체 그래프를 무한히 타지 않도록
                         * 영웅/데이터/품질 관련 경로만 더 깊게 본다.
                         */
                        if (
                            /(hero|data|info|model|config|cfg|quality|rarity|grade)/i
                                .test(
                                    key
                                )
                        ) {

                            visit(
                                child,
                                childPath,
                                depth + 1
                            );
                        }
                    }
                }
            };


        visit(
            value,
            '',
            0
        );


        return rows;
    }


    function heroRaritySpriteEvidence(
        root
    ) {

        const rows =
            [];


        if (
            !root ||
            !window.cc?.Sprite
        )
            return rows;


        walk(
            root,
            node => {

                let sprite =
                    null;


                try {

                    sprite =
                        node.getComponent?.(
                            window.cc.Sprite
                        );

                } catch {}


                if (!sprite)
                    return;


                const frame =
                    sprite.spriteFrame;


                const frameName =
                    String(
                        frame?.name ||
                        frame?._name ||
                        ''
                    ).trim();


                if (
                    !frameName
                )
                    return;


                if (
                    /(ssr|rarity|quality|grade|hero.*frame|frame.*hero|orange|gold)/i
                        .test(
                            frameName
                        )
                ) {

                    rows.push({
                        source:
                            'sprite-frame',
                        node:
                            node.name ||
                            '',
                        path:
                            nodePath(
                                node
                            ),
                        value:
                            frameName
                    });
                }
            },
            {
                includeInactive:
                    true
            }
        );


        return rows;
    }


    function heroRarityTextEvidence(
        root
    ) {

        const rows =
            [];


        if (!root)
            return rows;


        walk(
            root,
            node => {

                const text =
                    nodeLabelText(
                        node
                    );


                if (
                    /^(?:SSR|SR|R)$/i
                        .test(
                            text
                        )
                ) {

                    rows.push({
                        source:
                            'label',
                        node:
                            node.name ||
                            '',
                        path:
                            nodePath(
                                node
                            ),
                        value:
                            text.toUpperCase()
                    });
                }
            },
            {
                includeInactive:
                    true
            }
        );


        return rows;
    }


    function collectHeroRarityEvidence(
        listItemNode,
        heroItemNode
    ) {

        const rows =
            [];


        for (
            const node
            of [
                listItemNode,
                heroItemNode
            ]
        ) {

            for (
                const component
                of (
                    node?._components ||
                    []
                )
            ) {

                const componentRows =
                    heroRarityPrimitiveEvidence(
                        component
                    );


                for (
                    const row
                    of componentRows
                ) {

                    rows.push({
                        ...row,
                        component:
                            componentName(
                                component
                            )
                    });
                }
            }
        }


        rows.push(
            ...heroRaritySpriteEvidence(
                heroItemNode
            )
        );


        rows.push(
            ...heroRarityTextEvidence(
                heroItemNode
            )
        );


        return rows;
    }


    function directHeroRarityFromEvidence(
        evidence
    ) {

        const values =
            (
                evidence ||
                []
            ).map(
                row =>
                    String(
                        row?.value ??
                        ''
                    ).trim()
            );


        for (
            const value
            of values
        ) {

            if (
                /(^|[^A-Z])SSR([^A-Z]|$)/i
                    .test(
                        value
                    )
            ) {

                return {
                    rarity:
                        'SSR',
                    confidence:
                        'DIRECT',
                    evidence:
                        value
                };
            }
        }


        for (
            const value
            of values
        ) {

            if (
                /(^|[^A-Z])SR([^A-Z]|$)/i
                    .test(
                        value
                    )
            ) {

                return {
                    rarity:
                        'SR',
                    confidence:
                        'DIRECT',
                    evidence:
                        value
                };
            }
        }


        for (
            const value
            of values
        ) {

            if (
                /^(?:R)$/i
                    .test(
                        value
                    )
            ) {

                return {
                    rarity:
                        'R',
                    confidence:
                        'DIRECT',
                    evidence:
                        value
                };
            }
        }


        return null;
    }


    function numericHeroQualityCandidates(
        item
    ) {

        return (
            item?.rarityEvidence ||
            []
        )
            .filter(
                row =>
                    /(quality|rarity)/i
                        .test(
                            String(
                                row?.key ||
                                ''
                            )
                        )
            )
            .map(
                row =>
                    Number(
                        row?.value
                    )
            )
            .filter(
                value =>
                    Number.isFinite(
                        value
                    )
            );
    }


    function applyHeroRarityClassification(
        items
    ) {

        const rows =
            (
                items ||
                []
            ).map(
                item => ({
                    ...item
                })
            );


        /*
         * 1. SSR/SR/R 문자열이 UI/컴포넌트에 직접 있으면 그 값을 최우선 사용.
         */
        for (
            const item
            of rows
        ) {

            const direct =
                directHeroRarityFromEvidence(
                    item.rarityEvidence
                );


            if (direct) {

                item.rarity =
                    direct.rarity;

                item.rarityConfidence =
                    direct.confidence;

                item.rarityBasis =
                    direct.evidence;
            }
        }


        /*
         * 2. quality/rarity가 숫자로만 들어있는 경우:
         *    전체 영웅에서 서로 다른 값이 2개 이상이면 가장 큰 값을 SSR로 본다.
         *
         * TopWar 내부 enum 값 자체를 하드코딩하지 않기 때문에
         * 게임 버전이 바뀌어도 최고 rarity tier를 동적으로 선택한다.
         */
        const numericValues =
            [];


        for (
            const item
            of rows
        ) {

            for (
                const value
                of numericHeroQualityCandidates(
                    item
                )
            ) {

                numericValues.push(
                    value
                );
            }
        }


        const uniqueNumericValues =
            [
                ...new Set(
                    numericValues
                )
            ].sort(
                (a, b) =>
                    a - b
            );


        const maxNumericQuality =
            uniqueNumericValues.length >=
                2
                ? uniqueNumericValues[
                    uniqueNumericValues.length -
                    1
                  ]
                : null;


        for (
            const item
            of rows
        ) {

            if (
                item.rarity
            )
                continue;


            const candidates =
                numericHeroQualityCandidates(
                    item
                );


            if (
                maxNumericQuality != null &&
                candidates.includes(
                    maxNumericQuality
                )
            ) {

                item.rarity =
                    'SSR';

                item.rarityConfidence =
                    'NUMERIC_MAX';

                item.rarityBasis =
                    maxNumericQuality;

            } else if (
                maxNumericQuality != null &&
                candidates.length
            ) {

                item.rarity =
                    'NON_SSR';

                item.rarityConfidence =
                    'NUMERIC_LOWER';

                item.rarityBasis =
                    Math.max(
                        ...candidates
                    );

            } else {

                item.rarity =
                    'UNKNOWN';

                item.rarityConfidence =
                    'NONE';

                item.rarityBasis =
                    null;
            }
        }


        const summary = {
            total:
                rows.length,

            ssr:
                rows.filter(
                    item =>
                        item.rarity ===
                        'SSR'
                ).length,

            nonSsr:
                rows.filter(
                    item =>
                        item.rarity ===
                        'NON_SSR' ||
                        item.rarity ===
                        'SR' ||
                        item.rarity ===
                        'R'
                ).length,

            unknown:
                rows.filter(
                    item =>
                        item.rarity ===
                        'UNKNOWN'
                ).length,

            numericQualityValues:
                uniqueNumericValues,

            maxNumericQuality
        };


        return {
            items:
                rows,
            summary
        };
    }


    function inspectVisibleHeroItems() {

        const root =
            scene();


        if (!root)
            return [];


        const rows = [];


        walk(
            root,
            node => {

                if (
                    !isActive(node) ||
                    node?.name !==
                        'HeroListItem2026'
                )
                    return;


                const heroNode =
                    findDirectChild(
                        node,
                        'heroNode'
                    );


                const heroItemNode =
                    findDirectChild(
                        heroNode,
                        'HeroItem2026'
                    );


                if (!heroItemNode)
                    return;


                const nameNode =
                    findDirectChild(
                        heroItemNode,
                        'name'
                    );


                let heroName = '';

                try {
                    let nameLabel = null;

                    if (
                        nameNode &&
                        typeof nameNode.getComponent === 'function' &&
                        window.cc &&
                        window.cc.Label
                    ) {

                        nameLabel =
                            nameNode.getComponent(
                                window.cc.Label
                            );
                    }


                    heroName =
                        String(
                            nameLabel &&
                            nameLabel.string != null
                                ? nameLabel.string
                                : ''
                        ).trim();
                } catch {}


                const starNode =
                    findDirectChild(
                        heroItemNode,
                        'starNode'
                    );


                const normalNode =
                    findDirectChild(
                        heroItemNode,
                        'normal'
                    );


                const frameBg =
                    findDirectChild(
                        heroItemNode,
                        'frameBg'
                    );


                const levelNode =
                    findDescendantByName(
                        normalNode,
                        'level'
                    );


                const levelText =
                    nodeLabelText(
                        levelNode
                    );


                const awakenNode =
                    findDirectChild(
                        heroItemNode,
                        'awakenNode'
                    );


                const awakenLevelNode =
                    findDescendantByName(
                        awakenNode,
                        'awakenLevel'
                    );


                const awakenLevelText =
                    nodeLabelText(
                        awakenLevelNode
                    );


                const star =
                    (
                        starNode
                            ?.children ||
                        []
                    ).filter(
                        child =>
                            child
                                ?.activeInHierarchy
                    ).length;


                const components = {};


                for (
                    const component
                    of (
                        heroItemNode
                            ?._components ||
                        []
                    )
                ) {

                    const name =
                        componentName(
                            component
                        );


                    if (
                        ![
                            'HeroItem2026',
                            'HeroAwakenNode'
                        ].includes(name)
                    )
                        continue;


                    components[name] =
                        primitiveComponentFields(
                            component
                        );
                }


                for (
                    const component
                    of (
                        node?._components ||
                        []
                    )
                ) {

                    const name =
                        componentName(
                            component
                        );


                    if (
                        name !==
                        'HeroListItem2026'
                    )
                        continue;


                    components[name] =
                        primitiveComponentFields(
                            component
                        );
                }


                const numericContainer =
                    node.parent;


                const containerName =
                    String(
                        numericContainer
                            ?.name ||
                        ''
                    );


                const rarityEvidence =
                    collectHeroRarityEvidence(
                        node,
                        heroItemNode
                    );


                rows.push({
                    heroIdCandidate:
                        /^\d+$/.test(
                            containerName
                        )
                            ? Number(
                                containerName
                              )
                            : null,

                    containerName,

                    name:
                        heroName,

                    levelText,

                    level:
                        parseNumberText(
                            levelText
                        ),

                    star,

                    awakenLevelText,

                    awakenLevel:
                        parseNumberText(
                            awakenLevelText
                        ),

                    rarityEvidence,

                    path:
                        nodePath(
                            node
                        ),

                    components,

                    starNode: {
                        childCount:
                            starNode
                                ?.children
                                ?.length ??
                            0,

                        activeChildCount:
                            (
                                starNode
                                    ?.children ||
                                []
                            ).filter(
                                child =>
                                    child
                                        ?.activeInHierarchy
                            ).length,

                        children:
                            directChildStates(
                                starNode
                            )
                    },

                    normalNode: {
                        active:
                            !!normalNode
                                ?.active,

                        activeInHierarchy:
                            !!normalNode
                                ?.activeInHierarchy,

                        children:
                            directChildStates(
                                normalNode
                            )
                    },

                    frameBg: {
                        active:
                            !!frameBg
                                ?.active,

                        activeInHierarchy:
                            !!frameBg
                                ?.activeInHierarchy
                    }
                });
            }
        );


        return rows;
    }


    async function inspectHeroScreenTexts(
        options = {}
    ) {

        const root =
            scene();


        if (!root) {

            return {
                ok: false,
                reason:
                    '현재 Cocos Scene을 찾지 못했습니다.'
            };
        }


        const isCancelled =
            () => {

                try {

                    return (
                        typeof options.shouldStop ===
                        'function'
                    )
                        ? !!options.shouldStop()
                        : false;

                } catch {

                    return false;
                }
            };


        const maxTexts =
            Math.max(
                50,
                Math.min(
                    2000,
                    Number(
                        options.maxTexts ??
                        800
                    )
                )
            );


        const texts =
            [];

        const seen =
            new Set();

        const heroCandidateNodes =
            [];


        /*
         * 기존 walk() 대신 직접 Stack을 돌려 중간중간 이벤트 루프를 양보한다.
         * 그래야 보호기의 '조사 중지' 버튼이 실제로 반응할 수 있다.
         */
        const stack =
            [root];

        let visited =
            0;


        while (
            stack.length
        ) {

            if (
                isCancelled()
            ) {

                return {
                    ok: false,
                    cancelled: true,
                    reason:
                        '사용자가 조사를 중지했습니다.',
                    partial: {
                        totalActiveTexts:
                            texts.length,
                        heroLikeTexts:
                            texts.filter(
                                row =>
                                    row.heroLike
                            ).length,
                        heroCandidateNodes:
                            heroCandidateNodes.length
                    }
                };
            }


            const node =
                stack.pop();


            if (!node)
                continue;


            const children =
                node.children ||
                [];


            for (
                let index =
                    children.length - 1;
                index >= 0;
                index -= 1
            ) {

                stack.push(
                    children[index]
                );
            }


            if (
                !isActive(
                    node
                )
            )
                continue;


            const path =
                nodePath(
                    node
                );

            const components =
                activeComponentNames(
                    node
                );


            const heroLike =
                HERO_TEXT_HINT.test(
                    [
                        node?.name || '',
                        path,
                        ...components
                    ].join(' ')
                );


            if (heroLike) {

                heroCandidateNodes.push({
                    name:
                        String(
                            node?.name ||
                            ''
                        ),

                    path,

                    components
                });
            }


            for (
                const item
                of readNodeTextComponents(
                    node
                )
            ) {

                if (
                    texts.length >=
                    maxTexts
                )
                    break;


                const key =
                    JSON.stringify([
                        path,
                        item.type,
                        item.text
                    ]);


                if (
                    seen.has(
                        key
                    )
                )
                    continue;


                seen.add(
                    key
                );


                texts.push({
                    name:
                        String(
                            node?.name ||
                            ''
                        ),

                    path,

                    type:
                        item.type,

                    text:
                        item.text,

                    components,

                    heroLike
                });
            }


            visited += 1;


            /*
             * 일정 노드마다 브라우저 이벤트 루프에 제어권을 돌려준다.
             */
            if (
                visited % 120 ===
                0
            ) {

                await inspectionYield();
            }
        }


        if (
            isCancelled()
        ) {

            return {
                ok: false,
                cancelled: true,
                reason:
                    '사용자가 조사를 중지했습니다.'
            };
        }


        const heroTexts =
            texts.filter(
                row =>
                    row.heroLike
            );


        const buttonRows =
            typeof listGameButtons ===
                'function'
                ? listGameButtons()
                : [];


        const heroButtons =
            buttonRows.filter(
                row =>
                    HERO_TEXT_HINT.test(
                        [
                            row?.name || '',
                            row?.path || '',
                            row?.text || '',
                            JSON.stringify(
                                row?.events ||
                                []
                            )
                        ].join(' ')
                    )
            );


        if (
            isCancelled()
        ) {

            return {
                ok: false,
                cancelled: true,
                reason:
                    '사용자가 조사를 중지했습니다.'
            };
        }


        /*
         * 카드 세부 정보는 텍스트 순회가 끝난 뒤 조사한다.
         */
        const heroItems =
            inspectVisibleHeroItems();


        await inspectionYield();


        if (
            isCancelled()
        ) {

            return {
                ok: false,
                cancelled: true,
                reason:
                    '사용자가 조사를 중지했습니다.'
            };
        }


        const result = {
            ok: true,

            inspectedAt:
                new Date()
                    .toISOString(),

            scene: {
                name:
                    String(
                        root?.name ||
                        ''
                    ),

                path:
                    nodePath(
                        root
                    )
            },

            summary: {
                totalActiveTexts:
                    texts.length,

                heroLikeTexts:
                    heroTexts.length,

                heroCandidateNodes:
                    heroCandidateNodes.length,

                heroRelatedButtons:
                    heroButtons.length,

                heroItems:
                    heroItems.length,

                truncated:
                    texts.length >=
                    maxTexts
            },

            heroTexts,

            allActiveTexts:
                texts,

            candidateNodes:
                heroCandidateNodes,

            relatedButtons:
                heroButtons,

            /*
             * Sprite 정보는 읽지 않고 HeroItem 컴포넌트의 primitive 데이터와
             * star/normal 노드의 활성 상태만 조사한다.
             */
            heroItems,

            notes: [
                'Sprite/이미지는 수집하지 않음',
                'HeroListItem2026 / HeroItem2026 / HeroAwakenNode primitive 필드 조사 포함',
                'starNode는 이미지 대신 자식 노드의 개수와 active 상태만 조사',
                'levelBg는 이미지 정보를 읽지 않으며 HeroItem 컴포넌트 데이터에서 레벨 후보를 찾음',
                '영웅 화면을 연 상태에서 다시 조사하면 목록/상세 구조를 비교할 수 있음'
            ]
        };


        window.TOPWAR_HERO_TEXT_INSPECTION =
            result;


        console.log(
            '[TOPWAR_HERO_TEXT_INSPECTION]',
            result
        );


        return result;
    }


    /* ============================================================
     * AWAKEN SKILL DATA INSPECTOR
     *
     * 목적:
     * - 각성 스킬의 현재/다음 단계
     * - 단계 해제 추가 효과
     * - 전속 스킬 연동 조건
     * - 승격 비용
     * - HeroAwakenSkillItem / HeroAwakenSkillUpPop 관련
     *   component 내부 config/data 후보
     *
     * 주의:
     * - 승격/레벨업 버튼을 누르지 않는다.
     * - Sprite/Texture/Asset 데이터는 수집하지 않는다.
     * - 단계 수를 5로 고정하지 않는다.
     *
     * 결과:
     *   window.TOPWAR_AWAKEN_SKILL_INSPECTION
     * ============================================================ */

    const AWAKEN_SKILL_COMPONENT_HINT =
        /(HeroAwakenSkillItem|HeroAwakenSkillUpPop|HeroDetailAwaken|Awaken.*Skill|Skill.*Awaken)/i;

    const AWAKEN_DATA_KEY_HINT =
        /(skill|awaken|stage|level|lv|max|id|config|cfg|data|info|effect|buff|value|cost|exp|need|unlock|hero|exclusive|special|quality|rank)/i;


    function isPlainObjectValue(value) {

        if (
            !value ||
            typeof value !== 'object'
        )
            return false;


        const proto =
            Object.getPrototypeOf(
                value
            );


        return (
            proto === Object.prototype ||
            proto === null
        );
    }


    function awakenSafeValue(
        value,
        depth = 0,
        state = null
    ) {

        const ctx =
            state || {
                seen:
                    new WeakSet(),

                count:
                    0,

                maxCount:
                    600
            };


        if (
            value == null ||
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {

            if (
                typeof value === 'string' &&
                value.length > 1200
            ) {

                return (
                    value.slice(
                        0,
                        1200
                    ) +
                    '…'
                );
            }


            return value;
        }


        if (
            typeof value === 'function' ||
            typeof value === 'symbol' ||
            typeof value === 'bigint'
        ) {

            return undefined;
        }


        if (
            depth >= 3 ||
            ctx.count >=
                ctx.maxCount
        ) {

            return undefined;
        }


        if (
            typeof value !==
            'object'
        ) {

            return undefined;
        }


        try {

            if (
                ctx.seen.has(
                    value
                )
            ) {

                return '[Circular]';
            }


            ctx.seen.add(
                value
            );

        } catch {}


        const constructorName =
            String(
                value
                    ?.constructor
                    ?.name ||
                ''
            );


        /*
         * Cocos/리소스 객체는 순환 참조가 크고 이미지 정보까지 포함할 수 있으므로 제외한다.
         */
        if (
            /(Node|Component|Sprite|Texture|Asset|Material|Label|Button|Toggle|Animation|Camera|Widget|Layout|ScrollView)/i
                .test(
                    constructorName
                )
        ) {

            return undefined;
        }


        ctx.count += 1;


        if (
            Array.isArray(
                value
            )
        ) {

            const result =
                [];


            for (
                let index = 0;
                index < value.length &&
                index < 60;
                index += 1
            ) {

                const child =
                    awakenSafeValue(
                        value[index],
                        depth + 1,
                        ctx
                    );


                if (
                    child !==
                    undefined
                ) {

                    result.push(
                        child
                    );
                }
            }


            return result;
        }


        if (
            !isPlainObjectValue(
                value
            )
        ) {

            return undefined;
        }


        const result =
            {};


        for (
            const key
            of Object.keys(
                value
            )
        ) {

            if (
                ctx.count >=
                ctx.maxCount
            )
                break;


            let childValue;

            try {
                childValue =
                    value[key];
            } catch {
                continue;
            }


            /*
             * object/array는 관련성이 높은 key만 펼친다.
             * primitive는 작은 설정 객체를 놓치지 않기 위해 그대로 허용한다.
             */
            const primitive =
                (
                    childValue == null ||
                    typeof childValue === 'string' ||
                    typeof childValue === 'number' ||
                    typeof childValue === 'boolean'
                );


            if (
                !primitive &&
                !AWAKEN_DATA_KEY_HINT
                    .test(
                        key
                    )
            ) {

                continue;
            }


            const child =
                awakenSafeValue(
                    childValue,
                    depth + 1,
                    ctx
                );


            if (
                child !==
                undefined
            ) {

                result[key] =
                    child;
            }
        }


        return result;
    }


    function inspectAwakenComponent(
        component
    ) {

        const result =
            {};

        const ctx = {
            seen:
                new WeakSet(),

            count:
                0,

            maxCount:
                600
        };


        for (
            const key
            of Object.keys(
                component ||
                {}
            )
        ) {

            let value;

            try {
                value =
                    component[key];
            } catch {
                continue;
            }


            const primitive =
                (
                    value == null ||
                    typeof value === 'string' ||
                    typeof value === 'number' ||
                    typeof value === 'boolean'
                );


            /*
             * primitive 필드는 대부분 보존.
             * object/array는 각성/스킬/config/data 관련 key만 조사.
             */
            if (
                !primitive &&
                !AWAKEN_DATA_KEY_HINT
                    .test(
                        key
                    )
            ) {

                continue;
            }


            const safe =
                awakenSafeValue(
                    value,
                    0,
                    ctx
                );


            if (
                safe !==
                undefined
            ) {

                result[key] =
                    safe;
            }
        }


        return result;
    }


    function findActiveNodeByName(
        name
    ) {

        const root =
            scene();

        let found =
            null;


        if (!root)
            return null;


        walk(
            root,
            node => {

                if (
                    found ||
                    !isActive(
                        node
                    )
                )
                    return;


                if (
                    node?.name ===
                    name
                ) {

                    found =
                        node;
                }
            }
        );


        return found;
    }


    function collectTextsUnderNode(
        root,
        maxTexts = 400
    ) {

        const rows =
            [];

        const seen =
            new Set();


        if (!root)
            return rows;


        walk(
            root,
            node => {

                if (
                    rows.length >=
                    maxTexts ||
                    !isActive(
                        node
                    )
                )
                    return;


                const path =
                    nodePath(
                        node
                    );


                for (
                    const item
                    of readNodeTextComponents(
                        node
                    )
                ) {

                    const key =
                        [
                            path,
                            item.type,
                            item.text
                        ].join(
                            '\u0000'
                        );


                    if (
                        seen.has(
                            key
                        )
                    )
                        continue;


                    seen.add(
                        key
                    );


                    rows.push({
                        name:
                            String(
                                node?.name ||
                                ''
                            ),

                        path,

                        type:
                            item.type,

                        text:
                            item.text
                    });
                }
            }
        );


        return rows;
    }


    function firstTextByNodeName(
        rows,
        name
    ) {

        const found =
            (
                rows ||
                []
            ).find(
                row =>
                    row?.name ===
                    name
            );


        return (
            found?.text ||
            ''
        );
    }


    function parseStageNumber(
        value
    ) {

        const match =
            String(
                value ||
                ''
            ).match(
                /(\d+)\s*단계/
            );


        return match
            ? Number(
                match[1]
              )
            : null;
    }


    function awakenSkillPopupComponent(
        popup
    ) {

        if (!popup)
            return null;


        for (
            const component
            of (
                popup._components ||
                []
            )
        ) {

            if (
                componentName(
                    component
                ) ===
                'HeroAwakenSkillUpPop'
            ) {

                return component;
            }
        }


        return null;
    }


    function awakenStageCandidates(
        rows
    ) {

        const stages =
            [];


        for (
            const row
            of (
                rows ||
                []
            )
        ) {

            const matches =
                String(
                    row?.text ||
                    ''
                ).matchAll(
                    /(\d+)\s*단계/g
                );


            for (
                const match
                of matches
            ) {

                const stage =
                    Number(
                        match[1]
                    );


                if (
                    Number.isFinite(
                        stage
                    ) &&
                    !stages.includes(
                        stage
                    )
                ) {

                    stages.push(
                        stage
                    );
                }
            }
        }


        return stages.sort(
            (a, b) =>
                a - b
        );
    }


    function findAwakenSkillPopupCloseButtonRow() {

        if (
            typeof gameButtonRows !==
            'function'
        )
            return null;


        const matches =
            gameButtonRows().filter(
                row => {

                    if (
                        !/HeroAwakenSkillUpPop/
                            .test(
                                row?.path ||
                                ''
                            )
                    )
                        return false;


                    if (
                        !(
                            row?.name ===
                                'btn_close' ||
                            row?.name ===
                                'closeBtn'
                        )
                    )
                        return false;


                    return (
                        row?.events ||
                        []
                    ).some(
                        event =>
                            event?.handler ===
                            'onCloseClick'
                    );
                }
            );


        return (
            matches.length
                ? matches[0]
                : null
        );
    }


    function findAwakenMaxPreviewButtonRow() {

        if (
            typeof gameButtonRows !==
            'function'
        )
            return null;


        const matches =
            gameButtonRows().filter(
                row => {

                    if (
                        row?.name !==
                        'btn_max_preview_0'
                    )
                        return false;


                    if (
                        !/HeroAwakenSkillUpPop/
                            .test(
                                row?.path ||
                                ''
                            )
                    )
                        return false;


                    return (
                        row?.events ||
                        []
                    ).some(
                        event =>
                            event?.handler ===
                            'onMaxLevelPreviewClick'
                    );
                }
            );


        return (
            matches.length === 1
                ? matches[0]
                : null
        );
    }


    function awakenPopupSnapshot(
        popup
    ) {

        const rows =
            collectTextsUnderNode(
                popup,
                600
            );


        return {
            title:
                firstTextByNodeName(
                    rows,
                    'labTitle'
                ),

            currentStageText:
                firstTextByNodeName(
                    rows,
                    'lv1'
                ),

            nextStageText:
                firstTextByNodeName(
                    rows,
                    'lv2'
                ),

            stageCandidates:
                awakenStageCandidates(
                    rows
                ),

            comparisonTexts:
                rows.filter(
                    row =>
                        />>/
                            .test(
                                row?.text ||
                                ''
                            )
                ),

            unlockTexts:
                rows.filter(
                    row =>
                        /도달 시 해제|단계 해제|레벨.*해제|해제되지 않았습니다/
                            .test(
                                row?.text ||
                                ''
                            )
                ),

            extraEffects:
                rows.filter(
                    row =>
                        /skillEffectExtra/i
                            .test(
                                row?.path ||
                                ''
                            ) &&
                        row?.type ===
                            'cc.RichText'
                ),

            texts:
                rows
        };
    }


    async function inspectAwakenSkillData(
        options = {}
    ) {

        const popup =
            await saleWaitForNode(
                'HeroAwakenSkillUpPop',
                {
                    timeout:
                        options.popupVisibleTimeout ??
                        1800,

                    minVisibleMs:
                        options.screenVisibleStableMs ??
                        SALE_VISIBLE_STABLE_MS
                }
            );


        if (!popup) {

            return {
                ok: false,
                reason:
                    '각성 스킬 상세창이 열려 있지 않습니다. 각성 스킬을 하나 선택한 뒤 다시 조사하세요.'
            };
        }


        const isCancelled =
            () => {

                try {

                    return (
                        typeof options.shouldStop ===
                        'function'
                    )
                        ? !!options.shouldStop()
                        : false;

                } catch {

                    return false;
                }
            };


        const baseSnapshot =
            awakenPopupSnapshot(
                popup
            );


        const popupTexts =
            baseSnapshot.texts;


        if (
            isCancelled()
        ) {

            return {
                ok: false,
                cancelled: true,
                reason:
                    '사용자가 각성 스킬 조사를 중지했습니다.'
            };
        }


        const componentRows =
            [];

        const root =
            scene();

        const stack =
            root
                ? [root]
                : [];

        let visited =
            0;


        while (
            stack.length
        ) {

            if (
                isCancelled()
            ) {

                return {
                    ok: false,
                    cancelled: true,
                    reason:
                        '사용자가 각성 스킬 조사를 중지했습니다.',
                    partial: {
                        components:
                            componentRows.length
                    }
                };
            }


            const node =
                stack.pop();


            if (!node)
                continue;


            const children =
                node.children ||
                [];


            for (
                let index =
                    children.length - 1;
                index >= 0;
                index -= 1
            ) {

                stack.push(
                    children[index]
                );
            }


            if (
                !isActive(
                    node
                )
            )
                continue;


            const path =
                nodePath(
                    node
                );


            const nodeRelevant =
                (
                    /HeroAwakenSkillUpPop|Skillcontent1|HeroDetailAwaken/i
                        .test(
                            path
                        )
                );


            for (
                const component
                of (
                    node?._components ||
                    []
                )
            ) {

                const name =
                    componentName(
                        component
                    );


                if (
                    !name
                )
                    continue;


                if (
                    !nodeRelevant &&
                    !AWAKEN_SKILL_COMPONENT_HINT
                        .test(
                            name
                        )
                )
                    continue;


                /*
                 * cc.Label 등의 일반 UI 컴포넌트는 텍스트 목록에서 이미 확보되므로
                 * component dump에서는 사용자/게임 로직 컴포넌트를 우선한다.
                 */
                if (
                    /^cc\./i.test(
                        name
                    ) &&
                    !AWAKEN_SKILL_COMPONENT_HINT
                        .test(
                            name
                        )
                )
                    continue;


                const fields =
                    inspectAwakenComponent(
                        component
                    );


                if (
                    Object.keys(
                        fields
                    ).length ===
                    0
                )
                    continue;


                componentRows.push({
                    nodeName:
                        String(
                            node?.name ||
                            ''
                        ),

                    path,

                    component:
                        name,

                    fields
                });
            }


            visited += 1;


            if (
                visited % 100 ===
                0
            ) {

                await inspectionYield();
            }
        }


        const relatedButtons =
            (
                typeof listGameButtons ===
                    'function'
                    ? listGameButtons()
                    : []
            ).filter(
                row =>
                    /HeroAwakenSkillUpPop|Skillcontent1|HeroDetailAwaken/i
                        .test(
                            row?.path ||
                            ''
                        )
            );


        const currentStageText =
            baseSnapshot
                .currentStageText;

        const nextStageText =
            baseSnapshot
                .nextStageText;


        const extraEffects =
            baseSnapshot
                .extraEffects;

        const unlockTexts =
            baseSnapshot
                .unlockTexts;

        const comparisonTexts =
            baseSnapshot
                .comparisonTexts;


        const logicComponent =
            awakenSkillPopupComponent(
                popup
            );


        const skillMeta = {
            heroId:
                Number.isFinite(
                    Number(
                        logicComponent?._heroId
                    )
                )
                    ? Number(
                        logicComponent._heroId
                      )
                    : null,

            skillIndex:
                Number.isFinite(
                    Number(
                        logicComponent?._skillIndex
                    )
                )
                    ? Number(
                        logicComponent._skillIndex
                      )
                    : null,

            skillId:
                Number.isFinite(
                    Number(
                        logicComponent?._skillId
                    )
                )
                    ? Number(
                        logicComponent._skillId
                      )
                    : null,

            currentLevel:
                Number.isFinite(
                    Number(
                        logicComponent?._skillLevel
                    )
                )
                    ? Number(
                        logicComponent._skillLevel
                      )
                    : null,

            maxLevelPreview:
                !!logicComponent
                    ? !!logicComponent._maxLevelPreview
                    : null
        };


        const result = {
            ok: true,

            inspectedAt:
                new Date()
                    .toISOString(),

            title:
                baseSnapshot.title,

            skill:
                skillMeta,

            stage: {
                currentText:
                    currentStageText,

                current:
                    parseStageNumber(
                        currentStageText
                    ),

                nextText:
                    nextStageText,

                next:
                    parseStageNumber(
                        nextStageText
                    ),

                visibleCandidates:
                    baseSnapshot
                        .stageCandidates
            },

            cost: {
                need:
                    firstTextByNodeName(
                        popupTexts,
                        'upgradeOneNeedExpLab(红色色值#FF6C6C)'
                    ),

                owned:
                    firstTextByNodeName(
                        popupTexts,
                        'totalHaveExpLab'
                    )
            },

            /*
             * 현재 효과/다음 효과는 RichText가 여러 Label child로 분리될 수 있으므로
             * 원문 순서를 그대로 보존한다.
             */
            texts:
                popupTexts,

            comparisonTexts,

            unlockTexts,

            extraEffects,

            components:
                componentRows,

            relatedButtons,

            maxPreview: {
                available:
                    false,

                initiallyEnabled:
                    skillMeta
                        .maxLevelPreview,

                activated:
                    false,

                observedMaxStage:
                    null,

                restoreMode:
                    null,

                restoreAttempted:
                    false,

                popupClosedForRestore:
                    false,

                restored:
                    true,

                snapshot:
                    null,

                componentBefore:
                    logicComponent
                        ? inspectAwakenComponent(
                            logicComponent
                          )
                        : null,

                componentDuring:
                    null,

                componentAfter:
                    null
            },

            notes: [
                '게임 상태를 변경하는 승격/레벨업 동작은 실행하지 않음',
                'Sprite/Texture/Asset은 조사 대상에서 제외',
                '각성 스킬 최대 단계를 5로 가정하지 않음',
                '게임 내 최대 단계 미리보기 UI가 있으면 자동으로 읽고 원래 상태로 복원',
                '미리보기 토글 해제가 실패하면 각성 스킬 상세 팝업을 닫아 안전하게 복원',
                '승격(onSkillUpClick)은 절대 호출하지 않음',
                '스크랩 전 화면/팝업이 activeInHierarchy 상태이며 핵심 콘텐츠가 생성된 뒤 최소 안정 시간 동안 유지되는지 확인',
                'components의 config/data/info/effect/level/stage/id 계열 필드에서 단계별 원본 설정 후보를 찾기 위한 조사 결과'
            ]
        };


        /*
         * 게임이 제공하는 "최대 단계 미리보기"만 사용한다.
         * 실제 승격(onSkillUpClick)은 절대 호출하지 않는다.
         */
        if (
            options.includeMaxPreview !==
                false &&
            !isCancelled()
        ) {

            const previewRow =
                findAwakenMaxPreviewButtonRow();


            result.maxPreview.available =
                !!previewRow;


            if (
                previewRow
            ) {

                const initiallyEnabled =
                    !!(
                        logicComponent &&
                        logicComponent
                            ._maxLevelPreview
                    );


                result.maxPreview.initiallyEnabled =
                    initiallyEnabled;


                try {

                    if (
                        !initiallyEnabled
                    ) {

                        const previewResult =
                            await pressGameButton(
                                previewRow.id,
                                {
                                    waitMs:
                                        300
                                }
                            );


                        if (
                            previewResult.ok
                        ) {

                            result.maxPreview.activated =
                                true;
                        }


                        await inspectionYield();


                        await saleWaitForNode(
                            'HeroAwakenSkillUpPop',
                            {
                                timeout:
                                    options.previewVisibleTimeout ??
                                    1400,

                                /*
                                 * popup 노드는 그대로여도 내부 내용은 최대 단계
                                 * 미리보기로 바뀌므로 버튼 클릭 시점부터 다시 기다린다.
                                 */
                                minVisibleMs:
                                    options.screenVisibleStableMs ??
                                    SALE_VISIBLE_STABLE_MS
                            }
                        );
                    }


                    if (
                        !isCancelled()
                    ) {

                        const livePopup =
                            findActiveNodeByName(
                                'HeroAwakenSkillUpPop'
                            );


                        const liveComponent =
                            awakenSkillPopupComponent(
                                livePopup
                            );


                        if (
                            livePopup
                        ) {

                            result.maxPreview.snapshot =
                                awakenPopupSnapshot(
                                    livePopup
                                );


                            const stages =
                                result
                                    .maxPreview
                                    .snapshot
                                    ?.stageCandidates ||
                                [];


                            result.maxPreview.observedMaxStage =
                                stages.length
                                    ? Math.max(
                                        ...stages
                                      )
                                    : null;
                        }


                        result.maxPreview.componentDuring =
                            liveComponent
                                ? inspectAwakenComponent(
                                    liveComponent
                                  )
                                : null;
                    }

                } finally {

                    /*
                     * 조사 시작 전 미리보기 OFF였던 경우에만 복원을 시도한다.
                     *
                     * 1차: 같은 미리보기 버튼 재호출
                     * 2차: 여전히 preview=true이면 상세 팝업을 닫아서 상태 폐기
                     *
                     * 실제 승격/레벨업 데이터는 변경하지 않는다.
                     */
                    if (
                        !initiallyEnabled
                    ) {

                        result.maxPreview.restoreAttempted =
                            true;


                        let livePopup =
                            findActiveNodeByName(
                                'HeroAwakenSkillUpPop'
                            );

                        let liveComponent =
                            awakenSkillPopupComponent(
                                livePopup
                            );


                        if (
                            liveComponent &&
                            liveComponent
                                ._maxLevelPreview
                        ) {

                            const restoreRow =
                                findAwakenMaxPreviewButtonRow();


                            if (
                                restoreRow
                            ) {

                                await pressGameButton(
                                    restoreRow.id,
                                    {
                                        waitMs:
                                            350
                                    }
                                );

                                await inspectionYield();


                                livePopup =
                                    findActiveNodeByName(
                                        'HeroAwakenSkillUpPop'
                                    );

                                liveComponent =
                                    awakenSkillPopupComponent(
                                        livePopup
                                    );


                                if (
                                    !liveComponent ||
                                    !liveComponent
                                        ._maxLevelPreview
                                ) {

                                    result.maxPreview.restoreMode =
                                        'preview-toggle';
                                }
                            }
                        }


                        /*
                         * 일부 버전에서는 최대 미리보기 버튼이 토글 해제가 아니다.
                         * 이 경우 popup 자체를 닫으면 preview 상태가 안전하게 폐기된다.
                         */
                        if (
                            liveComponent &&
                            liveComponent
                                ._maxLevelPreview
                        ) {

                            const closeRow =
                                findAwakenSkillPopupCloseButtonRow();


                            if (
                                closeRow
                            ) {

                                const closeResult =
                                    await pressGameButton(
                                        closeRow.id,
                                        {
                                            waitMs:
                                                300
                                        }
                                    );


                                if (
                                    closeResult.ok
                                ) {

                                    result.maxPreview.popupClosedForRestore =
                                        true;

                                    result.maxPreview.restoreMode =
                                        'close-popup';
                                }


                                await inspectionYield();
                            }
                        }
                    }


                    const afterPopup =
                        findActiveNodeByName(
                            'HeroAwakenSkillUpPop'
                        );

                    const afterComponent =
                        awakenSkillPopupComponent(
                            afterPopup
                        );


                    result.maxPreview.componentAfter =
                        afterComponent
                            ? inspectAwakenComponent(
                                afterComponent
                              )
                            : null;


                    /*
                     * popup이 닫혔거나 preview flag가 원래 OFF로 돌아왔으면 복구 성공.
                     */
                    result.maxPreview.restored =
                        initiallyEnabled
                            ? true
                            : (
                                !afterPopup ||
                                !afterComponent ||
                                !afterComponent
                                    ._maxLevelPreview
                              );


                    if (
                        !result.maxPreview.restoreMode &&
                        result.maxPreview.restored
                    ) {

                        result.maxPreview.restoreMode =
                            afterPopup
                                ? 'already-restored'
                                : 'popup-closed';
                    }
                }
            }
        }


        window.TOPWAR_AWAKEN_SKILL_INSPECTION =
            result;


        console.log(
            '[TOPWAR_AWAKEN_SKILL_INSPECTION]',
            result
        );


        return result;
    }


    function getAwakenSkillInspection() {

        return (
            window.TOPWAR_AWAKEN_SKILL_INSPECTION ||
            null
        );
    }


    async function copyAwakenSkillInspectionJson() {

        const data =
            getAwakenSkillInspection();


        if (!data) {

            return {
                ok: false,
                reason:
                    '먼저 각성 스킬 데이터 조사를 실행하세요.'
            };
        }


        const copied =
            await copyTextToClipboard(
                JSON.stringify(
                    data,
                    null,
                    2
                )
            );


        return {
            ...copied,
            data
        };
    }


    function getHeroTextInspection() {

        return (
            window.TOPWAR_HERO_TEXT_INSPECTION ||
            null
        );
    }


    async function copyHeroTextInspectionJson() {

        const data =
            getHeroTextInspection();


        if (!data) {

            return {
                ok: false,
                reason:
                    '먼저 영웅 텍스트 조사를 실행하세요.'
            };
        }


        const copied =
            await copyTextToClipboard(
                JSON.stringify(
                    data,
                    null,
                    2
                )
            );


        return {
            ...copied,
            data
        };
    }


    function findProfileRoot() { return profileModule.findProfileRoot(); }

    function getProfileDiagnostics() {
        const currentScene = scene();
        const candidates = [];
        walk(currentScene, node => {
            if (/userinfo|profile/i.test(node.name || '')) candidates.push({
                name: node.name, path: nodePath(node), active: node.active,
                activeInHierarchy: node.activeInHierarchy
            });
        });
        const panel = findProfileRoot();
        return { scene: currentScene ? { name: currentScene.name, active: currentScene.active,
            activeInHierarchy: currentScene.activeInHierarchy } : null,
            panel: panel ? nodePath(panel) : null, candidates };
    }

    function findOwnProfileButton() {

    const root =
        scene();

    if (!root)
        return null;


    const candidates = [];


    walk(
        root,
        node => {

            if (!isActive(node))
                return;


            let button = null;

            try {

                button =
                    node.getComponent?.(
                        cc.Button
                    );

            } catch {}


            if (!button)
                return;


            if (
                button.enabled === false ||
                button.interactable === false
            )
                return;


            const handlers =
                button.clickEvents || [];


            for (
                const event
                of handlers
            ) {

                const component =
                    String(
                        event?.component ||
                        event?._componentName ||
                        event?.componentName ||
                        ''
                    );


                const handler =
                    String(
                        event?.handler ||
                        event?._handler ||
                        ''
                    );


                /*
                 * 실제 캡처된 프로필 버튼
                 */
                if (
                    component ===
                        'NMainUI'
                    &&
                    handler ===
                        'checkUserAuthor'
                ) {

                    candidates.push({

                        node,

                        button,

                        event,

                        component,

                        handler,

                        name:
                            node.name,

                        path:
                            nodePath(node)
                    });
                }
            }
        }
    );


    /*
     * AuthorBtn 우선
     */
    candidates.sort(
        (a, b) => {

            const aScore =
                a.name ===
                'AuthorBtn'
                    ? 100
                    : 0;

            const bScore =
                b.name ===
                'AuthorBtn'
                    ? 100
                    : 0;


            return (
                bScore -
                aScore
            );
        }
    );


    return (
        candidates[0] ||
        null
    );
}


    async function openOwnProfile(options = {}) {

    const current =
        detect();


    if (
        current.state === STATE.WORLD_MAP ||
        current.state === STATE.WORLD_MINIMAP
    ) {

        return {
            ok: false,
            reason:
                'WORLD_MAP / WORLD_MINIMAP에서는 프로필을 열 수 없음',
            current
        };
    }


    /*
     * 이미 열려있으면 성공
     */
    const already =
        findProfileRoot?.();

    if (already) {

        return {
            ok: true,
            alreadyOpen: true,
            path:
                nodePath(already)
        };
    }


    /*
     * 현재 활성 AuthorBtn 찾기
     */
    const target =
        findOwnProfileButton();


    if (!target) {

        return {
            ok: false,
            reason:
                'NMainUI.checkUserAuthor가 연결된 AuthorBtn을 찾지 못함',
            current
        };
    }


    const node =
        target.node;


    let button = null;

    try {

        button =
            node.getComponent?.(
                cc.Button
            );

    } catch {}


    if (!button) {

        return {
            ok: false,
            reason:
                'AuthorBtn에서 cc.Button을 찾지 못함',
            target
        };
    }


    /*
     * 프로필 열림 확인
     */
    async function waitOpen(
        timeout = 2000
    ) {

        const started =
            Date.now();


        while (
            Date.now() - started <
            timeout
        ) {

            const root =
                findProfileRoot?.();


            if (root) {

                return {
                    ok: true,
                    root,
                    path:
                        nodePath(root)
                };
            }


            await sleep(100);
        }


        return {
            ok: false
        };
    }


    const attempts = [];


    /*
     * ============================================================
     * 1순위
     * 실제 cc.EventHandler.emit()
     *
     * Cocos 버튼이 내부적으로 사용하는 방식에 가장 가까움
     * ============================================================ */

    for (
        const event
        of button.clickEvents || []
    ) {

        const componentName =
            String(
                event?.component ||
                event?._componentName ||
                ''
            );


        const handlerName =
            String(
                event?.handler ||
                event?._handler ||
                ''
            );


        if (
            componentName !==
                'NMainUI'
            ||
            handlerName !==
                'checkUserAuthor'
        ) {
            continue;
        }


        try {

            if (
                typeof event.emit ===
                'function'
            ) {

                /*
                 * 중요:
                 * 이벤트 객체가 아니라 Button 전달
                 */
                event.emit(
                    [button]
                );


                attempts.push({
                    method:
                        'event.emit([button])',
                    ok:
                        true
                });


                const opened =
                    await waitOpen(
                        options.timeout ??
                        2000
                    );


                if (!opened.ok) {
                    return { ok: false, stage: 'PROFILE_PANEL_NOT_DETECTED',
                        reason: '프로필 이벤트는 호출했지만 열린 패널을 확인하지 못함 (추가 클릭 중단)',
                        attempts, diagnostics: getProfileDiagnostics() };
                }
                if (opened.ok) {

                    return {

                        ok: true,

                        state:
                            current.state,

                        method:
                            'event.emit([button])',

                        target: {
                            name:
                                node.name,

                            path:
                                nodePath(node),

                            component:
                                componentName,

                            handler:
                                handlerName
                        },

                        profile: {
                            path:
                                opened.path
                        },

                        attempts
                    };
                }
            }

        } catch (
            error
        ) {

            console.error('[TOPWAR_NAV] profile event', error);
            attempts.push({

                method:
                    'event.emit([button])',

                ok:
                    false,

                error:
                    error?.message ||
                    String(error)
            });
        }
    }


    /*
     * ============================================================
     * 2순위
     * emitEvents(clickEvents, button)
     *
     * 이것도 이벤트 객체가 아니라 cc.Button 전달
     * ============================================================ */

    try {

        if (
            button.clickEvents?.length &&
            cc.Component
                ?.EventHandler
                ?.emitEvents
        ) {

            cc.Component
                .EventHandler
                .emitEvents(
                    button.clickEvents,
                    button
                );


            attempts.push({
                method:
                    'emitEvents(clickEvents, button)',
                ok:
                    true
            });


            const opened =
                await waitOpen(
                    options.timeout ??
                    2000
                );


            if (opened.ok) {

                return {

                    ok: true,

                    state:
                        current.state,

                    method:
                        'emitEvents(clickEvents, button)',

                    target: {
                        name:
                            node.name,

                        path:
                            nodePath(node)
                    },

                    profile: {
                        path:
                            opened.path
                    },

                    attempts
                };
            }
        }

    } catch (
        error
    ) {

        attempts.push({

            method:
                'emitEvents(clickEvents, button)',

            ok:
                false,

            error:
                error?.message ||
                String(error)
        });
    }


    /*
     * ============================================================
     * 3순위
     * node.emit("click", button)
     *
     * 네가 직접 클릭했을 때 trace에도 이 이벤트가 찍힘
     * ============================================================ */

    try {

        node.emit(
            'click',
            button
        );


        attempts.push({
            method:
                'node.emit("click", button)',
            ok:
                true
        });


        const opened =
            await waitOpen(
                options.timeout ??
                2000
            );


        if (opened.ok) {

            return {

                ok: true,

                state:
                    current.state,

                method:
                    'node.emit("click", button)',

                target: {
                    name:
                        node.name,

                    path:
                        nodePath(node)
                },

                profile: {
                    path:
                        opened.path
                },

                attempts
            };
        }

    } catch (
        error
    ) {

        attempts.push({

            method:
                'node.emit("click", button)',

            ok:
                false,

            error:
                error?.message ||
                String(error)
        });
    }


    return {

        ok: false,

        reason:
            'AuthorBtn은 찾았지만 프로필이 열리지 않음',

        state:
            current.state,

        target: {
            name:
                node.name,

            path:
                nodePath(node),

            component:
                target.component,

            handler:
                target.handler
        },

        attempts
    };
}

        function profileFrameRoot() {
        const panel = findProfileRoot();
        if (!panel) return null;

        for (
            let node = panel.parent;
            node && node !== scene();
            node = node.parent
        ) {
            if (
                /^UIFrame/.test(
                    String(
                        node.name ||
                        ''
                    )
                )
            ) {
                return node;
            }
        }

        return panel.parent || panel;
    }


    function profileCloseCandidates() {
        const panel = findProfileRoot();
        if (!panel) return [];

        const scope =
            profileFrameRoot() ||
            panel;

        const rows =
            typeof gameButtonRows ===
                'function'
                ? gameButtonRows()
                : [];

        return rows
            .filter(
                row => {

                    if (
                        !row?.enabled ||
                        !row?.supported
                    )
                        return false;


                    if (
                        !withinGameRoot(
                            row.node,
                            scope
                        )
                    )
                        return false;


                    const closeEvents =
                        (
                            row.events ||
                            []
                        ).filter(
                            event =>
                                isWindowCloseHandler(
                                    event?.handler
                                )
                        );


                    if (
                        !closeEvents.length
                    )
                        return false;


                    /*
                     * 실제 프로필 프레임 CLOSE 버튼은
                     * close + closeBtnClick 두 이벤트를 동시에 가진다.
                     * 이전 버전처럼 clickEvent가 정확히 1개인 경우만
                     * 허용하면 이 버튼을 놓친다.
                     */
                    const allEventsAreClose =
                        (
                            row.events ||
                            []
                        ).every(
                            event =>
                                isWindowCloseHandler(
                                    event?.handler
                                )
                        );


                    return (
                        row.name ===
                            'CLOSE' ||
                        allEventsAreClose
                    );
                }
            )
            .sort(
                (a, b) => {

                    const score =
                        row =>
                            (
                                row?.name ===
                                    'CLOSE'
                                    ? 1000
                                    : 0
                            ) +
                            (
                                /\/UIFrame[^/]*\/CLOSE$/
                                    .test(
                                        row?.path ||
                                        ''
                                    )
                                    ? 500
                                    : 0
                            ) +
                            (
                                row?.events?.some(
                                    event =>
                                        event?.handler ===
                                        'closeBtnClick'
                                )
                                    ? 100
                                    : 0
                            );


                    return (
                        score(b) -
                        score(a)
                    );
                }
            );
    }


    async function closeOwnProfile(options = {}) {

        if (!findProfileRoot()) {

            return {
                ok: true,
                alreadyClosed: true
            };
        }


        const timeout =
            Math.max(
                500,
                Number(
                    options.timeout ??
                    3000
                )
            );


        const candidates =
            profileCloseCandidates();


        const diagnostics =
            candidates.map(
                row =>
                    describeGameButton(
                        row
                    )
            );


        /*
         * 최우선: UIFrame.../CLOSE 버튼을 실제 Cocos 버튼 동작과
         * 동일하게 실행한다. close + closeBtnClick이 함께 있어도 정상.
         */
        if (
            candidates.length
        ) {

            const target =
                candidates[0];


            const pressed =
                await pressGameButton(
                    target.id,
                    {
                        waitMs:
                            Math.min(
                                500,
                                timeout
                            )
                    }
                );


            const deadline =
                Date.now() +
                timeout;


            while (
                !disposed &&
                findProfileRoot() &&
                Date.now() <
                    deadline
            ) {

                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            100
                        )
                );
            }


            if (
                !disposed &&
                !findProfileRoot()
            ) {

                return {
                    ok: true,
                    target:
                        describeGameButton(
                            target
                        ),
                    method:
                        'frame-close-button',
                    dispatched:
                        !!pressed?.dispatched
                };
            }
        }


        /*
         * Fallback:
         * UserInfoMainPanel / UIFrame 컴포넌트에 명시적인 닫기 메서드가
         * 존재하면 안전한 닫기 계열 메서드만 1회 호출한다.
         */
        const panel =
            findProfileRoot();

        const frame =
            profileFrameRoot();

        const methodNames = [
            'close',
            'closeBtnClick',
            'onClickClose',
            'onBtnClose',
            'onClose',
            'closePanel',
            'hide'
        ];


        const roots =
            [
                panel,
                frame
            ].filter(
                Boolean
            );


        for (
            const root
            of roots
        ) {

            for (
                const component
                of (
                    root?._components ||
                    []
                )
            ) {

                for (
                    const methodName
                    of methodNames
                ) {

                    const method =
                        component?.[
                            methodName
                        ];


                    if (
                        typeof method !==
                        'function'
                    )
                        continue;


                    try {

                        method.call(
                            component
                        );

                    } catch (
                        error
                    ) {

                        recordError(
                            `프로필 닫기 fallback ${methodName}`,
                            error
                        );

                        continue;
                    }


                    const deadline =
                        Date.now() +
                        timeout;


                    while (
                        !disposed &&
                        findProfileRoot() &&
                        Date.now() <
                            deadline
                    ) {

                        await new Promise(
                            resolve =>
                                setTimeout(
                                    resolve,
                                    100
                                )
                        );
                    }


                    if (
                        !disposed &&
                        !findProfileRoot()
                    ) {

                        return {
                            ok: true,
                            method:
                                `component.${methodName}`,
                            component:
                                componentName(
                                    component
                                ),
                            candidates:
                                diagnostics
                        };
                    }
                }
            }
        }


        return {
            ok: false,
            reason:
                disposed
                    ? '종료됨'
                    : '프로필 닫기 호출 후 UserInfoMainPanel이 아직 열려 있음',
            candidates:
                diagnostics,
            closeButtons:
                listWindowCloseButtons()
        };
    }
    function selectedProfileTab(name) {
        if (!findProfileRoot()) return null;
        return profileModule.collectToggles().find(tab => name ? tab.name === name || tab.text === name : tab.toggle.isChecked);
    }
    function readCurrentProfileItems() {
        const tab = selectedProfileTab();
        if (!tab) return {ok:false,reason:'열린 프로필에서 선택된 탭을 확인할 수 없음'};
        const items = profileModule.collectCurrentItems();
        return {ok:!!profileModule.findContentRoot(), toggle:tab.name, name:tab.text, snapshot:true, count:items.length, items};
    }
    async function selectProfileTab(name) {
        const tab = selectedProfileTab(name);
        if (!tab) return {ok:false,reason:'프로필을 먼저 열거나 탭 이름을 확인하세요'};
        tab.toggle.check();
        return {ok:!!tab.toggle.isChecked,toggle:tab.name,name:tab.text};
    }
    async function collectProfileTab(name, options = {}) {
        const tab = selectedProfileTab(name);
        if (!tab) return {ok:false,reason:'프로필을 먼저 열거나 탭 이름을 확인하세요'};
        const result = await profileModule.collectTab(tab, options);
        return { ...result, ok:!!result.loaded && !!result.stable };
    }

        function isWindowCloseHandler(handler) {
        const name=String(handler || '').replace(/callback/ig,'');
        return /^(?:(?:on|btn|button|click|clicked|handle|close|back|return|pressed|tap|_))+$/i.test(name) && /close|back|return/i.test(name);
    }
    // General controls use live component references; no coordinates or guessed menu paths.
    const gameButtonIds = new WeakMap();
    let gameButtonSequence = 0;
    const gameActionBindings = new Map();
    const gameMacros = new Map();
    const hiddenGameButtons = new Map();
    const hiddenPanelButtons = new Set();
    // 저장 데이터 포맷 키. 앱 버전과 무관하므로 호환성을 위해 유지.
    const controlsStorageKey = 'TOPWAR_NAV.controls.v1';
    let macroRuntime = null;

    try {
        const saved = JSON.parse(localStorage.getItem(controlsStorageKey) || '{}');
        for (const [key,value] of saved.hidden || []) hiddenGameButtons.set(key,value);
        for (const [key,value] of saved.actions || Object.entries(previousNav?.getGameActions?.() || {})) gameActionBindings.set(key,value);
        for (const [name,value] of saved.macros || Object.entries(previousNav?.getGameMacros?.() || {})) gameMacros.set(name,value);
        for (const label of saved.panel || []) hiddenPanelButtons.add(label);
    } catch (error) { console.warn('[TOPWAR_NAV] 버튼 설정 읽기 실패',error); }

    function saveGameControls() {
        try {
            localStorage.setItem(controlsStorageKey,JSON.stringify({
                hidden:[...hiddenGameButtons],
                actions:[...gameActionBindings],
                macros:[...gameMacros],
                panel:[...hiddenPanelButtons]
            }));
            return true;
        }
        catch (error) { console.warn('[TOPWAR_NAV] 버튼 설정 저장 실패',error); return false; }
    }
    function gameControlKey(row) { return JSON.stringify([row.path,row.events]); }
    function hideGameButton(id) {
        const row=listGameButtons().find(row=>row.id===id);
        if (!row) return {ok:false,reason:'현재 버튼을 찾지 못함'};
        hiddenGameButtons.set(gameControlKey(row),row);
        return {ok:true,persisted:saveGameControls()};
    }
    function restoreGameButton(key) { const ok=hiddenGameButtons.delete(key);return {ok,persisted:saveGameControls()}; }
    function removeGameAction(name) { const ok=gameActionBindings.delete(name);return {ok,persisted:saveGameControls()}; }
    let lastOpenedRoots = [];
    function gameNodes() {
        const nodes = new Set();
        walk(scene(), node => { if (isActive(node)) nodes.add(node); });
        return nodes;
    }
    function gameButtonRows() {
        const rows = [];
        if (!window.cc?.Button) return rows;
        walk(scene(), node => {
            if (!isActive(node)) return;
            const toggle = window.cc.Toggle && node.getComponent?.(window.cc.Toggle);
            const component = toggle || node.getComponent?.(window.cc.Button);
            const listeners = ['click','toggle','touchstart','touchend'].filter(type => node.hasEventListener?.(type));
            if (!component && !listeners.length) return;
            const button = component || node;
            const method = toggle && typeof toggle.check === 'function' ? 'toggle.check' :
                (button.clickEvents || []).length ? 'clickEvents' :
                listeners.includes('click') && typeof node.emit === 'function' ? 'node.click' : null;
            if (!gameButtonIds.has(button)) gameButtonIds.set(button, 'button-' + ++gameButtonSequence);
            const events = (toggle ? toggle.checkEvents || [] : button.clickEvents || []).filter(Boolean);
            const texts = [];
            walk(node, child => {
                if (!isActive(child)) return;
                for (const type of [window.cc.Label, window.cc.RichText].filter(Boolean)) {
                    const value = child.getComponent?.(type)?.string;
                    if (value && texts.length < 3) texts.push(String(value));
                }
            });
            rows.push({node, button, events, toggle, method, listeners, id:gameButtonIds.get(button), name:node.name,
                path:nodePath(node), text:[...new Set(texts)].join(' / '),
                enabled:button.enabled !== false && button.interactable !== false,
                supported:!!method && (method !== 'clickEvents' || events.every(e => typeof e.emit === 'function'))});
        });
        return rows;
    }
    function describeGameButton(row) {
        return {id:row.id,name:row.name,path:row.path,text:row.text,enabled:row.enabled,supported:row.supported,method:row.method,listeners:row.listeners,checked:row.toggle ? !!row.toggle.isChecked : undefined,
            events:row.events.map(e => ({component:e.component,handler:e.handler}))};
    }
    function listGameButtons() { return gameButtonRows().map(describeGameButton); }
    function withinGameRoot(node, ancestor) {
        for (let n=node;n;n=n.parent) if (n === ancestor) return true;
        return false;
    }
    function listWindowCloseButtons() {
        return gameButtonRows().filter(row => row.events.some(e => isWindowCloseHandler(e.handler)))
            .map(row => ({...describeGameButton(row),inLastOpenedWindow:lastOpenedRoots.some(n => withinGameRoot(row.node,n))}));
    }
    async function pressGameButton(id, options = {}) {
        const row = gameButtonRows().find(row => row.id === id);
        if (!row) return {ok:false,reason:'버튼이 현재 화면에 없습니다. 목록을 새로 읽으세요.'};
        if (!row.enabled || !row.supported) return {ok:false,reason:'비활성 항목이거나 실행 가능한 연결을 확인하지 못했습니다.',target:describeGameButton(row)};
        const before = gameNodes();
        // Dispatch once. Never retry after a callback may already have changed the game.
        if (row.method === 'toggle.check') row.toggle.check();
        else if (row.method === 'node.click') row.node.emit('click',row.button);
        else for (const event of row.events) event.emit([row.button]);
        await new Promise(resolve => setTimeout(resolve, Math.max(0,Math.min(options.waitMs ?? 500,5000))));
        if (disposed) return {ok:false,reason:'종료됨',dispatched:true};
        const after = gameNodes();
        const added = [...after].filter(node => !before.has(node));
        const roots = added.filter(node => !added.includes(node.parent));
        if (roots.length) lastOpenedRoots = roots;
        else lastOpenedRoots = lastOpenedRoots.filter(node => after.has(node));
        return {ok:true,dispatched:true,target:describeGameButton(row),
            opened:roots.map(nodePath),hidden:[...before].filter(node => !after.has(node)).map(nodePath),
            closeButtons:listWindowCloseButtons()};
    }
    async function closeLastWindow(options = {}) {
        const live = gameNodes();
        lastOpenedRoots = lastOpenedRoots.filter(node => live.has(node));
        if (!lastOpenedRoots.length) return {ok:false,reason:'추적 중인 창이 없습니다. 닫기 후보에서 직접 선택하세요.'};
        const candidates = listWindowCloseButtons().filter(row => row.inLastOpenedWindow && row.enabled && row.supported);
        if (candidates.length !== 1) return {ok:false,reason:'닫기 후보를 하나로 확정할 수 없습니다. 목록에서 선택하세요.',candidates};
        const expected = lastOpenedRoots.slice();
        const result = await pressGameButton(candidates[0].id,options);
        const closed = expected.every(node => !gameNodes().has(node));
        return {...result,ok:result.ok && closed,closed,reason:closed ? undefined : '닫기 이벤트 호출 후 창이 아직 활성 상태입니다.'};
    }
    function bindGameAction(name,id) {
        const row = gameButtonRows().find(row => row.id === id);
        if (!name || !row) return {ok:false,reason:'이름과 현재 버튼을 확인하세요.'};
        const descriptor=describeGameButton(row);
        gameActionBindings.set(name,descriptor);
        return {ok:true,name,target:descriptor,persisted:saveGameControls()};
    }
    async function runGameAction(name,options) {
        const binding=gameActionBindings.get(name);
        if (!binding) return {ok:false,reason:'등록되지 않은 동작'};
        const matches=gameButtonRows().filter(row => row.path === binding.path && JSON.stringify(describeGameButton(row).events) === JSON.stringify(binding.events));
        if(matches.length !== 1) return {ok:false,reason:'저장된 동작의 버튼이 없거나 중복됩니다.'};
        return pressGameButton(matches[0].id,options);
    }


    /* ============================================================
     * MACRO ENGINE + ACTION RECORDER
     *
     * Macro step types:
     * - wait       : delay
     * - action     : saved/builtin action reference
     * - event      : recorded Cocos EventHandler action
     * - method     : recorded component method call
     * - coordinate : recorded canvas-relative click fallback
     * ============================================================ */

    const MACRO_BUILTINS = new Map([
        ['프로필', options => openOwnProfile(options)],
        ['프로필 닫기', options => closeOwnProfile(options)],
        ['프로필 수집', options => profileModule.collectAll(options)],
        ['기지', options => goto(STATE.BASE, options)],
        ['월드', options => goto(STATE.WORLD, options)],
        ['월드맵', options => goto(STATE.WORLD_MAP, options)]
    ]);

    let recorderRuntime = null;
    let lastGameRecording = [];
    let recorderSequence = 0;

    const RECORDER_METHOD_PATTERN = /close|hide|back|dismiss|cancel|exit/i;

    function cloneSerializable(value,fallback=null) {
        try { return JSON.parse(JSON.stringify(value)); }
        catch { return fallback; }
    }

    function clamp(value,min,max) {
        value=Number(value);
        if (!Number.isFinite(value)) value=min;
        return Math.max(min,Math.min(max,value));
    }

    function eventComponentName(event) {
        return String(event?.component || event?._componentName || event?.componentName || '');
    }

    function eventHandlerName(event) {
        return String(event?.handler || event?._handler || '');
    }

    function eventTargetNode(event) {
        return event?.target || event?._target || null;
    }

    function describeRecordedEvent(event) {
        const target=eventTargetNode(event);
        return {
            component:eventComponentName(event),
            handler:eventHandlerName(event),
            targetPath:target ? nodePath(target) : '',
            targetName:String(target?.name || ''),
            customEventData:String(event?.customEventData ?? event?._customEventData ?? '')
        };
    }

    function compactRecordedEvent(event) {
        return {
            component:String(event?.component || ''),
            handler:String(event?.handler || '')
        };
    }

    function eventSignature(events) {
        return JSON.stringify((events || []).map(compactRecordedEvent));
    }

    function normalizeCoordinateRatio(value) {
        value=clamp(value,0,1);
        // 중앙 클릭은 작은 손떨림/오차를 제거해서 정확히 50%로 저장한다.
        if (Math.abs(value - 0.5) <= 0.03) return 0.5;
        return Math.round(value * 10000) / 10000;
    }

    function normalizeMacroSteps(steps) {
        if (!Array.isArray(steps)) return [];
        const normalized=[];
        for (const source of steps) {
            if (!source || typeof source !== 'object') continue;

            if (source.type === 'wait') {
                normalized.push({
                    type:'wait',
                    ms:Math.max(0,Math.min(600000,Math.round(Number(source.ms) || 0)))
                });
                continue;
            }

            if (source.type === 'action') {
                const name=String(source.name || '').trim();
                if (!name) continue;
                normalized.push({
                    type:'action',
                    kind:source.kind === 'builtin' ? 'builtin' : 'saved',
                    name
                });
                continue;
            }

            if (source.type === 'event') {
                const events=(source.events || []).map(event => ({
                    component:String(event?.component || ''),
                    handler:String(event?.handler || ''),
                    targetPath:String(event?.targetPath || ''),
                    targetName:String(event?.targetName || ''),
                    customEventData:String(event?.customEventData || '')
                })).filter(event => event.component || event.handler);
                if (!events.length) continue;
                normalized.push({
                    type:'event',
                    controlPath:String(source.controlPath || ''),
                    controlName:String(source.controlName || ''),
                    controlType:String(source.controlType || 'cc.Button'),
                    text:String(source.text || ''),
                    label:String(source.label || source.text || source.controlName || ''),
                    events
                });
                continue;
            }

            if (source.type === 'method') {
                const component=String(source.component || '');
                const method=String(source.method || '');
                if (!component || !method) continue;
                normalized.push({
                    type:'method',
                    nodePath:String(source.nodePath || ''),
                    nodeName:String(source.nodeName || ''),
                    component,
                    method,
                    args:Array.isArray(source.args) ? cloneSerializable(source.args,[]) : [],
                    argsDropped:!!source.argsDropped,
                    label:String(source.label || `${component}.${method}()`)
                });
                continue;
            }

            if (source.type === 'coordinate') {
                const space=source.space === 'node' ? 'node' : 'canvas';
                normalized.push({
                    type:'coordinate',
                    space,
                    nodePath:String(source.nodePath || ''),
                    xRatio:normalizeCoordinateRatio(source.xRatio),
                    yRatio:normalizeCoordinateRatio(source.yRatio),
                    label:String(source.label || ''),
                    recorded:source.recorded ? cloneSerializable(source.recorded,{}) : undefined
                });
            }
        }
        return normalized;
    }

    function cloneMacroSteps(steps) {
        return cloneSerializable(normalizeMacroSteps(steps),[]) || [];
    }

    function macroStepLabel(step) {
        if (!step) return '알 수 없는 동작';
        if (step.type === 'wait') return `대기 ${step.ms / 1000}초`;
        if (step.type === 'action') return `${step.kind === 'builtin' ? '[기본]' : '[저장]'} ${step.name}`;
        if (step.type === 'event') {
            const first=step.events?.[0];
            return `[EVENT] ${step.label || step.text || step.controlName || `${first?.component || '?'}.${first?.handler || '?'}`}`;
        }
        if (step.type === 'method') return `[METHOD] ${step.label || `${step.component}.${step.method}()`}`;
        if (step.type === 'coordinate') {
            const x=Math.round(Number(step.xRatio || 0)*100);
            const y=Math.round(Number(step.yRatio || 0)*100);
            const center=step.xRatio === 0.5 && step.yRatio === 0.5 ? '화면 중앙' : `${x}%, ${y}%`;
            return `[좌표] ${step.label || center}`;
        }
        return String(step.name || step.type || '동작');
    }

    function validateGameMacro(name,steps) {
        name=String(name || '').trim();
        if (!name) return {ok:false,reason:'매크로 이름을 입력하세요.'};
        const normalized=normalizeMacroSteps(steps);
        if (!normalized.length) return {ok:false,reason:'매크로 동작이 없습니다.'};
        if (!normalized.some(step => step.type !== 'wait')) return {ok:false,reason:'실행할 동작이 하나 이상 필요합니다.'};
        for (let index=0; index<normalized.length; index++) {
            const step=normalized[index];
            if (step.type !== 'action') continue;
            if (step.kind === 'saved' && !gameActionBindings.has(step.name)) {
                return {ok:false,reason:`저장된 동작 없음: ${step.name}`,step:index};
            }
            if (step.kind === 'builtin' && !MACRO_BUILTINS.has(step.name)) {
                return {ok:false,reason:`기본 동작 없음: ${step.name}`,step:index};
            }
        }
        return {ok:true,name,steps:normalized};
    }

    function saveGameMacro(name,steps) {
        const checked=validateGameMacro(name,steps);
        if (!checked.ok) return checked;
        // macro.version은 저장 포맷 버전이며 앱 VERSION과 무관하다.
        const macro={version:2,name:checked.name,steps:checked.steps,updatedAt:Date.now()};
        gameMacros.set(checked.name,macro);
        return {ok:true,name:checked.name,macro,persisted:saveGameControls()};
    }

    function renameGameMacro(oldName,newName,steps) {
        oldName=String(oldName || '').trim();
        newName=String(newName || '').trim();
        const checked=validateGameMacro(newName,steps);
        if (!checked.ok) return checked;
        if (oldName && oldName !== newName) gameMacros.delete(oldName);
        // macro.version은 저장 포맷 버전이며 앱 VERSION과 무관하다.
        const macro={version:2,name:newName,steps:checked.steps,updatedAt:Date.now()};
        gameMacros.set(newName,macro);
        return {ok:true,name:newName,renamedFrom:oldName || undefined,macro,persisted:saveGameControls()};
    }

    function removeGameMacro(name) {
        const ok=gameMacros.delete(String(name || '').trim());
        return {ok,persisted:saveGameControls()};
    }

    function waitGameMacro(ms,runtime) {
        ms=Math.max(0,Number(ms) || 0);
        if (!ms) return Promise.resolve(!runtime.cancelled && !disposed);
        return new Promise(resolve => {
            let finished=false;
            const finish=value => {
                if (finished) return;
                finished=true;
                if (runtime.timer) clearTimeout(runtime.timer);
                runtime.timer=null;
                runtime.waitResolve=null;
                resolve(value);
            };
            runtime.waitResolve=finish;
            runtime.timer=setTimeout(() => finish(!runtime.cancelled && !disposed),ms);
        });
    }

    function stopGameMacro() {
        const runtime=macroRuntime;
        if (!runtime) return {ok:true,alreadyStopped:true};
        runtime.cancelled=true;
        if (runtime.waitResolve) runtime.waitResolve(false);
        return {ok:true,stopped:runtime.name,step:runtime.index};
    }

    function findComponentOnNode(node,name) {
        if (!node || !name) return null;
        try {
            const direct=node.getComponent?.(name);
            if (direct) return direct;
        } catch {}
        return (node._components || []).find(component => componentName(component) === name) || null;
    }

    function findUniqueComponentForMethod(action) {
        const exactNode=action.nodePath ? findDirectPath(action.nodePath) : null;
        const exact=exactNode ? findComponentOnNode(exactNode,action.component) : null;
        if (exact && typeof exact[action.method] === 'function') return {component:exact,node:exact.node || exactNode,matchedBy:'path'};

        const matches=[];
        walk(scene(),node => {
            if (!isActive(node)) return;
            for (const component of node._components || []) {
                if (componentName(component) !== action.component) continue;
                if (typeof component[action.method] !== 'function') continue;
                matches.push({component,node,matchedBy:'unique-component'});
            }
        });
        return matches.length === 1 ? matches[0] : null;
    }

    async function replayRecordedEvent(action,options={}) {
        const targetSignature=eventSignature(action.events);
        const rows=gameButtonRows().filter(row => eventSignature(row.events.map(describeRecordedEvent)) === targetSignature);
        const exact=rows.filter(row => row.path === action.controlPath);
        const matches=exact.length ? exact : rows;
        if (matches.length !== 1) {
            return {
                ok:false,
                reason:matches.length ? '녹화된 EVENT와 일치하는 컴포넌트가 여러 개입니다.' : '녹화된 EVENT 컴포넌트를 현재 화면에서 찾지 못했습니다.',
                action,
                candidates:matches.map(describeGameButton)
            };
        }
        return pressGameButton(matches[0].id,options);
    }

    async function replayRecordedMethod(action,options={}) {
        const found=findUniqueComponentForMethod(action);
        if (!found) return {ok:false,reason:`컴포넌트 메서드를 찾지 못함: ${action.component}.${action.method}`,action};
        const beforeNodes=gameNodes();
        try {
            const value=found.component[action.method](...(Array.isArray(action.args) ? action.args : []));
            if (value && typeof value.then === 'function') await value;
        } catch (error) {
            return {ok:false,reason:error?.message || String(error),action,error};
        }
        await sleep(Math.max(0,Math.min(Number(options.waitMs ?? 350),5000)));
        const afterNodes=gameNodes();
        return {
            ok:!disposed,
            reason:disposed ? '종료됨' : undefined,
            type:'method',
            matchedBy:found.matchedBy,
            component:action.component,
            method:action.method,
            nodePath:nodePath(found.node),
            hidden:[...beforeNodes].filter(node => !afterNodes.has(node)).map(nodePath)
        };
    }

    function gameCanvas() {
        const canvases=[...document.querySelectorAll('canvas')].filter(canvas => {
            const rect=canvas.getBoundingClientRect();
            return rect.width > 20 && rect.height > 20;
        });
        canvases.sort((a,b) => {
            const ar=a.getBoundingClientRect(), br=b.getBoundingClientRect();
            return br.width*br.height - ar.width*ar.height;
        });
        return canvases[0] || null;
    }

    async function replayRecordedCoordinate(action,options={}) {
        const canvas=gameCanvas();
        if (!canvas) return {ok:false,reason:'게임 canvas를 찾지 못했습니다.',action};
        const rect=canvas.getBoundingClientRect();
        const xRatio=clamp(action.xRatio,0,1), yRatio=clamp(action.yRatio,0,1);
        const clientX=rect.left + rect.width*xRatio;
        const clientY=rect.top + rect.height*yRatio;
        const common={bubbles:true,cancelable:true,view:window,clientX,clientY,button:0};
        try {
            canvas.dispatchEvent(new MouseEvent('mousedown',{...common,buttons:1}));
            canvas.dispatchEvent(new MouseEvent('mouseup',{...common,buttons:0}));
            canvas.dispatchEvent(new MouseEvent('click',{...common,buttons:0}));
        } catch (error) {
            return {ok:false,reason:error?.message || String(error),action,error};
        }
        await sleep(Math.max(0,Math.min(Number(options.waitMs ?? 350),5000)));
        return {ok:!disposed,reason:disposed?'종료됨':undefined,type:'coordinate',space:'canvas',xRatio,yRatio,clientX,clientY};
    }

    async function runGameMacroAction(step,options={}) {
        if (step.type === 'action') {
            if (step.kind === 'saved') return runGameAction(step.name,options);
            if (step.kind === 'builtin') {
                const action=MACRO_BUILTINS.get(step.name);
                if (!action) return {ok:false,reason:`기본 동작 없음: ${step.name}`};
                return action(options);
            }
            return {ok:false,reason:`알 수 없는 매크로 동작: ${step.kind}`};
        }
        if (step.type === 'event') return replayRecordedEvent(step,options);
        if (step.type === 'method') return replayRecordedMethod(step,options);
        if (step.type === 'coordinate') return replayRecordedCoordinate(step,options);
        return {ok:false,reason:`지원하지 않는 매크로 step: ${step.type}`};
    }

    async function runGameMacro(name,options={}) {
        name=String(name || '').trim();
        if (recorderRuntime) return {ok:false,reason:'녹화 중에는 매크로를 실행할 수 없습니다.'};
        if (macroRuntime) return {ok:false,reason:'이미 다른 매크로가 실행 중입니다.',running:macroRuntime.name};
        const macro=gameMacros.get(name);
        if (!macro) return {ok:false,reason:`등록되지 않은 매크로: ${name}`};
        const steps=normalizeMacroSteps(macro.steps);
        const runtime={name,startedAt:Date.now(),index:-1,total:steps.length,phase:'START',current:null,cancelled:false,timer:null,waitResolve:null};
        macroRuntime=runtime;
        const results=[];
        try {
            for (let index=0; index<steps.length; index++) {
                if (disposed || runtime.cancelled) return {ok:false,cancelled:true,name,index,results};
                const step=steps[index];
                runtime.index=index;
                runtime.current=step;
                if (step.type === 'wait') {
                    runtime.phase='WAIT';
                    log(`[매크로] ${name} · ${macroStepLabel(step)}`);
                    const continued=await waitGameMacro(step.ms,runtime);
                    if (!continued) return {ok:false,cancelled:true,name,index,results};
                    results.push({index,type:'wait',ms:step.ms,ok:true});
                    continue;
                }
                runtime.phase='ACTION';
                log(`[매크로] ${name} · ${macroStepLabel(step)}`);
                let result;
                try { result=await runGameMacroAction(step,options); }
                catch (error) { result={ok:false,reason:error?.message || String(error),error}; }
                results.push({index,step,result});
                if (!result?.ok) {
                    return {ok:false,name,failedStep:index,failedAction:macroStepLabel(step),reason:result?.reason || '동작 실행 실패',result,results};
                }
                if (runtime.cancelled) return {ok:false,cancelled:true,name,index,results};
            }
            return {ok:true,name,elapsed:Date.now()-runtime.startedAt,results};
        } finally {
            if (runtime.timer) clearTimeout(runtime.timer);
            if (macroRuntime === runtime) macroRuntime=null;
        }
    }

    function getGameMacroStatus() {
        if (!macroRuntime) return null;
        return {
            name:macroRuntime.name,index:macroRuntime.index,total:macroRuntime.total,phase:macroRuntime.phase,
            current:macroRuntime.current ? cloneSerializable(macroRuntime.current,{}) : null,
            startedAt:macroRuntime.startedAt,cancelled:macroRuntime.cancelled
        };
    }

    /* ============================================================
     * ACTION RECORDER
     *
     * 실제 사용자 입력 1회를 transaction으로 추적한다.
     * EVENT > METHOD > COORDINATE 우선순위로 하나만 기록한다.
     * ============================================================ */

    function getRecorderPoint(event) {
        if (event?.changedTouches?.length) return event.changedTouches[0];
        if (event?.touches?.length) return event.touches[0];
        return event;
    }

    function isGameCanvasEvent(event) {
        const canvas=gameCanvas();
        if (!canvas || !event) return false;

        // Navigator/Recorder 자체 UI 조작은 게임 입력으로 녹화하지 않는다.
        // 특히 '녹화 중지' 버튼 클릭이 좌표 액션으로 들어가는 문제를 방지한다.
        try {
            if (event.target && root?.contains?.(event.target)) return false;
        } catch {}

        const point=getRecorderPoint(event);
        if (!point) return false;
        if (event.target === canvas) return true;
        const rect=canvas.getBoundingClientRect();
        return point.clientX >= rect.left && point.clientX <= rect.right && point.clientY >= rect.top && point.clientY <= rect.bottom;
    }

    function recorderCoordinateFromEvent(event) {
        const canvas=gameCanvas();
        const point=getRecorderPoint(event);
        if (!canvas || !point) return null;
        const rect=canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return {
            xRatio:normalizeCoordinateRatio((point.clientX-rect.left)/rect.width),
            yRatio:normalizeCoordinateRatio((point.clientY-rect.top)/rect.height),
            clientX:Number(point.clientX),
            clientY:Number(point.clientY),
            canvasWidth:rect.width,
            canvasHeight:rect.height
        };
    }

    function beginRecorderTransaction(event) {
        const runtime=recorderRuntime;
        if (!runtime || !isGameCanvasEvent(event)) return;
        // 방금 열린 패널을 250ms 스캔 전에 눌러도 METHOD를 놓치지 않도록 입력 직전에 한번 더 후킹한다.
        hookRecorderComponentMethods(runtime);
        const point=getRecorderPoint(event);
        if (point?.button != null && point.button !== 0) return;
        if (runtime.current) finalizeRecorderTransaction(runtime.current,{forceCoordinate:false});
        const coordinate=recorderCoordinateFromEvent(event);
        if (!coordinate) return;
        const tx={
            id:++recorderSequence,
            startedAt:Date.now(),
            ended:false,
            coordinate,
            eventCandidate:null,
            methodCandidate:null,
            finalizeTimer:null,
            maxTimer:null
        };
        runtime.current=tx;
        tx.maxTimer=setTimeout(() => {
            if (recorderRuntime?.current === tx) finalizeRecorderTransaction(tx,{forceCoordinate:tx.ended});
        },5000);
    }

    function endRecorderTransaction(event) {
        const runtime=recorderRuntime;
        const tx=runtime?.current;
        if (!runtime || !tx || !isGameCanvasEvent(event)) return;
        const coordinate=recorderCoordinateFromEvent(event);
        if (coordinate) tx.coordinate=coordinate;
        tx.ended=true;
        if (tx.finalizeTimer) clearTimeout(tx.finalizeTimer);
        tx.finalizeTimer=setTimeout(() => finalizeRecorderTransaction(tx,{forceCoordinate:true}),120);
    }

    function recordedEventFromHandlers(events,params=[]) {
        const handlers=(events || []).filter(Boolean);
        if (!handlers.length) return null;
        const rows=gameButtonRows();
        let row=null;
        let bestScore=0;
        for (const candidate of rows) {
            const score=candidate.events.reduce((total,event) => total + (handlers.includes(event) ? 1 : 0),0);
            if (score > bestScore) { bestScore=score; row=candidate; }
        }
        const controlFromParam=params.find(value => value?.node && value.node.parent !== undefined);
        const controlNode=row?.node || controlFromParam?.node || null;
        const described=handlers.map(describeRecordedEvent);
        const first=described[0];
        return {
            type:'event',
            controlPath:row?.path || (controlNode ? nodePath(controlNode) : ''),
            controlName:String(row?.name || controlNode?.name || ''),
            controlType:row?.toggle ? 'cc.Toggle' : 'cc.Button',
            text:String(row?.text || ''),
            label:String(row?.text || row?.name || (first ? `${first.component}.${first.handler}` : 'EVENT')),
            events:described
        };
    }

    function captureRecorderEvent(events,params) {
        const runtime=recorderRuntime;
        const tx=runtime?.current;
        if (!runtime || !tx) return;
        const action=recordedEventFromHandlers(events,params);
        if (!action) return;
        if (!tx.eventCandidate) tx.eventCandidate=action;
    }

    function safeMethodArgs(args) {
        const converted=[];
        let dropped=false;
        for (const value of args || []) {
            if (value == null || ['string','number','boolean'].includes(typeof value)) converted.push(value);
            else if (Array.isArray(value) && value.every(item => item == null || ['string','number','boolean'].includes(typeof item))) converted.push(value.slice());
            else { dropped=true; }
        }
        return {args:dropped ? [] : converted,argsDropped:dropped};
    }

    function captureRecorderMethod(component,method,args) {
        const runtime=recorderRuntime;
        const tx=runtime?.current;
        if (!runtime || !tx || tx.methodCandidate) return;
        if (!RECORDER_METHOD_PATTERN.test(method)) return;
        const safe=safeMethodArgs(args);
        tx.methodCandidate={
            type:'method',
            nodePath:component?.node ? nodePath(component.node) : '',
            nodeName:String(component?.node?.name || ''),
            component:componentName(component),
            method:String(method),
            args:safe.args,
            argsDropped:safe.argsDropped,
            label:`${componentName(component)}.${method}()`
        };
    }

    function appendRecorderAction(runtime,tx,action) {
        if (!runtime || !action) return;
        if (runtime.lastActionAt != null) {
            const raw=Math.max(0,tx.startedAt-runtime.lastActionAt);
            const rounded=Math.round(raw/runtime.roundMs)*runtime.roundMs;
            if (rounded >= runtime.minWaitMs) runtime.steps.push({type:'wait',ms:Math.min(600000,rounded)});
        }
        runtime.steps.push(action);
        runtime.lastActionAt=tx.startedAt;
        runtime.lastAction=action;
        log(`[REC] ${macroStepLabel(action)}`);
    }

    function finalizeRecorderTransaction(tx,{forceCoordinate=true}={}) {
        const runtime=recorderRuntime;
        if (!runtime || runtime.current !== tx) return null;
        if (tx.finalizeTimer) clearTimeout(tx.finalizeTimer);
        if (tx.maxTimer) clearTimeout(tx.maxTimer);
        tx.finalizeTimer=null;tx.maxTimer=null;

        let action=tx.eventCandidate || tx.methodCandidate || null;
        if (!action && forceCoordinate && tx.ended && tx.coordinate) {
            const {xRatio,yRatio,clientX,clientY,canvasWidth,canvasHeight}=tx.coordinate;
            action={
                type:'coordinate',space:'canvas',xRatio,yRatio,
                label:xRatio === 0.5 && yRatio === 0.5 ? '화면 중앙' : '',
                recorded:{clientX,clientY,canvasWidth,canvasHeight}
            };
        }
        runtime.current=null;
        if (action) appendRecorderAction(runtime,tx,action);
        return action;
    }

    function componentMethodNames(component) {
        const names=new Set();
        let current=component;
        for (let depth=0; current && depth<6; depth++,current=Object.getPrototypeOf(current)) {
            try { for (const name of Object.getOwnPropertyNames(current)) names.add(name); }
            catch {}
        }
        names.delete('constructor');
        return [...names].filter(name => RECORDER_METHOD_PATTERN.test(name));
    }

    function hookRecorderComponentMethods(runtime) {
        if (!runtime) return;
        walk(scene(),node => {
            if (!isActive(node)) return;
            for (const component of node._components || []) {
                let hooked=runtime.methodHooks.get(component);
                if (!hooked) { hooked=new Map(); runtime.methodHooks.set(component,hooked); }
                for (const methodName of componentMethodNames(component)) {
                    if (hooked.has(methodName)) continue;
                    let original;
                    try { original=component[methodName]; } catch { continue; }
                    if (typeof original !== 'function') continue;
                    const hadOwn=Object.prototype.hasOwnProperty.call(component,methodName);
                    const wrapper=function(...args) {
                        try { captureRecorderMethod(component,methodName,args); } catch {}
                        return original.apply(this,args);
                    };
                    try {
                        component[methodName]=wrapper;
                        if (component[methodName] === wrapper) hooked.set(methodName,{original,wrapper,hadOwn});
                    } catch {}
                }
            }
        });
    }

    function installRecorderEventHook(runtime) {
        const owner=window.cc?.Component?.EventHandler;
        const original=owner?.emitEvents;
        if (!owner || typeof original !== 'function') return false;
        const wrapper=function(events,...params) {
            try { captureRecorderEvent(events,params); } catch {}
            return original.call(this,events,...params);
        };
        try {
            owner.emitEvents=wrapper;
            if (owner.emitEvents !== wrapper) return false;
            runtime.eventHook={owner,original,wrapper};
            return true;
        } catch { return false; }
    }

    function restoreRecorderHooks(runtime) {
        if (!runtime) return;
        if (runtime.scanTimer) clearInterval(runtime.scanTimer);
        runtime.scanTimer=null;
        try { runtime.inputAbort?.abort(); } catch {}
        const hook=runtime.eventHook;
        if (hook?.owner?.emitEvents === hook.wrapper) {
            try { hook.owner.emitEvents=hook.original; } catch {}
        }
        for (const [component,methods] of runtime.methodHooks || []) {
            for (const [name,entry] of methods) {
                try {
                    if (component[name] !== entry.wrapper) continue;
                    if (entry.hadOwn) component[name]=entry.original;
                    else delete component[name];
                } catch {}
            }
        }
        runtime.methodHooks?.clear?.();
    }

    function installRecorderInput(runtime) {
        const abort=new AbortController();
        runtime.inputAbort=abort;
        const options={capture:true,signal:abort.signal};
        if (window.PointerEvent) {
            document.addEventListener('pointerdown',beginRecorderTransaction,options);
            document.addEventListener('pointerup',endRecorderTransaction,options);
            document.addEventListener('pointercancel',endRecorderTransaction,options);
        } else {
            document.addEventListener('mousedown',beginRecorderTransaction,options);
            document.addEventListener('mouseup',endRecorderTransaction,options);
            document.addEventListener('touchstart',beginRecorderTransaction,{capture:true,passive:true,signal:abort.signal});
            document.addEventListener('touchend',endRecorderTransaction,{capture:true,passive:true,signal:abort.signal});
        }
    }

    function startGameRecorder(options={}) {
        if (disposed) return {ok:false,reason:'Navigator가 종료되었습니다.'};
        if (macroRuntime) return {ok:false,reason:'매크로 실행 중에는 녹화를 시작할 수 없습니다.'};
        if (recorderRuntime) return {ok:false,reason:'이미 녹화 중입니다.'};
        const runtime={
            startedAt:Date.now(),steps:[],lastActionAt:null,lastAction:null,current:null,
            roundMs:Math.max(10,Math.min(1000,Number(options.roundMs ?? 100))),
            minWaitMs:Math.max(0,Math.min(5000,Number(options.minWaitMs ?? 150))),
            methodHooks:new Map(),eventHook:null,inputAbort:null,scanTimer:null
        };
        recorderRuntime=runtime;
        lastGameRecording=[];
        installRecorderEventHook(runtime);
        hookRecorderComponentMethods(runtime);
        runtime.scanTimer=setInterval(() => {
            if (recorderRuntime === runtime) hookRecorderComponentMethods(runtime);
        },250);
        installRecorderInput(runtime);
        log('[REC] 녹화 시작',{roundMs:runtime.roundMs,minWaitMs:runtime.minWaitMs,eventHook:!!runtime.eventHook});
        return {ok:true,startedAt:runtime.startedAt,eventHook:!!runtime.eventHook};
    }

    function stopGameRecorder(options={}) {
        const runtime=recorderRuntime;
        if (!runtime) return {ok:true,alreadyStopped:true,steps:cloneMacroSteps(lastGameRecording)};
        if (runtime.current) {
            if (options.discard) {
                if (runtime.current.finalizeTimer) clearTimeout(runtime.current.finalizeTimer);
                if (runtime.current.maxTimer) clearTimeout(runtime.current.maxTimer);
                runtime.current=null;
            } else {
                finalizeRecorderTransaction(runtime.current,{forceCoordinate:!!runtime.current.ended});
            }
        }
        restoreRecorderHooks(runtime);
        recorderRuntime=null;
        const steps=options.discard ? [] : cloneMacroSteps(runtime.steps);
        if (!options.discard) lastGameRecording=steps;
        log('[REC] 녹화 중지',{steps:steps.length,actions:steps.filter(step => step.type !== 'wait').length});
        return {ok:true,stopped:true,elapsed:Date.now()-runtime.startedAt,steps};
    }

    function clearGameRecording() {
        if (recorderRuntime) return {ok:false,reason:'녹화 중에는 기록을 초기화할 수 없습니다.'};
        lastGameRecording=[];
        return {ok:true};
    }

    function getGameRecording() {
        return cloneMacroSteps(recorderRuntime?.steps || lastGameRecording);
    }

    function getGameRecorderStatus() {
        const runtime=recorderRuntime;
        if (!runtime) return {recording:false,steps:lastGameRecording.length,actions:lastGameRecording.filter(step => step.type !== 'wait').length};
        return {
            recording:true,
            startedAt:runtime.startedAt,
            elapsed:Date.now()-runtime.startedAt,
            steps:runtime.steps.length,
            actions:runtime.steps.filter(step => step.type !== 'wait').length,
            current:runtime.current ? {
                startedAt:runtime.current.startedAt,
                event:!!runtime.current.eventCandidate,
                method:!!runtime.current.methodCandidate,
                coordinate:runtime.current.coordinate ? {xRatio:runtime.current.coordinate.xRatio,yRatio:runtime.current.coordinate.yRatio} : null
            } : null,
            lastAction:runtime.lastAction ? cloneSerializable(runtime.lastAction,{}) : null
        };
    }

    function mountGameControls(api) {
        const section=document.createElement('div');

        const makePanel=(id,title)=>{
            const panel=document.createElement('details');panel.id=id;
            panel.style.cssText='border-top:1px solid #425063;margin-top:6px;padding:4px 0';
            const header=document.createElement('summary');header.textContent=title;
            header.style.cssText='cursor:pointer;font-weight:bold;padding:8px';panel.appendChild(header);
            root.querySelector('.body').appendChild(panel);
            return panel;
        };
        const searchPanel=makePanel('topwar-nav-search','버튼 검색 · 관리');
        const detailPanel=makePanel('topwar-nav-details','상세 버튼 · 저장한 동작');
        const macroPanel=makePanel('topwar-nav-macro','연속 작업 · Recorder / 매크로');
        macroPanel.open=true;
        const savedList=document.createElement('div');detailPanel.appendChild(savedList);
        const summary=document.createElement('summary'); summary.textContent='화면 버튼 · 창 열기/닫기';
        summary.style.cssText='cursor:pointer;padding:8px';
        const body=document.createElement('div'); body.style.cssText='padding:8px;display:grid;gap:6px';section.appendChild(body);
        const filter=document.createElement('input');filter.placeholder='이름 / 경로 / 이벤트 검색';filter.style.cssText='width:100%;box-sizing:border-box;color:#111';body.appendChild(filter);
        const status=document.createElement('div');body.appendChild(status);
        const toolbar=document.createElement('div');toolbar.style.cssText='display:flex;gap:4px;flex-wrap:wrap';body.appendChild(toolbar);
        const list=document.createElement('div');list.style.cssText='max-height:260px;overflow:auto;display:grid;gap:5px';detailPanel.appendChild(list);
        let closeOnly=false, hiddenOnly=false;
        const existingButtons=[...root.querySelectorAll('button')].map(node=>({node,label:node.textContent}));
        const applyPanelVisibility=()=>existingButtons.forEach(({node,label})=>{node.hidden=hiddenPanelButtons.has(label);node.style.display=node.hidden?'none':'';});
        applyPanelVisibility();
        const button=(parent,label,action)=>{const b=document.createElement('button');b.className='tool';b.textContent=label;b.addEventListener('click',action,{signal:uiEvents.signal});parent.appendChild(b);return b;};

        /* -------------------- Recorder / Macro editor UI -------------------- */
        const macroBody=document.createElement('div');
        macroBody.style.cssText='padding:8px;display:grid;gap:7px';
        macroPanel.appendChild(macroBody);

        const recorderBox=document.createElement('div');
        recorderBox.style.cssText='border:1px solid #594b32;background:#181612;border-radius:5px;padding:7px;display:grid;gap:5px';
        macroBody.appendChild(recorderBox);
        const recorderTitle=document.createElement('strong');recorderTitle.textContent='Cocos Action Recorder';recorderBox.appendChild(recorderTitle);
        const recorderControls=document.createElement('div');recorderControls.style.cssText='display:flex;gap:4px;flex-wrap:wrap';recorderBox.appendChild(recorderControls);
        const recorderStatus=document.createElement('small');recorderStatus.style.cssText='color:#c7b58b;min-height:14px';recorderBox.appendChild(recorderStatus);
        const recorderHint=document.createElement('small');
        recorderHint.style.cssText='color:#777;line-height:1.4';
        recorderHint.textContent='실제 조작을 EVENT → METHOD → Canvas 상대좌표 순으로 자동 판정합니다. 좌표는 이벤트/함수를 찾지 못한 경우에만 기록됩니다.';
        recorderBox.appendChild(recorderHint);

        const macroName=document.createElement('input');
        macroName.placeholder='매크로 이름 (예: 암흑오딘 검색)';
        macroName.style.cssText='width:100%;box-sizing:border-box;color:#111';
        macroBody.appendChild(macroName);

        const macroActionRow=document.createElement('div');
        macroActionRow.style.cssText='display:flex;gap:4px';
        macroBody.appendChild(macroActionRow);
        const macroAction=document.createElement('select');
        macroAction.style.cssText='min-width:0;flex:1;color:#111';
        macroActionRow.appendChild(macroAction);

        const macroWaitRow=document.createElement('div');
        macroWaitRow.style.cssText='display:flex;gap:4px;align-items:center';
        macroBody.appendChild(macroWaitRow);
        const macroWait=document.createElement('input');
        macroWait.type='number';macroWait.min='0.1';macroWait.step='0.1';macroWait.value='1';
        macroWait.style.cssText='width:76px;color:#111';
        macroWaitRow.appendChild(macroWait);
        const waitUnit=document.createElement('span');waitUnit.textContent='초';macroWaitRow.appendChild(waitUnit);

        const macroDraftList=document.createElement('div');
        macroDraftList.style.cssText='border:1px solid #444;border-radius:4px;padding:5px;display:grid;gap:4px;max-height:280px;overflow:auto';
        macroBody.appendChild(macroDraftList);

        const macroControls=document.createElement('div');
        macroControls.style.cssText='display:flex;gap:4px;flex-wrap:wrap';
        macroBody.appendChild(macroControls);
        const macroStatus=document.createElement('small');
        macroStatus.style.cssText='color:#aaa;min-height:14px';
        macroBody.appendChild(macroStatus);
        const savedMacros=document.createElement('div');
        savedMacros.style.cssText='border-top:1px solid #555;padding-top:7px;display:grid;gap:4px';
        macroBody.appendChild(savedMacros);

        let macroDraft=[];
        let editingMacroName=null;

        const renderMacroActions=()=>{
            const previous=macroAction.value;
            macroAction.replaceChildren();
            const placeholder=document.createElement('option');
            placeholder.value='';placeholder.textContent='동작 선택';macroAction.appendChild(placeholder);
            for(const [name] of gameActionBindings){
                const option=document.createElement('option');
                option.value=JSON.stringify({kind:'saved',name});
                option.textContent='[저장] '+name;
                macroAction.appendChild(option);
            }
            for(const [name] of MACRO_BUILTINS){
                const option=document.createElement('option');
                option.value=JSON.stringify({kind:'builtin',name});
                option.textContent='[기본] '+name;
                macroAction.appendChild(option);
            }
            if([...macroAction.options].some(option=>option.value===previous)) macroAction.value=previous;
        };

        const renderMacroDraft=()=>{
            macroDraftList.replaceChildren();
            if(!macroDraft.length){
                const empty=document.createElement('small');
                empty.textContent='녹화하거나 동작/대기를 직접 추가하세요.';
                macroDraftList.appendChild(empty);return;
            }
            macroDraft.forEach((step,index)=>{
                const row=document.createElement('div');
                row.style.cssText='display:flex;align-items:center;gap:3px;background:#202026;padding:4px;border-radius:3px';
                if(step.type==='wait'){
                    const number=document.createElement('span');number.textContent=`${index+1}. 대기 `;row.appendChild(number);
                    const waitInput=document.createElement('input');
                    waitInput.type='number';waitInput.min='0';waitInput.step='0.1';waitInput.value=String(step.ms/1000);
                    waitInput.style.cssText='width:65px;color:#111';
                    waitInput.addEventListener('change',()=>{const seconds=Math.max(0,Number(waitInput.value)||0);step.ms=Math.round(seconds*1000);},{signal:uiEvents.signal});
                    row.appendChild(waitInput);
                    const unit=document.createElement('span');unit.textContent='초';row.appendChild(unit);
                    const spacer=document.createElement('span');spacer.style.flex='1';row.appendChild(spacer);
                } else {
                    const text=document.createElement('span');text.style.cssText='flex:1;overflow-wrap:anywhere';
                    text.textContent=`${index+1}. ${macroStepLabel(step)}`;
                    row.appendChild(text);
                }
                const up=button(row,'↑',()=>{if(index<=0)return;[macroDraft[index-1],macroDraft[index]]=[macroDraft[index],macroDraft[index-1]];renderMacroDraft();});
                up.disabled=index===0;
                const down=button(row,'↓',()=>{if(index>=macroDraft.length-1)return;[macroDraft[index+1],macroDraft[index]]=[macroDraft[index],macroDraft[index+1]];renderMacroDraft();});
                down.disabled=index===macroDraft.length-1;
                button(row,'×',()=>{macroDraft.splice(index,1);renderMacroDraft();});
                macroDraftList.appendChild(row);

                if(step.type==='event'){
                    const detail=document.createElement('small');detail.style.cssText='color:#777;padding-left:18px;overflow-wrap:anywhere';
                    detail.textContent=(step.controlPath || '(path 없음)')+' · '+step.events.map(e=>`${e.component}.${e.handler}`).join(' | ');
                    macroDraftList.appendChild(detail);
                } else if(step.type==='method'){
                    const detail=document.createElement('small');detail.style.cssText='color:#777;padding-left:18px;overflow-wrap:anywhere';
                    detail.textContent=(step.nodePath || '(path 없음)')+` · ${step.component}.${step.method}()`+(step.argsDropped?' · 인수는 재생에서 제외됨':'');
                    macroDraftList.appendChild(detail);
                } else if(step.type==='coordinate'){
                    const detail=document.createElement('small');detail.style.cssText='color:#777;padding-left:18px;overflow-wrap:anywhere';
                    detail.textContent=`Canvas 상대좌표 · X ${(step.xRatio*100).toFixed(1)}% · Y ${(step.yRatio*100).toFixed(1)}%`;
                    macroDraftList.appendChild(detail);
                }
            });
        };

        const resetMacroEditor=()=>{
            editingMacroName=null;
            macroName.value='';
            macroDraft=[];
            renderMacroDraft();
        };

        const renderSavedMacros=()=>{
            savedMacros.replaceChildren();
            const title=document.createElement('strong');title.textContent='저장한 매크로';savedMacros.appendChild(title);
            if(!gameMacros.size){
                const empty=document.createElement('small');empty.textContent='저장된 매크로가 없습니다.';savedMacros.appendChild(empty);return;
            }
            for(const [name,macro] of gameMacros){
                const row=document.createElement('div');row.style.cssText='display:flex;gap:3px;align-items:center';
                const play=button(row,'▶ '+name,()=>run('매크로 '+name,()=>api.runGameMacro(name)));
                play.style.flex='1';
                button(row,'편집',()=>{
                    editingMacroName=name;
                    macroName.value=name;
                    macroDraft=cloneMacroSteps(macro.steps);
                    macroPanel.open=true;
                    renderMacroDraft();
                });
                button(row,'삭제',()=>run('매크로 삭제 '+name,()=>api.removeGameMacro(name)));
                savedMacros.appendChild(row);
                const preview=document.createElement('small');
                preview.style.cssText='color:#777;padding-left:3px;overflow-wrap:anywhere';
                preview.textContent=normalizeMacroSteps(macro.steps).map(macroStepLabel).join(' → ');
                savedMacros.appendChild(preview);
            }
        };

        const renderMacroStatus=()=>{
            const state=api.getGameMacroStatus();
            if(!state){macroStatus.textContent=editingMacroName?`편집 중: ${editingMacroName}`:'매크로 대기 중';return;}
            macroStatus.textContent=`실행 중: ${state.name} · ${state.index+1}/${state.total} · ${macroStepLabel(state.current)}`;
        };

        const renderRecorderStatus=()=>{
            const state=api.getGameRecorderStatus();

            let text;
            if(!state.recording){
                text=state.actions ? `대기 중 · 마지막 기록 ${state.actions}개` : '대기 중';
            } else {
                const sec=(state.elapsed/1000).toFixed(1);
                const pending=state.current ? (state.current.event?'EVENT':state.current.method?'METHOD':'판정 중') : '입력 대기';
                text=`● REC ${sec}초 · ${state.actions}개 · ${pending}`;
            }

            recorderStatus.textContent=text;

            // quick bar가 생성된 뒤부터는 상단 고정 상태도 같이 표시한다.
            const quick=root.querySelector('#topwar-nav-recorder-quick small');
            if(quick) quick.textContent=text;
        };

        const renderMacroUI=()=>{
            renderMacroActions();
            renderMacroDraft();
            renderSavedMacros();
            renderMacroStatus();
            renderRecorderStatus();
        };

        const run=async(label,action)=>{
            try{
                const result=await action();
                log(label+(result?.ok?' 완료':' 실패'),result);
                render();
                return result;
            }catch(error){recordError(label,error);return {ok:false,error};}
        };

        const recorderStartButton=button(recorderControls,'● 녹화 시작',()=>{
            const result=api.startGameRecorder({roundMs:100,minWaitMs:150});
            if(result.ok){macroPanel.open=true;log('Recorder 시작',result);}
            else log('Recorder 시작 실패',result);
            renderRecorderStatus();
        });

        const recorderStopButton=button(recorderControls,'■ 녹화 중지',()=>{
            const result=api.stopGameRecorder();
            if(result.ok && result.stopped){
                editingMacroName=null;
                macroDraft=cloneMacroSteps(result.steps);
                macroPanel.open=true;
                renderMacroDraft();
                log('Recorder 중지 · 편집기에 기록 불러옴',result);
            } else log('Recorder 중지',result);
            renderMacroUI();
        });
        button(recorderControls,'기록 불러오기',()=>{
            const steps=api.getGameRecording();
            if(!steps.length){log('Recorder 기록 없음',{ok:false});return;}
            editingMacroName=null;
            macroDraft=cloneMacroSteps(steps);
            macroPanel.open=true;
            renderMacroDraft();
        });
        button(recorderControls,'기록 초기화',()=>{
            const result=api.clearGameRecording();
            if(result.ok){macroDraft=[];editingMacroName=null;renderMacroDraft();}
            log('Recorder 기록 초기화',result);
            renderRecorderStatus();
        });

        /*
         * Recorder는 자주 쓰는 기능이므로 접힌 details 안에만 두지 않는다.
         * Navigator 본문 최상단에 항상 보이는 quick bar를 추가한다.
         */
        const recorderQuickBar=document.createElement('div');
        recorderQuickBar.id='topwar-nav-recorder-quick';
        recorderQuickBar.style.cssText=[
            'display:grid',
            'gap:5px',
            'padding:7px',
            'margin-bottom:7px',
            'background:#211b13',
            'border:1px solid #705a32',
            'border-radius:6px'
        ].join(';');

        const recorderQuickTitle=document.createElement('div');
        recorderQuickTitle.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:6px';
        recorderQuickBar.appendChild(recorderQuickTitle);

        const recorderQuickLabel=document.createElement('strong');
        recorderQuickLabel.textContent='Action Recorder';
        recorderQuickTitle.appendChild(recorderQuickLabel);

        const recorderQuickStatus=document.createElement('small');
        recorderQuickStatus.style.cssText='color:#c7b58b;text-align:right';
        recorderQuickStatus.textContent='대기 중';
        recorderQuickTitle.appendChild(recorderQuickStatus);

        const recorderQuickControls=document.createElement('div');
        recorderQuickControls.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:5px';
        recorderQuickBar.appendChild(recorderQuickControls);

        const quickStart=button(recorderQuickControls,'● 녹화 시작',()=>{
            recorderStartButton.click();
        });
        quickStart.style.cssText+=';height:32px;font-weight:bold';

        const quickStop=button(recorderQuickControls,'■ 녹화 중지',()=>{
            recorderStopButton.click();
        });
        quickStop.style.cssText+=';height:32px;font-weight:bold';

        const openRecorderEditor=button(recorderQuickBar,'녹화 기록 / 매크로 편집 열기',()=>{
            macroPanel.open=true;
            try { macroPanel.scrollIntoView({block:'nearest'}); } catch {}
        });
        openRecorderEditor.style.cssText+=';width:100%';

        root.querySelector('.body').insertBefore(
            recorderQuickBar,
            searchPanel
        );

        button(macroActionRow,'동작 추가',()=>{
            if(!macroAction.value)return;
            const selected=JSON.parse(macroAction.value);
            macroDraft.push({type:'action',kind:selected.kind,name:selected.name});
            renderMacroDraft();
        });
        button(macroWaitRow,'대기 추가',()=>{
            const seconds=Number(macroWait.value);
            if(!Number.isFinite(seconds)||seconds<=0)return;
            macroDraft.push({type:'wait',ms:Math.round(seconds*1000)});
            renderMacroDraft();
        });
        button(macroControls,'저장',()=>run('매크로 저장',()=>{
            const name=macroName.value.trim();
            const result=editingMacroName ? api.renameGameMacro(editingMacroName,name,macroDraft) : api.saveGameMacro(name,macroDraft);
            if(result.ok){editingMacroName=name;macroDraft=cloneMacroSteps(result.macro.steps);}
            return result;
        }));
        button(macroControls,'새로 만들기',()=>{resetMacroEditor();renderMacroUI();});
        button(macroControls,'■ 실행 중지',()=>{const result=api.stopGameMacro();log('매크로 중지',result);renderMacroStatus();});

        const macroUiTimer=setInterval(()=>{renderMacroStatus();renderRecorderStatus();},250);
        uiEvents.signal.addEventListener('abort',()=>clearInterval(macroUiTimer),{once:true});

        const render=()=>{
            list.replaceChildren();
            const all=hiddenOnly?[...hiddenGameButtons.values()]:closeOnly?listWindowCloseButtons():listGameButtons();
            const query=filter.value.toLowerCase();
            const rows=all.filter(row=>(hiddenOnly || !hiddenGameButtons.has(gameControlKey(row))) && JSON.stringify(row).toLowerCase().includes(query));
            status.textContent=rows.length+'개 · 실행은 이벤트 호출 결과이며 창 열림 보장은 아닙니다.';
            for(const row of rows){
                const item=document.createElement('div');item.style.cssText='border-top:1px solid #555;padding:5px 0;overflow-wrap:anywhere';list.appendChild(item);
                const label=document.createElement('div');label.textContent=(row.text||row.name)+(row.inLastOpenedWindow?' · 방금 연 창':'');item.appendChild(label);
                const detail=document.createElement('small');detail.textContent=row.path+' · '+(row.method || '추가 조사 필요')+' · '+(row.listeners || []).join(', ')+' · '+row.events.map(e=>e.component+'.'+e.handler).join(', ');item.appendChild(detail);
                const actions=document.createElement('div');item.appendChild(actions);
                if(hiddenOnly){button(actions,'목록 복구',()=>run('목록 복구',()=>restoreGameButton(gameControlKey(row))));continue;}
                button(actions,'목록에서 제거',()=>run('목록 제거',()=>api.hideGameButton(row.id)));
                const execute=button(actions,closeOnly?'닫기 실행':'실행',()=>run(row.name,()=>api.pressGameButton(row.id)));
                execute.disabled=!row.enabled||!row.supported;
                if(!row.supported){const note=document.createElement('div');note.textContent='실행 연결 미확인 · 버튼 조사 출력 필요';item.appendChild(note);}
                const name=document.createElement('input');name.placeholder='저장 이름 (예: 검색 열기)';name.style.cssText='width:155px;color:#111';actions.appendChild(name);
                button(actions,'동작 저장',()=>run('동작 저장',()=>api.bindGameAction(name.value.trim(),row.id)));
            }
            savedList.replaceChildren();
            const savedTitle=document.createElement('strong');savedTitle.textContent='저장한 동작';savedList.appendChild(savedTitle);
            for(const [name] of gameActionBindings) {
                const row=document.createElement('div');savedList.appendChild(row);
                button(row,name,()=>run(name,()=>api.runGameAction(name)));
                button(row,'삭제',()=>run('동작 삭제',()=>api.removeGameAction(name)));
            }
            renderMacroActions();
            renderSavedMacros();
            renderMacroStatus();
            renderRecorderStatus();
        };
        button(toolbar,'버튼 새로 읽기',()=>{closeOnly=false;hiddenOnly=false;detailPanel.open=true;render();});
        button(toolbar,'닫기 후보',()=>{closeOnly=true;hiddenOnly=false;render();});
        button(toolbar,'방금 연 창 닫기',()=>run('창 닫기',()=>api.closeLastWindow()));
        button(toolbar,'버튼 조사 출력',()=>run('버튼 조사',()=>({ok:true,buttons:listGameButtons()})));
        button(toolbar,'제거한 목록 / 복구',()=>{hiddenOnly=true;render();});
        const management=document.createElement('details');body.appendChild(management);
        const title=document.createElement('summary');title.textContent='기존 패널 버튼 관리';management.appendChild(title);
        for(const {node,label} of existingButtons){
            const line=document.createElement('label');line.style.display='block';management.appendChild(line);
            const check=document.createElement('input');check.type='checkbox';check.checked=!hiddenPanelButtons.has(label);line.appendChild(check);
            line.appendChild(document.createTextNode(label));
            check.addEventListener('change',()=>{if(check.checked)hiddenPanelButtons.delete(label);else hiddenPanelButtons.add(label);saveGameControls();applyPanelVisibility();},{signal:uiEvents.signal});
        }
        filter.addEventListener('input',render,{signal:uiEvents.signal});
        searchPanel.appendChild(section);

        root.querySelector('.body').style.cssText+=';max-height:75vh;overflow:auto';
        status.textContent='버튼 새로 읽기를 누르세요.';
        renderMacroUI();
    }


    async function runProfileTask(task) {
        if (disposed || moving || profileBusy) return { ok: false, reason: '종료되었거나 작업 진행 중' };
        profileBusy = true;
        const previousDisabled = moveButtons.map(button => button.disabled);
        moveButtons.forEach(button => { button.disabled = true; });
        try { return await task(); }
        catch (error) { return recordError('프로필', error); }
        finally {
            profileBusy = false;
            moveButtons.forEach((button, i) => { button.disabled = previousDisabled[i]; });
        }
    }


    /* ============================================================
     * TRAIT DIAGNOSTIC
     *
     * 목적:
     * - 판매 정보 전체 수집 없이 현재 영웅의 특성 진입 구조만 조사
     * - toggle3 / detailBtn은 기존 Cocos EventHandler를 1회만 호출
     * - 강화/교환/습득/리셋 등 계정 상태 변경 동작은 호출하지 않음
     * - 클릭 전/후 active node diff를 기록하여 실제 열린 패널 이름을 추적
     * ============================================================ */

    function traitDiagnosticNodeRow(
        node
    ) {

        const labels =
            [];

        walk(
            node,
            child => {

                if (
                    !isActive(
                        child
                    )
                )
                    return;


                for (
                    const type
                    of [
                        window.cc?.Label,
                        window.cc?.RichText
                    ].filter(
                        Boolean
                    )
                ) {

                    const value =
                        child
                            .getComponent?.(
                                type
                            )
                            ?.string;


                    if (
                        value != null &&
                        String(
                            value
                        ).trim() &&
                        labels.length <
                            12
                    ) {

                        labels.push(
                            String(
                                value
                            ).trim()
                        );
                    }
                }
            }
        );


        return {
            name:
                String(
                    node?.name ||
                    ''
                ),
            path:
                nodePath(
                    node
                ),
            active:
                isActive(
                    node
                ),
            text:
                [
                    ...new Set(
                        labels
                    )
                ]
        };
    }


    function traitDiagnosticSnapshot(
        stage
    ) {

        const root =
            findHeroDetailRoot();


        const keyword =
            /(talent|trait|strengthen|detailbtn|toggle3|herodetail|hero.*talent|talent.*hero)/i;


        const candidateNodes =
            [];


        walk(
            scene(),
            node => {

                if (
                    !isActive(
                        node
                    )
                )
                    return;


                const path =
                    nodePath(
                        node
                    );

                const name =
                    String(
                        node?.name ||
                        ''
                    );


                if (
                    keyword.test(
                        name
                    ) ||
                    keyword.test(
                        path
                    )
                ) {

                    candidateNodes.push(
                        traitDiagnosticNodeRow(
                            node
                        )
                    );
                }
            }
        );


        const buttons =
            gameButtonRows()
                .filter(
                    row => {

                        const joined =
                            [
                                row.name,
                                row.path,
                                row.text,
                                ...(row.events || [])
                                    .flatMap(
                                        event => [
                                            event?.component,
                                            event?.handler
                                        ]
                                    )
                            ]
                                .filter(
                                    Boolean
                                )
                                .join(
                                    ' '
                                );


                        return (
                            /(talent|trait|strengthen|detail|toggle3|toggle4|hero)/i
                                .test(
                                    joined
                                )
                            &&
                            (
                                !root ||
                                withinGameRoot(
                                    row.node,
                                    root
                                ) ||
                                /PopLayer|UIFrame/i
                                    .test(
                                        row.path ||
                                        ''
                                    )
                            )
                        );
                    }
                )
                .map(
                    describeGameButton
                )
                .slice(
                    0,
                    160
                );


        const panelLike =
            [];


        walk(
            scene(),
            node => {

                if (
                    !isActive(
                        node
                    )
                )
                    return;


                const path =
                    nodePath(
                        node
                    );

                const name =
                    String(
                        node?.name ||
                        ''
                    );


                if (
                    /PopLayer|UIFrame/i
                        .test(
                            path
                        ) &&
                    /(panel|popup|frame|talent|trait|strengthen|hero)/i
                        .test(
                            `${name} ${path}`
                        )
                ) {

                    panelLike.push(
                        traitDiagnosticNodeRow(
                            node
                        )
                    );
                }
            }
        );


        const detailComponents =
            root
                ? compactRelevantComponentFields(
                    root,
                    /(Talent|Trait|Strengthen|HeroDetail)/i,
                    /(id|talent|trait|strength|level|lv|hero|skill|item|progress|value|index|slot|select|current|data)/i
                  )
                    .slice(
                        0,
                        120
                    )
                : [];


        return {
            stage,
            at:
                new Date()
                    .toISOString(),
            identity:
                readHeroDetailIdentity(),
            heroDetailOpen:
                !!root,
            candidateNodes:
                candidateNodes
                    .slice(
                        0,
                        220
                    ),
            buttons,
            panelLike:
                panelLike
                    .slice(
                        0,
                        160
                    ),
            detailComponents
        };
    }


    function traitDiagnosticDiff(
        beforeNodes,
        afterNodes
    ) {

        const before =
            new Set(
                (
                    beforeNodes ||
                    []
                )
            );

        const after =
            new Set(
                (
                    afterNodes ||
                    []
                )
            );


        return {
            opened:
                [
                    ...after
                ]
                    .filter(
                        node =>
                            !before.has(
                                node
                            )
                    )
                    .map(
                        nodePath
                    )
                    .slice(
                        0,
                        240
                    ),
            hidden:
                [
                    ...before
                ]
                    .filter(
                        node =>
                            !after.has(
                                node
                            )
                    )
                    .map(
                        nodePath
                    )
                    .slice(
                        0,
                        240
                    )
        };
    }


    async function inspectCurrentHeroTraitFlow(
        options = {}
    ) {

        const startedAt =
            Date.now();

        const identity =
            readHeroDetailIdentity();


        if (
            !identity?.ok
        ) {

            return {
                ok: false,
                version:
                    VERSION,
                reason:
                    '영웅 상세 화면을 먼저 열어주세요.',
                identity
            };
        }


        const result = {
            ok:
                false,
            version:
                VERSION,
            collectedAt:
                new Date()
                    .toISOString(),
            identity,
            stages:
                [],
            actions:
                [],
            elapsedMs:
                0
        };


        const pushStage =
            stage => {

                const snapshot =
                    traitDiagnosticSnapshot(
                        stage
                    );

                result.stages.push(
                    snapshot
                );

                return snapshot;
            };


        pushStage(
            'BEFORE_TRAIT_TAB'
        );


        const beforeToggleNodes =
            [
                ...gameNodes()
            ];


        const toggle =
            findHeroDetailButton({
                name:
                    'toggle3',
                handler:
                    'onToggleClick'
            });


        if (!toggle) {

            result.reason =
                '특성 toggle3 버튼을 찾지 못함';

            result.actions.push({
                action:
                    'toggle3',
                ok:
                    false,
                reason:
                    result.reason
            });


            pushStage(
                'TOGGLE3_NOT_FOUND'
            );

            result.elapsedMs =
                Date.now() -
                startedAt;


            window.TOPWAR_TRAIT_DIAGNOSTIC_DATA =
                result;


            return result;
        }


        const toggleResult =
            await pressGameButton(
                toggle.id,
                {
                    waitMs:
                        options.toggleWaitMs ??
                        650
                }
            );


        result.actions.push({
            action:
                'toggle3',
            ...toggleResult,
            nodeDiff:
                traitDiagnosticDiff(
                    beforeToggleNodes,
                    [
                        ...gameNodes()
                    ]
                )
        });


        pushStage(
            'AFTER_TRAIT_TAB'
        );


        if (
            !toggleResult?.ok
        ) {

            result.reason =
                '특성 toggle3 실행 실패';

            result.elapsedMs =
                Date.now() -
                startedAt;


            window.TOPWAR_TRAIT_DIAGNOSTIC_DATA =
                result;


            return result;
        }


        const detail =
            findHeroDetailButton({
                name:
                    'detailBtn',
                handler:
                    'detailsClick'
            });


        if (!detail) {

            result.reason =
                '특성 detailBtn(detailsClick)을 찾지 못함';

            result.actions.push({
                action:
                    'detailBtn',
                ok:
                    false,
                reason:
                    result.reason
            });


            pushStage(
                'DETAIL_BUTTON_NOT_FOUND'
            );

            result.elapsedMs =
                Date.now() -
                startedAt;


            window.TOPWAR_TRAIT_DIAGNOSTIC_DATA =
                result;


            return result;
        }


        const beforeDetailNodes =
            [
                ...gameNodes()
            ];


        const detailResult =
            await pressGameButton(
                detail.id,
                {
                    waitMs:
                        options.detailWaitMs ??
                        1000
                }
            );


        result.actions.push({
            action:
                'detailBtn',
            ...detailResult,
            nodeDiff:
                traitDiagnosticDiff(
                    beforeDetailNodes,
                    [
                        ...gameNodes()
                    ]
                )
        });


        pushStage(
            'AFTER_DETAIL_CLICK'
        );


        /*
         * 클릭 이후 실제 특성 관련 노드가 보이는지 이름에 의존하지 않고 검사.
         */
        const liveTraitNodes =
            [];


        walk(
            scene(),
            node => {

                if (
                    !isActive(
                        node
                    )
                )
                    return;


                const path =
                    nodePath(
                        node
                    );


                if (
                    /(HeroTalentNode|heroTalentItem|talentMainNode|Talentnode|haveContent|Itemname|addNum|progress)/i
                        .test(
                            `${node?.name || ''} ${path}`
                        )
                ) {

                    liveTraitNodes.push(
                        traitDiagnosticNodeRow(
                            node
                        )
                    );
                }
            }
        );


        result.liveTraitNodes =
            liveTraitNodes
                .slice(
                    0,
                    240
                );


        result.ok =
            !!detailResult?.ok;

        result.reason =
            detailResult?.ok
                ? (
                    liveTraitNodes.length
                        ? '특성 세부 클릭 후 특성 관련 노드 확인'
                        : 'detailBtn 클릭은 성공했으나 특성 관련 노드가 확인되지 않음'
                  )
                : '특성 detailBtn 실행 실패';


        result.elapsedMs =
            Date.now() -
            startedAt;


        window.TOPWAR_TRAIT_DIAGNOSTIC_DATA =
            result;


        return result;
    }


    async function copyTraitDiagnosticJson() {

        const data =
            window.TOPWAR_TRAIT_DIAGNOSTIC_DATA;


        if (!data) {

            return {
                ok: false,
                reason:
                    '먼저 특성 조사를 실행하세요.'
            };
        }


        const json =
            JSON.stringify(
                data,
                null,
                2
            );


        try {

            await navigator
                .clipboard
                .writeText(
                    json
                );


            return {
                ok: true,
                copied:
                    true,
                length:
                    json.length
            };

        } catch (error) {

            return {
                ok: false,
                copied:
                    false,
                reason:
                    error?.message ||
                    String(
                        error
                    ),
                json
            };
        }
    }


    const api = {
        integrationVersion: '0.9.3',
        hideGameButton, restoreGameButton, removeGameAction,
        getHiddenGameButtons: () => Object.fromEntries(hiddenGameButtons),
        listGameButtons,
        listWindowCloseButtons,
        pressGameButton: (id, options) => runProfileTask(() => pressGameButton(id, options)),
        closeLastWindow: options => runProfileTask(() => closeLastWindow(options)),
        bindGameAction,
        runGameAction: (name, options) => runProfileTask(() => runGameAction(name, options)),
        getGameActions: () => Object.fromEntries(gameActionBindings),
        saveGameMacro,
        renameGameMacro,
        removeGameMacro,
        runGameMacro: (name, options) => runProfileTask(() => runGameMacro(name, options)),
        stopGameMacro,
        getGameMacros: () => Object.fromEntries(gameMacros),
        getGameMacroStatus,
        startGameRecorder,
        stopGameRecorder,
        clearGameRecording,
        getGameRecording,
        getGameRecorderStatus,
        closeOwnProfile: options => runProfileTask(() => closeOwnProfile(options)),
        selectProfileTab: name => runProfileTask(() => selectProfileTab(name)),
        collectProfileTab: (name, options) => runProfileTask(() => collectProfileTab(name, options)),
        collectCurrentProfileTab: options => runProfileTask(() => collectProfileTab(null, options)),
        readCurrentProfileItems,
        inspectProfileClose: () => ({panel:getProfileDiagnostics(), candidates:profileCloseCandidates().map(c => ({path:nodePath(c.node),component:c.event.component,handler:c.event.handler})), buttons:listGameButtons(), closeButtons:listWindowCloseButtons()}),
        getProfileDiagnostics,
        inspectProfileItems: profileModule.inspectCurrentProfileItems,
        findOwnProfileButton,
        findProfileRoot,
        openOwnProfile: options => runProfileTask(() => openOwnProfile(options)),
        collectProfileData: options => runProfileTask(() => profileModule.collectAll(options)),
        collectProfileToggles: profileModule.collectToggles,
        getOwnedProfileItems: profileModule.getOwned,
        getUnownedProfileItems: profileModule.getUnowned,
        getUnknownProfileItems: profileModule.getUnknown,
        getProfileData: () => window.TOPWAR_PROFILE_DATA,

        collectCharacterSaleData:
            options =>
                runProfileTask(
                    () =>
                        collectCharacterSaleData(
                            options
                        )
                ),

        getCharacterSaleData,
        copyCharacterSaleJson,
        inspectCharacterSaleLabels,

        openHeroListScreen:
            options =>
                runProfileTask(
                    () =>
                        openHeroListScreen(
                            options
                        )
                ),

        collectHeroListData:
            options =>
                runProfileTask(
                    () =>
                        collectHeroListData(
                            options
                        )
                ),

        applyHeroRarityClassification,

        getVisibleHeroItems:
            inspectVisibleHeroItems,

        collectDetailedHeroSaleData:
            (items, options) =>
                runProfileTask(
                    () =>
                        collectDetailedHeroSaleData(
                            items,
                            options
                        )
                ),

        openHeroFromListItem:
            (hero, options) =>
                runProfileTask(
                    () =>
                        openHeroFromListItem(
                            hero,
                            options
                        )
                ),

        openNextUnvisitedHeroFromList:
            (known, visited, options) =>
                runProfileTask(
                    () =>
                        openNextUnvisitedHeroFromList(
                            known,
                            visited,
                            options
                        )
                ),

        inspectTraitCompletion,

        inspectCurrentHeroTraitFlow:
            options =>
                runProfileTask(
                    () =>
                        inspectCurrentHeroTraitFlow(
                            options
                        )
                ),

        getTraitDiagnosticData:
            () =>
                window.TOPWAR_TRAIT_DIAGNOSTIC_DATA,

        copyTraitDiagnosticJson,

        collectCurrentHeroSkills:
            () =>
                collectCurrentHeroSkills(),

        readHeroDetailIdentity:
            () =>
                readHeroDetailIdentity(),

        closeSalePanelByName:
            (name, options) =>
                runProfileTask(
                    () =>
                        closeSalePanelByName(
                            name,
                            options
                        )
                ),

        inspectHeroScreenTexts,
        getHeroTextInspection,
        copyHeroTextInspectionJson,

        inspectAwakenSkillData,
        getAwakenSkillInspection,
        copyAwakenSkillInspectionJson,

        stopActiveInspection,

        getErrors: () => runtimeErrors.slice(),
        getLogs: () => runtimeLogs.slice(),
        clearLogs: () => { runtimeLogs.length = 0; return {ok:true}; },


        version:
            VERSION,

        STATE,

        PATH,


        detect,

        diagnose,

        getSignals,

        goto,

        waitForState,


        baseToWorld,

        worldToBase,


        worldToWorldMinimap,

        worldMinimapToWorld,

        worldMinimapToWorldMap,

        worldToWorldMap,

        worldMapToWorldMinimap,

        worldMapToWorld,


        findDirectPath,

        findNodeByName,

        findComponent,

        triggerButton,

        findBackCandidates,


        ui: {

            root,

            refresh,

            move,

            log
        },


        destroy
    };


    /* ============================================================
     * CHARACTER SALE COLLECTOR UI
     * ============================================================ */

    const salePanel =
        document.createElement(
            'div'
        );

    salePanel.id =
        'topwar-character-sale';

    salePanel.style.cssText = [
        'display:grid',
        'gap:6px',
        'padding:8px',
        'margin-bottom:8px',
        'background:#172018',
        'border:1px solid #456b48',
        'border-radius:7px'
    ].join(';');


    const saleHeader =
        document.createElement(
            'div'
        );

    saleHeader.style.cssText =
        'display:flex;align-items:center;justify-content:space-between;gap:6px';

    salePanel.appendChild(
        saleHeader
    );


    const saleTitle =
        document.createElement(
            'strong'
        );

    saleTitle.textContent =
        '캐릭터 판매 정보';

    saleHeader.appendChild(
        saleTitle
    );


    const saleStatus =
        document.createElement(
            'small'
        );

    function formatSaleElapsed(
        elapsedMs
    ) {

        const totalSeconds =
            Math.max(
                0,
                Math.floor(
                    Number(
                        elapsedMs ||
                        0
                    ) /
                    1000
                )
            );


        const hours =
            Math.floor(
                totalSeconds /
                3600
            );

        const minutes =
            Math.floor(
                (
                    totalSeconds %
                    3600
                ) /
                60
            );

        const seconds =
            totalSeconds %
            60;


        const two =
            value =>
                String(
                    value
                ).padStart(
                    2,
                    '0'
                );


        return hours >
            0
            ? `${two(hours)}:${two(minutes)}:${two(seconds)}`
            : `${two(minutes)}:${two(seconds)}`;
    }


    let saleElapsedStartedAt =
        null;

    let saleElapsedTimer =
        null;

    let saleElapsedLastMs =
        Number(
            window.TOPWAR_CHARACTER_SALE_DATA
                ?.elapsedMs ??
            0
        );


    function renderSaleElapsed(
        elapsedMs =
            saleElapsedLastMs
    ) {

        saleElapsedLastMs =
            Math.max(
                0,
                Number(
                    elapsedMs ||
                    0
                )
            );


        saleStatus.textContent =
            '소요시간 ' +
            formatSaleElapsed(
                saleElapsedLastMs
            );
    }


    function stopSaleElapsedTimer() {

        if (
            saleElapsedTimer != null
        ) {

            clearInterval(
                saleElapsedTimer
            );

            saleElapsedTimer =
                null;
        }


        if (
            saleElapsedStartedAt !=
            null
        ) {

            saleElapsedLastMs =
                Date.now() -
                saleElapsedStartedAt;
        }


        saleElapsedStartedAt =
            null;


        renderSaleElapsed();
    }


    function startSaleElapsedTimer() {

        if (
            saleElapsedTimer != null
        ) {

            clearInterval(
                saleElapsedTimer
            );
        }


        saleElapsedStartedAt =
            Date.now();

        saleElapsedLastMs =
            0;


        const tick =
            () => {

                if (
                    saleElapsedStartedAt ==
                    null
                )
                    return;


                renderSaleElapsed(
                    Date.now() -
                    saleElapsedStartedAt
                );
            };


        tick();


        saleElapsedTimer =
            setInterval(
                tick,
                1000
            );
    }


    saleStatus.style.cssText =
        'color:#9bc79e;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap';

    saleHeader.appendChild(
        saleStatus
    );


    renderSaleElapsed();


    const saleButtons =
        document.createElement(
            'div'
        );

    saleButtons.style.cssText =
        'display:grid;grid-template-columns:1fr 1fr;gap:5px';

    salePanel.appendChild(
        saleButtons
    );


    function saleToolButton(
        label,
        action
    ) {
        const button =
            document.createElement(
                'button'
            );

        button.className =
            'tool';

        button.textContent =
            label;

        button.style.cssText +=
            ';height:32px';

        button.addEventListener(
            'click',
            action,
            {
                signal:
                    uiEvents.signal
            }
        );

        saleButtons.appendChild(
            button
        );

        return button;
    }


    const collectSaleButton =
        saleToolButton(
            '판매 정보 수집',
            async () => {

                collectSaleButton.disabled =
                    true;


                /*
                 * 캐릭터 판매 정보 우측은 현재 단계명이 아니라
                 * 조사 시작 이후의 누적 소요시간만 표시한다.
                 */
                startSaleElapsedTimer();


                try {
                    resetSaleProgress();

                    const result =
                        await api.collectCharacterSaleData({
                            onProgress:
                                updateSaleProgress
                        });

                    /*
                     * 성공/부분 실패 여부와 관계없이 우측에는
                     * 최종 소요시간만 남긴다.
                     */
                    if (
                        Number.isFinite(
                            result?.elapsedMs
                        )
                    ) {

                        saleElapsedLastMs =
                            result.elapsedMs;
                    }


                    log(
                        '판매 정보 수집',
                        result
                    );

                } catch (error) {

                    recordError(
                        '판매 정보 수집',
                        error
                    );

                } finally {

                    stopSaleElapsedTimer();


                    collectSaleButton.disabled =
                        false;
                }
            }
        );


    const traitInspectButton =
        saleToolButton(
            '특성 조사',
            async () => {

                traitInspectButton.disabled =
                    true;


                try {

                    const result =
                        await api.inspectCurrentHeroTraitFlow();


                    const copyResult =
                        await api.copyTraitDiagnosticJson();


                    log(
                        '특성 조사',
                        {
                            result,
                            copyResult
                        }
                    );


                    if (
                        result?.ok
                    ) {

                        alert(
                            copyResult?.ok
                                ? '특성 조사 완료\n결과 JSON을 클립보드에 복사했습니다.'
                                : '특성 조사 완료\n자동 복사는 실패했습니다. 콘솔/로그의 결과를 확인하세요.'
                        );

                    } else {

                        alert(
                            `특성 조사 실패\n${result?.reason || '원인 미확인'}\n\n결과는 진단 데이터에 저장되었습니다.`
                        );
                    }

                } catch (error) {

                    recordError(
                        '특성 조사',
                        error
                    );

                } finally {

                    traitInspectButton.disabled =
                        false;
                }
            }
        );


    saleToolButton(
        '특성 JSON 복사',
        async () => {

            const result =
                await api.copyTraitDiagnosticJson();


            log(
                '특성 진단 JSON 복사',
                result
            );


            if (
                !result?.ok
            ) {

                alert(
                    result?.reason ||
                    '특성 진단 JSON 복사 실패'
                );
            }
        }
    );


    saleToolButton(
        'JSON 복사',
        async () => {

            const result =
                await api.copyCharacterSaleJson();

            /*
             * JSON 복사 결과는 로그에만 남기고,
             * 우측 소요시간 표시는 유지한다.
             */
            renderSaleElapsed();


            log(
                '판매 JSON 복사',
                result
            );
        }
    );


    const progressBox =
        document.createElement(
            'div'
        );

    progressBox.style.cssText = [
        'margin-top:4px',
        'padding-top:7px',
        'border-top:1px solid #34513a',
        'display:grid',
        'gap:3px'
    ].join(';');

    salePanel.appendChild(
        progressBox
    );


    const progressTitle =
        document.createElement(
            'strong'
        );

    progressTitle.textContent =
        '수집 진행 상황';

    progressTitle.style.cssText =
        'font-size:11px;margin-bottom:2px';

    progressBox.appendChild(
        progressTitle
    );


    const progressList =
        document.createElement(
            'div'
        );

    progressList.style.cssText =
        'display:grid;gap:3px;font-size:10px;line-height:1.45';

    progressBox.appendChild(
        progressList
    );


    const saleProgressState =
        new Map(
            SALE_PROGRESS_ITEMS.map(
                item => [
                    item.key,
                    {
                        status:
                            'waiting',

                        detail:
                            null
                    }
                ]
            )
        );


    const saleProgressRows =
        new Map();


    function renderSaleProgress() {

        for (
            const item
            of SALE_PROGRESS_ITEMS
        ) {

            let row =
                saleProgressRows.get(
                    item.key
                );


            if (!row) {

                row =
                    document.createElement(
                        'div'
                    );

                row.style.cssText =
                    'display:grid;grid-template-columns:20px 1fr;gap:5px;align-items:center;min-height:19px';

                const mark =
                    document.createElement(
                        'span'
                    );

                mark.className =
                    'sale-progress-mark sale-progress-icon waiting';

                const label =
                    document.createElement(
                        'span'
                    );

                label.className =
                    'sale-progress-label';

                row.appendChild(
                    mark
                );

                row.appendChild(
                    label
                );

                progressList.appendChild(
                    row
                );

                saleProgressRows.set(
                    item.key,
                    row
                );
            }


            const state =
                saleProgressState.get(
                    item.key
                ) || {
                    status:
                        'waiting'
                };


            const mark =
                row.querySelector(
                    '.sale-progress-mark'
                );

            const label =
                row.querySelector(
                    '.sale-progress-label'
                );


            mark.className =
                'sale-progress-mark sale-progress-icon ' +
                (
                    [
                        'waiting',
                        'running',
                        'done',
                        'error'
                    ].includes(
                        state.status
                    )
                        ? state.status
                        : 'waiting'
                );


            if (
                state.status ===
                'done'
            ) {

                mark.textContent =
                    '✓';

            } else if (
                state.status ===
                'error'
            ) {

                mark.textContent =
                    '!';

            } else {

                mark.textContent =
                    '';
            }


            let text =
                item.label;


            if (
                (
                    state.status ===
                        'done' ||
                    state.status ===
                        'error'
                ) &&
                state.detail
                    ?.displayText
            ) {

                text +=
                    ` · ${state.detail.displayText}`;

            } else if (
                state.status ===
                'done'
                &&
                Number.isFinite(
                    state.detail
                        ?.ownedCount
                )
            ) {

                text +=
                    ` · ${state.detail.ownedCount}${state.detail?.unit || '개'}`;
            }


            /*
             * 아직 Collector가 없는 항목은 기다리는 항목이라는 점만 흐리게 표시.
             */
            row.style.opacity =
                !item.implemented &&
                state.status ===
                    'waiting'
                    ? '0.55'
                    : '1';


            label.textContent =
                text;
        }
    }


    function resetSaleProgress() {

        for (
            const item
            of SALE_PROGRESS_ITEMS
        ) {

            saleProgressState.set(
                item.key,
                {
                    status:
                        'waiting',

                    detail:
                        null
                }
            );
        }


        renderSaleProgress();
    }


    function updateSaleProgress(
        event
    ) {

        if (
            !event?.key ||
            !saleProgressState.has(
                event.key
            )
        )
            return;


        saleProgressState.set(
            event.key,
            {
                status:
                    event.status ||
                    'waiting',

                detail:
                    event.detail ||
                    null
            }
        );


        renderSaleProgress();


        /*
         * 상세 진행 상황은 아래 체크리스트에서만 표시한다.
         * 헤더 우측 saleStatus는 소요시간 전용이므로
         * 현재 단계명으로 덮어쓰지 않는다.
         */
        renderSaleElapsed(
            saleElapsedStartedAt != null
                ? Date.now() -
                  saleElapsedStartedAt
                : saleElapsedLastMs
        );
    }


    resetSaleProgress();


    root.querySelector('.body')
        .insertBefore(
            salePanel,
            root.querySelector('.body')
                .firstChild
        );


    for (const [label, action] of [
        ['프로필', () => api.openOwnProfile()],
        ['프로필 수집', () => api.collectProfileData()],
        ['프로필 닫기', () => api.closeOwnProfile()]
    ]) {
        const button = document.createElement('button');
        button.className = 'tool';
        button.textContent = label;

        /*
         * 기능/이벤트는 유지하지만 판매 Collector 화면에서는 숨긴다.
         * 필요하면 나중에 다시 UI에 노출할 수 있다.
         */
        button.hidden = true;
        button.style.display = 'none';

        button.addEventListener('click', async () => {
            const result = await action();
            log(label + (result.ok ? ' 완료' : ' 실패'), result);
        });

        root.querySelector('.signal').parentElement.appendChild(button);
    }

    const controls = document.createElement('details');
    controls.innerHTML = '<summary style="cursor:pointer;padding:8px">개별 작업</summary>';
    const controlGrid = document.createElement('div');
    controlGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:8px;max-height:45vh;overflow:auto';
    controls.appendChild(controlGrid);
    // '개별 작업' 기능 코드는 유지하지만 UI에는 노출하지 않는다.
    controls.hidden = true;
    root.querySelector('.body').appendChild(controls);
    const actions = [
        ['기지 → 월드', () => runProfileTask(() => api.baseToWorld())],
        ['월드 → 기지', () => runProfileTask(() => api.worldToBase())],
        ['월드 → 미니맵', () => runProfileTask(() => api.worldToWorldMinimap())],
        ['미니맵 → 월드', () => runProfileTask(() => api.worldMinimapToWorld())],
        ['미니맵 → 월드맵', () => runProfileTask(() => api.worldMinimapToWorldMap())],
        ['월드맵 → 미니맵', () => runProfileTask(() => api.worldMapToWorldMinimap())],
        ...Object.entries({"toggle1":"기지 외관","toggle3":"대열 외관","toggle4":"기지 효과","toggle5":"이동 효과","toggle6":"행군 참여","toggle7":"수호 효과","toggle8":"영광의 장식","toggle10":"기지 오라"}).map(([name,label]) => [label + ' 선택', () => api.selectProfileTab(name)]),
        ['현재 목록 읽기', () => api.readCurrentProfileItems()],
        ['현재 탭 수집', () => api.collectCurrentProfileTab()],
        ['아이템 조사', () => ({ok:true,data:api.inspectProfileItems()})],
        ['닫기 조사', () => ({ok:true,data:api.inspectProfileClose()})],
        ['보유 결과', () => ({ok:true,items:api.getOwnedProfileItems()})],
        ['미보유 결과', () => ({ok:true,items:api.getUnownedProfileItems()})],
        ['불확실 결과', () => ({ok:true,items:api.getUnknownProfileItems()})]
    ];
    for (const [label, action] of actions) {
        const button = document.createElement('button');
        button.className = 'tool'; button.textContent = label;
        button.addEventListener('click', async () => {
            try { const result = await action(); log(label + (result.ok ? ' 완료' : ' 실패'), result); }
            catch (error) { recordError(label,error); }
        }, {signal:uiEvents.signal});
        controlGrid.appendChild(button);
    }
    // Legacy 버튼검색/상세버튼/Recorder/매크로 UI는 판매 Collector 화면에서는 숨김.
    // 기능/API 코드는 그대로 유지한다.
    // mountGameControls(api);
    // Commit replacement after the original UI and integrated API are ready.
    try { previousNav?.destroy?.(); } catch (error) { recordError('이전 UI 정리', error); }
    document.querySelectorAll('#' + UI_ID).forEach(node => { if (node !== root) node.remove(); });
    document.querySelectorAll('#' + STYLE_ID).forEach(node => { if (node !== style) node.remove(); });
    window.TOPWAR_NAV = api;
    installation.committed = true;


    /* ============================================================
     * 시작
     * ============================================================ */

    const initial =
        refresh();


    log(
        'Navigator 설치 완료',
        {

            version:
                VERSION,

            state:
                initial.state,

            reason:
                initial.reason,

            watchInterval:
                WATCH_INTERVAL
        }
    );


    startWatcher();


    console.log(

        `%c[TOPWAR_NAV ${VERSION}] installed`,

        'color:#00e676;font-weight:bold'
    );

    } catch (error) {
        if (!installation.committed) {
            installation.root?.remove();
            installation.style?.remove();
            installation.events?.abort();
        }
        console.error('[TOPWAR_NAV] 초기화 실패 (기존 인스턴스 보존)', error);
    }
})();
