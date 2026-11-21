/* BCC 커피숍 3D 도면 실습 — 가상 샘플 건물 3종(A·B·C)을 도면 → 3D로 보여 주는 뷰어.
   모든 건물은 이 파일에서 새로 설계한 가상 건물이며, 교육용 시각화입니다(시공용 도면 아님).
   three.js r128(MIT) 전역 THREE 사용. */
(function (global) {
  'use strict';
  var T = global.THREE;
  var D2R = Math.PI / 180;

  /* ---------- 재료 ---------- */
  function mat(c, o) {
    return new T.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.92, metalness: 0 }, o || {}));
  }
  var GLASS = { roughness: 0.18, metalness: 0.1 };

  /* ---------- 도형 도우미 ---------- */
  function addEdges(mesh, op) {
    var e = new T.LineSegments(
      new T.EdgesGeometry(mesh.geometry, 28),
      new T.LineBasicMaterial({ color: 0x2b2a26, transparent: true, opacity: op || 0.28 })
    );
    mesh.add(e);
  }
  function shade(m) { m.castShadow = true; m.receiveShadow = true; return m; }
  function box(g, x0, y0, z0, x1, y1, z1, m, edge) {
    var me = shade(new T.Mesh(new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m));
    me.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    if (edge) addEdges(me, 0.22);
    g.add(me);
    return me;
  }
  function cyl(g, x, z, y0, y1, r, m, seg) {
    var me = shade(new T.Mesh(new T.CylinderGeometry(r, r, y1 - y0, seg || 20), m));
    me.position.set(x, (y0 + y1) / 2, z);
    g.add(me);
    return me;
  }
  // 평면(x,z) 다각형을 위로 압출. inner 가 있으면 속이 빈 벽.
  function polyExtrude(g, outer, inner, y0, h, m, edge) {
    var s = new T.Shape();
    outer.forEach(function (p, i) { i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1]); });
    s.closePath();
    if (inner) {
      var hole = new T.Path();
      inner.forEach(function (p, i) { i ? hole.lineTo(p[0], p[1]) : hole.moveTo(p[0], p[1]); });
      hole.closePath();
      s.holes.push(hole);
    }
    var geo = new T.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, y0 + h, 0);
    var me = shade(new T.Mesh(geo, m));
    if (edge) addEdges(me, 0.3);
    g.add(me);
    return me;
  }
  // 박공지붕 덩어리(양쪽 끝 면은 capMat, 경사면은 roofMat)
  function gable(g, axis, c, hw, from, to, baseY, rise, over, capMat, roofMat) {
    var slope = rise / hw;
    var sh = new T.Shape();
    sh.moveTo(-hw - over, baseY - over * slope);
    sh.lineTo(hw + over, baseY - over * slope);
    sh.lineTo(0, baseY + rise);
    sh.closePath();
    var geo = new T.ExtrudeGeometry(sh, { depth: to - from, bevelEnabled: false });
    var me = shade(new T.Mesh(geo, [capMat, roofMat]));
    if (axis === 'x') { me.rotation.y = Math.PI / 2; me.position.set(from, 0, c); }
    else { me.position.set(c, 0, from); }
    addEdges(me, 0.3);
    g.add(me);
    return me;
  }
  // 팔각 뿔대(r1=0 이면 뿔)
  function frustum(g, r0, y0, r1, y1, rot, m) {
    var pos = [];
    function p(r, y, k) { var th = rot + k * Math.PI / 4; return [r * Math.cos(th), y, r * Math.sin(th)]; }
    for (var k = 0; k < 8; k++) {
      var a = p(r0, y0, k), b = p(r0, y0, k + 1), c = p(r1, y1, k + 1), d = p(r1, y1, k);
      pos.push.apply(pos, a.concat(b, c, a, c, d));
    }
    var geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    var me = shade(new T.Mesh(geo, m));
    addEdges(me, 0.3);
    g.add(me);
    return me;
  }
  // 창: 벽 두께보다 살짝 두껍게 끼워 넣는 유리 + 틀. ax 'x' = 벽이 z 방향으로 뻗음
  function windowBox(g, w, M) {
    var f = 0.07, e = 0.03, t = w.ax === 'x';
    function B(a0, a1, y0, y1, m) {
      if (t) box(g, w.p0 - e - 0.01, y0, a0, w.p1 + e + 0.01, y1, a1, m);
      else box(g, a0, y0, w.p0 - e - 0.01, a1, y1, w.p1 + e + 0.01, m);
    }
    var gm = w.door ? M.doorGlass : M.glass;
    if (t) box(g, w.p0 - e, w.y0 + f, w.a0 + f, w.p1 + e, w.y1 - f, w.a1 - f, gm);
    else box(g, w.a0 + f, w.y0 + f, w.p0 - e, w.a1 - f, w.y1 - f, w.p1 + e, gm);
    var fm = w.door ? M.doorFrame : M.frame;
    B(w.a0, w.a0 + f, w.y0, w.y1, fm);
    B(w.a1 - f, w.a1, w.y0, w.y1, fm);
    B(w.a0, w.a1, w.y1 - f, w.y1, fm);
    B(w.a0, w.a1, w.y0, w.y0 + f, fm);
    if (w.a1 - w.a0 > 1.8 && !w.door) { var mid = (w.a0 + w.a1) / 2; B(mid - 0.03, mid + 0.03, w.y0, w.y1, fm); }
  }
  function table(g, x, z, y, M) {
    cyl(g, x, z, y, y + 0.7, 0.05, M.dark, 8);
    cyl(g, x, z, y + 0.7, y + 0.76, 0.42, M.table, 20);
  }
  function tree(g, x, z, s) {
    var m1 = mat(0x7a5a3d), m2 = mat(0x6f9461);
    cyl(g, x, z, 0, 1.3 * s, 0.11 * s, m1, 8);
    var c = shade(new T.Mesh(new T.IcosahedronGeometry(0.95 * s, 1), m2));
    c.position.set(x, 1.9 * s, z);
    c.material.flatShading = true;
    g.add(c);
  }
  function ground(g, size) {
    var p = new T.Mesh(new T.PlaneGeometry(size, size), new T.ShadowMaterial({ opacity: 0.2 }));
    p.rotation.x = -Math.PI / 2; p.position.y = -0.01; p.receiveShadow = true; g.add(p);
  }

  /* ---------- 건물 A: ㄱ자 마당 카페 ---------- */
  function buildA() {
    var t = 0.2, H = 3.6;
    var M = {
      wall: mat(0xa5604a), plaster: mat(0xe7ddcb), roof: mat(0x4a3c35), floor: mat(0xd9d0bb),
      glass: mat(0x7fa6a8, GLASS), doorGlass: mat(0x7fa6a8, GLASS), frame: mat(0x2f2a27), doorFrame: mat(0x6b4a33),
      wood: mat(0xa9794d), dark: mat(0x5b4a40), table: mat(0xefe7d6)
    };
    var site = new T.Group(), base = new T.Group(), roof = new T.Group();
    ground(site, 70);
    var outer = [[0, 0], [12, 0], [12, 4.5], [4.5, 4.5], [4.5, 9], [0, 9]];
    var inner = [[t, t], [12 - t, t], [12 - t, 4.5 - t], [4.5 - t, 4.5 - t], [4.5 - t, 9 - t], [t, 9 - t]];
    polyExtrude(base, outer, null, 0, 0.25, M.floor, true);
    polyExtrude(base, outer, inner, 0.25, H - 0.25, M.wall, true);
    var wins = [
      { ax: 'z', p0: 0, p1: t, a0: 1.5, a1: 3.0, y0: 1.0, y1: 2.6 },
      { ax: 'z', p0: 0, p1: t, a0: 5.0, a1: 6.6, y0: 1.0, y1: 2.6 },
      { ax: 'z', p0: 0, p1: t, a0: 8.2, a1: 9.8, y0: 1.0, y1: 2.6 },
      { ax: 'x', p0: 12 - t, p1: 12, a0: 1.0, a1: 3.5, y0: 0.5, y1: 2.9 },
      { ax: 'z', p0: 4.5 - t, p1: 4.5, a0: 5.0, a1: 7.0, y0: 0.45, y1: 3.0 },
      { ax: 'z', p0: 4.5 - t, p1: 4.5, a0: 7.5, a1: 9.5, y0: 0.45, y1: 3.0 },
      { ax: 'z', p0: 4.5 - t, p1: 4.5, a0: 10.0, a1: 11.6, y0: 0.45, y1: 3.0 },
      { ax: 'x', p0: 4.5 - t, p1: 4.5, a0: 5.0, a1: 6.6, y0: 0.45, y1: 3.0 },
      { ax: 'x', p0: 4.5 - t, p1: 4.5, a0: 7.2, a1: 8.7, y0: 0.45, y1: 3.0 },
      { ax: 'x', p0: 0, p1: t, a0: 1.2, a1: 2.6, y0: 1.0, y1: 2.6 },
      { ax: 'x', p0: 0, p1: t, a0: 4.8, a1: 6.2, y0: 1.0, y1: 2.6 },
      { ax: 'x', p0: 0, p1: t, a0: 7.0, a1: 8.2, y0: 1.0, y1: 2.6 },
      { ax: 'z', p0: 9 - t, p1: 9, a0: 1.6, a1: 2.9, y0: 0.25, y1: 2.6, door: true }
    ];
    wins.forEach(function (w) { windowBox(base, w, M); });
    // 안쪽: 주방 칸막이, 카운터, 테이블
    box(base, 9.0, 0.25, 2.7, 11.8, 3.1, 2.85, M.plaster);
    box(base, 9.0, 0.25, 0.2, 9.15, 3.1, 2.85, M.plaster);
    box(base, 5.3, 0.25, 0.9, 8.3, 1.25, 1.7, M.wood, true);
    [[6.0, 3.1], [8.0, 3.1], [10.2, 3.6], [1.5, 5.6], [3.1, 5.6], [1.5, 7.4], [3.1, 7.4]].forEach(function (p) { table(base, p[0], p[1], 0.25, M); });
    // 마당: 데크, 파라솔, 나무
    box(site, 5.0, 0, 5.0, 9.6, 0.18, 8.4, M.wood, true);
    table(site, 6.4, 6.6, 0.18, M); table(site, 8.2, 6.6, 0.18, M);
    tree(site, 10.9, 7.4, 1.0); tree(site, 10.4, 5.6, 0.7); tree(site, -1.6, 3.0, 0.9);
    // 지붕: 박공 두 개가 직각으로 만남(안쪽 마당 쪽 처마가 길게 나옴)
    gable(roof, 'x', 2.25, 2.25, -0.45, 12.45, H, 1.8, 0.45, M.plaster, M.roof);
    gable(roof, 'z', 2.25, 2.25, 2.25, 9.45, H, 1.8, 0.45, M.plaster, M.roof);
    var plan = {
      bounds: [-2.6, -2.6, 14.8, 11.4],
      items: [
        { k: 'poly', pts: outer, closed: true, cls: 'w1', d: 1.5 },
        { k: 'poly', pts: inner, closed: true, cls: 'w2', d: 1.2 },
        { k: 'poly', pts: [[9.0, 2.85], [11.8, 2.85]], cls: 'w2', d: 0.4 },
        { k: 'poly', pts: [[9.15, 0.2], [9.15, 2.85]], cls: 'w2', d: 0.4 },
        { k: 'poly', pts: [[5.3, 0.9], [8.3, 0.9], [8.3, 1.7], [5.3, 1.7]], closed: true, cls: 'fn', d: 0.5 },
        { k: 'wins', list: wins, d: 1.0 },
        { k: 'tables', pts: [[6.0, 3.1], [8.0, 3.1], [10.2, 3.6], [1.5, 5.6], [3.1, 5.6], [1.5, 7.4], [3.1, 7.4]], d: 0.7 },
        { k: 'poly', pts: [[5.0, 5.0], [9.6, 5.0], [9.6, 8.4], [5.0, 8.4]], closed: true, cls: 'dash', d: 0.6 },
        { k: 'dim', a: [0, -1.4], b: [12, -1.4], label: '12.0 m', d: 0.7 },
        { k: 'dim', a: [-1.4, 0], b: [-1.4, 9], label: '9.0 m', d: 0.7, v: true },
        { k: 'dim', a: [13.2, 0], b: [13.2, 4.5], label: '4.5 m', d: 0.6, v: true },
        { k: 'text', x: 1.5, z: 4.2, s: '카페 홀', d: 0.3 }, { k: 'text', x: 10.4, z: 1.5, s: '주방', d: 0.2 },
        { k: 'text', x: 7.3, z: 9.9, s: '마당 · 데크', d: 0.3 }
      ]
    };
    return {
      key: 'a', group: [site, base, roof], parts: { site: site, base: base, roof: roof },
      center: [5.5, 2.2, 4.2], radius: 9.2, az: 42, explode: { roof: 5.2 },
      title: 'ㄱ자 마당 카페', sub: '단층 · 박공지붕 두 개가 만나는 건물',
      facts: [['평면', 'ㄱ자 · 12.0 × 9.0 m (날개 폭 4.5 m)'], ['층수', '단층 · 처마 3.6 m, 용마루 5.4 m'], ['지붕', '박공지붕 두 개가 직각으로 만남'], ['마감', '벽돌색 벽 · 짙은 갈색 지붕 · 마당 쪽 큰 유리창'], ['특징', '안쪽 마당에 데크 테라스']],
      plan: plan, open: '지붕 열기'
    };
  }

  /* ---------- 건물 B: 팔각 온실 카페 ---------- */
  function buildB() {
    var a = 4.5, R = a / Math.cos(Math.PI / 8), H = 3.2, rot = Math.PI / 8;
    var M = {
      white: mat(0xf1eee4), glass: mat(0x9dc4b4, Object.assign({ transparent: true, opacity: 0.78 }, GLASS)), doorGlass: mat(0x9dc4b4, GLASS),
      frame: mat(0xf1eee4), doorFrame: mat(0x6b4a33), roof: mat(0x5f7a6a, { side: T.DoubleSide, flatShading: true }),
      floor: mat(0xdcd3be), wood: mat(0xa9794d), dark: mat(0x5b4a40), table: mat(0xefe7d6), counter: mat(0xb08a62)
    };
    var site = new T.Group(), base = new T.Group(), roof = new T.Group();
    ground(site, 70);
    var V = [];
    for (var k = 0; k < 8; k++) V.push([R * Math.cos(rot + k * Math.PI / 4), R * Math.sin(rot + k * Math.PI / 4)]);
    polyExtrude(base, V, null, 0, 0.25, M.floor, true);
    var Ls = 2 * R * Math.sin(Math.PI / 8);
    for (k = 0; k < 8; k++) {
      var phi = 45 * (k + 1) * D2R, g = new T.Group();
      g.position.set(a * Math.cos(phi), 0, a * Math.sin(phi));
      g.rotation.y = Math.PI / 2 - phi;
      var glassSide = (k === 7 || k === 0 || k === 1 || k === 2 || k === 3);
      var hl = Ls / 2;
      if (glassSide) {
        if (k === 1) { box(g, -hl, 0.25, -0.075, -0.7, 0.65, 0.075, M.white); box(g, 0.7, 0.25, -0.075, hl, 0.65, 0.075, M.white); }
        else box(g, -hl, 0.25, -0.075, hl, 0.65, 0.075, M.white);
        box(g, -hl, 3.0, -0.09, hl, H, 0.09, M.white);
        box(g, -hl, 0.65, -0.02, hl, 3.0, 0.02, M.glass);
        if (k === 1) {
          box(g, -0.72, 0.25, -0.05, -0.64, 2.5, 0.05, M.doorFrame); box(g, 0.64, 0.25, -0.05, 0.72, 2.5, 0.05, M.doorFrame);
          box(g, -0.72, 2.5, -0.05, 0.72, 2.62, 0.05, M.doorFrame);
        }
        [-hl / 3, hl / 3].forEach(function (x) { box(g, x - 0.03, 0.65, -0.04, x + 0.03, 3.0, 0.04, M.white); });
      } else {
        box(g, -hl, 0.25, -0.1, hl, H, 0.1, M.white, true);
        if (k === 5) box(g, -1.3, 1.8, -0.12, 1.3, 2.5, 0.12, M.glass);
        else box(g, -0.5, 1.3, -0.12, 0.5, 2.4, 0.12, M.glass);
      }
      base.add(g);
    }
    V.forEach(function (p) { box(base, p[0] - 0.11, 0.25, p[1] - 0.11, p[0] + 0.11, H, p[1] + 0.11, M.white); });
    // 중앙 원형 카운터와 테이블
    cyl(base, 0, 0, 0.25, 1.25, 1.5, M.counter, 32);
    cyl(base, 0, 0, 1.25, 1.3, 1.62, M.white, 32);
    var tbl = [];
    [-60, -10, 35, 145, 190, 235].forEach(function (d) { tbl.push([3.1 * Math.cos(d * D2R), 3.1 * Math.sin(d * D2R)]); });
    tbl.forEach(function (p) { table(base, p[0], p[1], 0.25, M); });
    // 바깥: 남쪽 테라스, 나무
    box(site, -3.8, 0, a + 0.1, 3.8, 0.12, a + 2.7, M.wood, true);
    tree(site, -7.2, -3.4, 1.0); tree(site, 6.9, -5.2, 1.1); tree(site, 7.3, 5.2, 0.8);
    // 지붕: 팔각 뿔 + 꼭대기 채광창
    var Re = R + 0.7;
    frustum(roof, Re, H - 0.1, 0.95, 6.3, rot, M.roof);
    frustum(roof, 0.95, 6.3, 0.95, 7.0, rot, mat(0xbcd8cc, Object.assign({ side: T.DoubleSide }, GLASS)));
    frustum(roof, 1.1, 7.0, 0, 7.7, rot, M.roof);
    var gOct = V.map(function (p) { return [p[0] * 0.965, p[1] * 0.965]; });
    var iOct = V.map(function (p) { return [p[0] * 0.965, p[1] * 0.965]; });
    var glassSides = [7, 0, 1, 2, 3];
    var plan = {
      bounds: [-8.2, -8.0, 8.2, 8.9],
      items: [
        { k: 'poly', pts: V, closed: true, cls: 'w1', d: 1.5 },
        { k: 'poly', pts: gOct.map(function (p) { return [p[0] * 0.97, p[1] * 0.97]; }), closed: true, cls: 'w2', d: 1.2 },
        { k: 'sides', V: V, list: glassSides, d: 1.1 },
        { k: 'circle', x: 0, z: 0, r: 1.5, cls: 'fn', d: 0.6 },
        { k: 'tables', pts: tbl, d: 0.7 },
        { k: 'poly', pts: [[-3.8, a + 0.1], [3.8, a + 0.1], [3.8, a + 2.7], [-3.8, a + 2.7]], closed: true, cls: 'dash', d: 0.6 },
        { k: 'dim', a: [-a, -a - 1.7], b: [a, -a - 1.7], label: '9.0 m (마주 보는 벽 사이)', d: 0.8 },
        { k: 'dim', a: [-a - 1.8, -a], b: [-a - 1.8, a], label: '9.0 m', d: 0.7, v: true },
        { k: 'text', x: 0, z: -2.2, s: '원형 카운터', d: 0.3 }, { k: 'text', x: 0, z: a + 1.6, s: '남쪽 데크', d: 0.2 }
      ]
    };
    return {
      key: 'b', group: [site, base, roof], parts: { site: site, base: base, roof: roof },
      center: [0, 2.6, 0], radius: 8.4, az: 30, explode: { roof: 5.0 },
      title: '팔각 온실 카페', sub: '정팔각 평면 · 유리 벽과 뾰족 지붕',
      facts: [['평면', '정팔각 · 마주 보는 벽 사이 9.0 m'], ['층수', '단층 · 벽 3.2 m, 꼭대기 7.7 m'], ['지붕', '팔각 뿔 지붕 + 꼭대기 채광창'], ['벽', '8면 중 5면이 통유리, 3면은 흰 벽'], ['특징', '가운데 원형 카운터, 남쪽 데크 테라스']],
      plan: plan, open: '지붕 열기'
    };
  }

  /* ---------- 건물 C: 엇갈린 상자 카페 ---------- */
  function buildC() {
    var t = 0.2, H1 = 3.3, S = 0.2, Y2 = H1 + S, H2 = 3.0, YT = Y2 + H2;
    var M = {
      low: mat(0x575c60), wood: mat(0xb78d5f), slab: mat(0xdad7cf), roof: mat(0x3b3e41), floor: mat(0xd9d4c6),
      glass: mat(0x86aeb4, GLASS), doorGlass: mat(0x86aeb4, GLASS), frame: mat(0x26282a), doorFrame: mat(0x6b4a33),
      deck: mat(0xc09a6b), dark: mat(0x5b4a40), table: mat(0xefe7d6), counter: mat(0xb08a62), rail: mat(0x2c2f31)
    };
    var site = new T.Group(), base = new T.Group(), upper = new T.Group(), roof = new T.Group();
    ground(site, 70);
    var r1o = [[0, 0], [6, 0], [6, 10], [0, 10]], r1i = [[t, t], [6 - t, t], [6 - t, 10 - t], [t, 10 - t]];
    var r2o = [[0, 3], [6, 3], [6, 13], [0, 13]], r2i = [[t, 3 + t], [6 - t, 3 + t], [6 - t, 13 - t], [t, 13 - t]];
    box(base, 0, 0, 0, 6, 0.2, 10, M.floor);
    polyExtrude(base, r1o, r1i, 0.2, H1 - 0.2, M.low, true);
    var w1 = [
      { ax: 'z', p0: 10 - t, p1: 10, a0: 0.7, a1: 3.9, y0: 0.2, y1: 2.9 },
      { ax: 'z', p0: 10 - t, p1: 10, a0: 4.2, a1: 5.3, y0: 0.2, y1: 2.7, door: true },
      { ax: 'x', p0: 0, p1: t, a0: 2.0, a1: 4.0, y0: 0.8, y1: 2.6 },
      { ax: 'x', p0: 0, p1: t, a0: 5.5, a1: 7.5, y0: 0.8, y1: 2.6 },
      { ax: 'z', p0: 0, p1: t, a0: 1.0, a1: 3.0, y0: 0.8, y1: 2.6 },
      { ax: 'z', p0: 0, p1: t, a0: 3.6, a1: 5.2, y0: 0.8, y1: 2.6 }
    ];
    w1.forEach(function (w) { windowBox(base, w, M); });
    box(base, 1.0, 0.2, 1.2, 4.2, 1.2, 2.0, M.counter, true);
    [[1.3, 5.0], [3.0, 5.0], [4.7, 5.0], [1.3, 7.7], [3.0, 7.7]].forEach(function (p) { table(base, p[0], p[1], 0.2, M); });
    // 외부 계단(동쪽 벽을 따라 테라스까지)
    var n = 15;
    var topY = Y2, step = topY / n, run = 0.5;
    for (var i = 0; i < n; i++) box(base, 6.0, (i + 1) * step - 0.1, 9.4 - (i + 1) * run, 7.25, (i + 1) * step, 9.4 - i * run, M.slab, true);
    box(base, 6.0, topY - 0.1, 0.2, 7.25, topY, 9.4 - n * run, M.slab, true);
    box(base, 7.18, 0, 9.0, 7.25, 1.0, 9.4, M.rail); box(base, 7.18, topY - 1.0, 0.2, 7.25, topY, 0.27, M.rail);
    // 위층 묶음: 바닥판(1층 천장 + 테라스 + 튀어나온 부분) + 2층 벽
    box(upper, 0, H1, 0, 6, Y2, 13, M.slab, true);
    polyExtrude(upper, r2o, r2i, Y2, H2, M.wood, true);
    box(upper, 0.2, Y2, 0.2, 5.8, Y2 + 0.1, 2.8, M.deck);
    // 테라스 난간
    [0.2, 1.1, 2.0, 2.9, 3.8, 4.7, 5.8].forEach(function (x) { box(upper, x - 0.025, Y2, 0.1, x + 0.025, Y2 + 1.05, 0.15, M.rail); });
    box(upper, 0.05, Y2 + 1.0, 0.1, 5.95, Y2 + 1.07, 0.15, M.rail);
    [0.2, 1.4, 2.6].forEach(function (z) { box(upper, 0.1, Y2, z - 0.025, 0.15, Y2 + 1.05, z + 0.025, M.rail); });
    box(upper, 0.1, Y2 + 1.0, 0.1, 0.15, Y2 + 1.07, 2.95, M.rail);
    var w2 = [
      { ax: 'x', p0: 6 - t, p1: 6, a0: 3.8, a1: 6.6, y0: 4.3, y1: 5.6 },
      { ax: 'x', p0: 6 - t, p1: 6, a0: 7.0, a1: 9.8, y0: 4.3, y1: 5.6 },
      { ax: 'x', p0: 6 - t, p1: 6, a0: 10.2, a1: 12.4, y0: 4.3, y1: 5.6 },
      { ax: 'x', p0: 0, p1: t, a0: 3.8, a1: 6.6, y0: 4.3, y1: 5.6 },
      { ax: 'x', p0: 0, p1: t, a0: 7.0, a1: 9.8, y0: 4.3, y1: 5.6 },
      { ax: 'x', p0: 0, p1: t, a0: 10.2, a1: 12.4, y0: 4.3, y1: 5.6 },
      { ax: 'z', p0: 13 - t, p1: 13, a0: 0.7, a1: 5.3, y0: 4.0, y1: 6.1 },
      { ax: 'z', p0: 3, p1: 3 + t, a0: 2.4, a1: 3.6, y0: Y2 + 0.1, y1: 5.8, door: true },
      { ax: 'z', p0: 3, p1: 3 + t, a0: 0.6, a1: 2.0, y0: 4.4, y1: 5.6 },
      { ax: 'z', p0: 3, p1: 3 + t, a0: 4.0, a1: 5.4, y0: 4.4, y1: 5.6 }
    ];
    w2.forEach(function (w) { windowBox(upper, w, M); });
    [[1.5, 6.0], [3.2, 6.0], [4.8, 6.0], [1.5, 9.0], [3.2, 9.0], [4.8, 9.0], [3.0, 11.6]].forEach(function (p) { table(upper, p[0], p[1], Y2, M); });
    box(upper, 0.5, Y2, 4.0, 3.5, Y2 + 1.0, 4.8, M.counter, true);
    // 지붕: 얇은 평지붕
    box(roof, -0.15, YT, 2.85, 6.15, YT + 0.22, 13.15, M.roof, true);
    box(roof, -0.15, YT + 0.22, 2.85, 6.15, YT + 0.5, 3.0, M.roof);
    box(roof, -0.15, YT + 0.22, 13.0, 6.15, YT + 0.5, 13.15, M.roof);
    tree(site, -2.0, 2.0, 1.0); tree(site, 9.8, 11.0, 0.9);
    var stairLines = [];
    for (i = 0; i < n; i++) stairLines.push([[6.05, 9.4 - i * run], [7.25, 9.4 - i * run]]);
    var plan = {
      bounds: [-2.8, -2.6, 10.6, 15.6],
      items: [
        { k: 'poly', pts: r1o, closed: true, cls: 'w1', d: 1.3 },
        { k: 'poly', pts: r1i, closed: true, cls: 'w2', d: 1.0 },
        { k: 'poly', pts: r2o, closed: true, cls: 'dash2', d: 1.3 },
        { k: 'poly', pts: [[6.05, 1.9], [7.25, 1.9], [7.25, 9.4], [6.05, 9.4]], closed: true, cls: 'w2', d: 0.5 },
        { k: 'multi', lines: stairLines, cls: 'fn', d: 0.6 },
        { k: 'wins', list: w1.concat(w2), d: 1.0 },
        { k: 'poly', pts: [[1.0, 1.2], [4.2, 1.2], [4.2, 2.0], [1.0, 2.0]], closed: true, cls: 'fn', d: 0.4 },
        { k: 'tables', pts: [[1.3, 5.0], [3.0, 5.0], [4.7, 5.0], [1.3, 7.7], [3.0, 7.7]], d: 0.6 },
        { k: 'dim', a: [0, -1.4], b: [6, -1.4], label: '6.0 m', d: 0.6 },
        { k: 'dim', a: [-1.5, 0], b: [-1.5, 10], label: '1층 10.0 m', d: 0.7, v: true },
        { k: 'dim', a: [9.2, 3], b: [9.2, 13], label: '2층 10.0 m', d: 0.7, v: true },
        { k: 'text', x: 3, z: 0.9 + 0.2, s: '', d: 0.1 }, { k: 'text', x: 3, z: 14.6, s: '점선: 위층이 3 m 튀어나온 부분', d: 0.3 },
        { k: 'text', x: 3, z: 0.85, s: '테라스(1층 지붕)', d: 0.2 }, { k: 'text', x: 8.1, z: 5.5, s: '계단', d: 0.2, vert: true }
      ]
    };
    return {
      key: 'c', group: [site, base, upper, roof], parts: { site: site, base: base, upper: upper, roof: roof },
      center: [3.3, 3.4, 6.3], radius: 10.4, az: 38, explode: { upper: 3.4, roof: 6.8 },
      title: '엇갈린 상자 카페', sub: '2층 상자가 1층 위로 튀어나온 건물',
      facts: [['평면', '6.0 × 10.0 m · 2층은 3.0 m 앞으로 튀어나옴'], ['층수', '2층 · 1층 3.3 m, 2층 3.0 m (꼭대기 약 7.0 m)'], ['지붕', '평지붕 · 뒤쪽 1층 지붕은 테라스'], ['마감', '1층 짙은 회색, 2층 나무 패널, 가로로 긴 창'], ['특징', '튀어나온 2층 아래 출입구, 동쪽 외부 계단']],
      plan: plan, open: '지붕 열기'
    };
  }

  var BUILD = { a: buildA, b: buildB, c: buildC };
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ---------- 도면(SVG) ---------- */
  function el(n, at, parent) {
    var e = document.createElementNS(SVGNS, n);
    for (var k in at) e.setAttribute(k, at[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function circ(x, z, r) { return 'M' + (x - r) + ' ' + z + 'a' + r + ' ' + r + ' 0 1 0 ' + 2 * r + ' 0a' + r + ' ' + r + ' 0 1 0 ' + (-2 * r) + ' 0'; }
  function buildPlan(svg, plan, instant) {
    var b = plan.bounds, vb = [b[0], b[1], b[2] - b[0], b[3] - b[1]];
    svg.setAttribute('viewBox', vb.join(' '));
    svg.innerHTML = '';
    var seq = [], t0 = 0.25;
    function reg(node, dur, fade) { seq.push({ n: node, d: dur, fade: fade }); }
    plan.items.forEach(function (it) {
      var g = el('g', { 'class': 'it' }, svg);
      if (it.k === 'poly') {
        var d = it.pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ' ' + p[1]; }).join(' ') + (it.closed ? ' Z' : '');
        if (/^dash/.test(it.cls || '')) reg(el('path', { d: d, 'class': 'st ' + it.cls }, g), it.d, true);
        else reg(el('path', { d: d, 'class': 'st ' + (it.cls || 'w1'), pathLength: 1 }, g), it.d);
      } else if (it.k === 'multi') {
        it.lines.forEach(function (l) { reg(el('path', { d: 'M' + l[0][0] + ' ' + l[0][1] + 'L' + l[1][0] + ' ' + l[1][1], 'class': 'st ' + it.cls, pathLength: 1 }, g), it.d / 3); });
      } else if (it.k === 'circle') {
        reg(el('path', { d: circ(it.x, it.z, it.r), 'class': 'st ' + (it.cls || 'fn'), pathLength: 1 }, g), it.d);
      } else if (it.k === 'tables') {
        it.pts.forEach(function (p) { reg(el('path', { d: circ(p[0], p[1], 0.42), 'class': 'st fn', pathLength: 1 }, g), it.d / 2); });
      } else if (it.k === 'wins') {
        it.list.forEach(function (w) {
          var m = (w.p0 + w.p1) / 2, d = w.ax === 'x' ? 'M' + m + ' ' + w.a0 + 'L' + m + ' ' + w.a1 : 'M' + w.a0 + ' ' + m + 'L' + w.a1 + ' ' + m;
          reg(el('path', { d: d, 'class': 'st ' + (w.door ? 'dr' : 'wn'), pathLength: 1 }, g), it.d / 3);
        });
      } else if (it.k === 'sides') {
        it.list.forEach(function (k) {
          var p = it.V[k], q = it.V[(k + 1) % 8];
          var f = 0.93, cx = (p[0] + q[0]) / 2, cz = (p[1] + q[1]) / 2;
          reg(el('path', { d: 'M' + (cx + (p[0] - cx) * f) + ' ' + (cz + (p[1] - cz) * f) + 'L' + (cx + (q[0] - cx) * f) + ' ' + (cz + (q[1] - cz) * f), 'class': 'st wn', pathLength: 1 }, g), it.d / 3);
        });
      } else if (it.k === 'dim') {
        var a = it.a, c = it.b, v = it.v;
        reg(el('path', { d: 'M' + a[0] + ' ' + a[1] + 'L' + c[0] + ' ' + c[1] + (v ? 'M' + (a[0] - 0.25) + ' ' + a[1] + 'L' + (a[0] + 0.25) + ' ' + a[1] + 'M' + (c[0] - 0.25) + ' ' + c[1] + 'L' + (c[0] + 0.25) + ' ' + c[1] : 'M' + a[0] + ' ' + (a[1] - 0.25) + 'L' + a[0] + ' ' + (a[1] + 0.25) + 'M' + c[0] + ' ' + (c[1] - 0.25) + 'L' + c[0] + ' ' + (c[1] + 0.25)), 'class': 'st dm', pathLength: 1 }, g), it.d);
        var tx = (a[0] + c[0]) / 2, tz = (a[1] + c[1]) / 2;
        var tt = el('text', { x: v ? tx - 0.35 : tx, y: v ? tz : tz - 0.4, 'class': 'tx', 'text-anchor': 'middle', transform: v ? 'rotate(-90 ' + (tx - 0.35) + ' ' + tz + ')' : '' }, g);
        tt.textContent = it.label; reg(tt, 0.4, true);
      } else if (it.k === 'text' && it.s) {
        var te = el('text', { x: it.x, y: it.z, 'class': 'tx sm', 'text-anchor': 'middle', transform: it.vert ? 'rotate(-90 ' + it.x + ' ' + it.z + ')' : '' }, g);
        te.textContent = it.s; reg(te, 0.4, true);
      }
    });
    var delay = t0;
    seq.forEach(function (s) {
      var n = s.n;
      if (s.fade) {
        n.style.opacity = instant ? 1 : 0;
        if (!instant) n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: delay * 1000, fill: 'forwards' });
      } else {
        n.style.strokeDasharray = '1.2 3'; n.style.strokeDashoffset = instant ? '0' : '1.2';
        if (!instant) n.animate([{ strokeDashoffset: 1.2 }, { strokeDashoffset: 0 }], { duration: Math.max(s.d, 0.15) * 1000, delay: delay * 1000, fill: 'forwards', easing: 'ease-in-out' });
      }
      if (!s.fade) delay += Math.max(s.d, 0.15) * 0.85;
    });
    return delay + 0.5;
  }

  /* ---------- 뷰어 ---------- */
  function ease(t) { return 1 - Math.pow(1 - t, 3); }
  function start() {
    var body = document.body, key = body.getAttribute('data-key'), q = new URLSearchParams(location.search);
    var still = q.get('still'), B = BUILD[key]();
    var stage = document.getElementById('stage'), svg = document.getElementById('plan'), host = document.getElementById('gl');
    if (still) body.classList.add('still');
    if (q.get('theme') === 'light') document.documentElement.setAttribute('data-theme', 'light');
    if (still === 'plan') body.classList.add('still-plan');
    var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var facts = document.getElementById('facts');
    if (facts) facts.innerHTML = B.facts.map(function (f) { return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>'; }).join('');
    var poster = document.getElementById('poster');
    if (poster) poster.innerHTML = '<p class="pk">COFFEE SHOP · SAMPLE</p><h2>' + B.title + '</h2><p>' + B.sub + '</p>';

    var renderer;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    } catch (e) { renderer = null; }
    var planDur = buildPlan(svg, B.plan, !!still || reduce || !renderer);
    if (!renderer) {
      host.style.display = 'none';
      var nb = document.getElementById('nogl'); if (nb) nb.hidden = false;
      return;
    }
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);
    var scene = new T.Scene(); scene.background = new T.Color(0xe9e5d9);
    var cam = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    var hemi = new T.HemisphereLight(0xffffff, 0x9d9482, 0.6); scene.add(hemi);
    var sun = new T.DirectionalLight(0xfff3df, 0.55);
    sun.position.set(B.center[0] + 18, 30, B.center[2] + 10); sun.target.position.set(B.center[0], 0, B.center[2]);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    var sc = sun.shadow.camera; sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 90; sun.shadow.bias = -0.0004;
    scene.add(sun); scene.add(sun.target);
    B.group.forEach(function (g) { scene.add(g); });
    var P = B.parts, az = B.az * D2R, el = 28 * D2R, zoom = 1, auto = false, userAt = 0;
    var state = { open: false, explode: false };
    function aim() {
      var c = B.center, d = 120;
      cam.position.set(c[0] + d * Math.cos(el) * Math.cos(az), c[1] + d * Math.sin(el), c[2] + d * Math.cos(el) * Math.sin(az));
      cam.lookAt(c[0], c[1], c[2]);
    }
    function size() {
      var w = host.clientWidth || 800, h = host.clientHeight || 500;
      renderer.setSize(w, h, false);
      var ar = w / h, hh = B.radius * 1.12 / zoom;
      var fit = Math.max(hh, (B.radius * 1.12 * 1.18) / ar);
      cam.top = fit; cam.bottom = -fit; cam.left = -fit * ar; cam.right = fit * ar;
      cam.updateProjectionMatrix(); aim();
    }
    global.addEventListener('resize', size); size();

    // 부드러운 값 변화
    var tweens = [];
    function tween(obj, prop, to, dur, delay, done) {
      tweens.push({ o: obj, p: prop, a: obj[prop], b: to, d: dur * 1000, t0: performance.now() + (delay || 0) * 1000, done: done });
    }
    function setPos(g, y) { g.position.y = y; }
    function applyView(animate) {
      var ex = state.explode ? B.explode : {};
      ['roof', 'upper'].forEach(function (n) {
        if (!P[n]) return;
        var target = (ex[n] || 0);
        if (n === 'roof' && state.open && !state.explode) { P[n].visible = false; }
        else { P[n].visible = true; }
        if (animate) tween(P[n].position, 'y', target, 0.7); else P[n].position.y = target;
      });
      if (state.open && !state.explode) { if (P.roof) P.roof.visible = false; }
    }
    var showing3D = false, t3 = 0;
    function show3D(animateBuild) {
      showing3D = true; host.classList.add('on'); svg.classList.add('off');
      if (animateBuild) {
        P.base.scale.y = 0.001; if (P.upper) P.upper.position.y = 9; P.roof.position.y = 12;
        tween(P.base.scale, 'y', 1, 1.0, 0.1);
        if (P.upper) tween(P.upper.position, 'y', 0, 0.9, 0.9);
        tween(P.roof.position, 'y', 0, 1.0, P.upper ? 1.7 : 1.0, function () { auto = true; });
      }
    }
    function replay() {
      state.open = false; state.explode = false; syncButtons();
      showing3D = false; auto = false; host.classList.remove('on'); svg.classList.remove('off');
      P.base.scale.y = 1; if (P.upper) P.upper.position.y = 0; P.roof.position.y = 0; P.roof.visible = true;
      var dur = buildPlan(svg, B.plan, false);
      clearTimeout(replay.t); replay.t = setTimeout(function () { show3D(true); }, dur * 1000);
    }
    function syncButtons() {
      var bo = document.getElementById('b-open'), be = document.getElementById('b-explode'), ba = document.getElementById('b-auto');
      if (bo) { bo.setAttribute('aria-pressed', state.open); bo.textContent = state.open ? '지붕 덮기' : B.open; }
      if (be) { be.setAttribute('aria-pressed', state.explode); be.textContent = state.explode ? '다시 합치기' : '층별로 떼어 보기'; }
      if (ba) ba.setAttribute('aria-pressed', auto);
    }
    function on(id, fn) { var b = document.getElementById(id); if (b) b.addEventListener('click', fn); }
    on('b-replay', replay);
    on('b-open', function () { if (!showing3D) show3D(false); state.explode = false; state.open = !state.open; syncButtons(); applyView(true); if (state.open) P.roof.visible = false; else { P.roof.visible = true; } });
    on('b-explode', function () { if (!showing3D) show3D(false); state.open = false; state.explode = !state.explode; syncButtons(); applyView(true); });
    on('b-auto', function () { auto = !auto; syncButtons(); });
    on('b-plan', function () { showing3D = false; host.classList.remove('on'); svg.classList.remove('off'); buildPlan(svg, B.plan, true); });
    on('b-3d', function () { if (!showing3D) show3D(false); });

    // 끌어서 돌리기
    var drag = null;
    host.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY }; auto = false; syncButtons(); host.setPointerCapture(e.pointerId); });
    host.addEventListener('pointermove', function (e) {
      if (!drag) return; az -= (e.clientX - drag.x) * 0.008; el = Math.max(8 * D2R, Math.min(70 * D2R, el + (e.clientY - drag.y) * 0.006));
      drag = { x: e.clientX, y: e.clientY }; aim();
    });
    host.addEventListener('pointerup', function () { drag = null; });
    host.addEventListener('keydown', function (e) {
      var m = { ArrowLeft: [0.12, 0], ArrowRight: [-0.12, 0], ArrowUp: [0, 0.07], ArrowDown: [0, -0.07] }[e.key];
      if (m) { az += m[0]; el = Math.max(8 * D2R, Math.min(70 * D2R, el + m[1])); aim(); e.preventDefault(); }
    });

    function frame(now) {
      for (var i = tweens.length - 1; i >= 0; i--) {
        var tw = tweens[i], p = (now - tw.t0) / tw.d;
        if (p < 0) continue;
        if (tw.t0 > now - 1 && !tw.started) { tw.a = tw.o[tw.p]; tw.started = true; }
        if (!tw.started) { tw.a = tw.o[tw.p]; tw.started = true; }
        if (p >= 1) { tw.o[tw.p] = tw.b; tweens.splice(i, 1); if (tw.done) tw.done(); }
        else tw.o[tw.p] = tw.a + (tw.b - tw.a) * ease(p);
      }
      if (auto) { az += 0.0035; aim(); }
      renderer.render(scene, cam);
      global.requestAnimationFrame(frame);
    }

    // 시작 상태
    if (still) {
      showing3D = still !== 'plan';
      if (showing3D) { host.classList.add('on'); svg.classList.add('off'); }
      if (still === 'open') state.open = true;
      if (still === 'explode') { state.explode = true; el = 24 * D2R; }
      applyView(false);
      if (state.open) P.roof.visible = false;
      aim(); size();
      document.title = 'ready:' + still;
      global.requestAnimationFrame(frame);
    } else if (reduce) {
      show3D(false); syncButtons(); global.requestAnimationFrame(frame);
    } else {
      syncButtons();
      replay.t = setTimeout(function () { show3D(true); }, planDur * 1000);
      global.requestAnimationFrame(frame);
    }
  }

  global.Cafe3D = { start: start };
})(window);
