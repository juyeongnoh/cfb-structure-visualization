/* =====================================================================
 * rbtree.js — CFB 디렉터리가 쓰는 레드-블랙 트리
 *
 * CFB에서 한 저장소(폴더)의 자식들은 "목록"이 아니라 "레드-블랙 트리"로
 * 묶인다. 그래서 디렉터리 엔트리에 left / right / child 세 개의 포인터가
 * 있는 것이다. 여기서는 실제 회전과 재색칠을 수행하고, 그 과정을 단계별로
 * 기록해서 시각화가 그대로 재생할 수 있게 한다.
 * ===================================================================== */
(function (root) {
  'use strict';

  var RED = 0, BLACK = 1;

  /* --- CFB의 이름 비교 규칙 -----------------------------------------
   * 1) 먼저 이름의 "길이"를 비교한다  (사전순이 아니다!)
   * 2) 길이가 같으면 대문자로 바꿔 UTF-16 코드 단위끼리 비교한다
   * 이 규칙 때문에 "Zz"가 "AAA"보다 앞에 온다.                          */
  function cmpName(a, b) {
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
    var A = a.toUpperCase(), B = b.toUpperCase();
    for (var i = 0; i < A.length; i++) {
      var d = A.charCodeAt(i) - B.charCodeAt(i);
      if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  function Node(name, payload) {
    this.name = name;
    this.payload = payload;
    this.color = RED;
    this.left = null;
    this.right = null;
    this.parent = null;
  }

  function Tree() {
    this.root = null;
    this.steps = [];   // 시각화용 단계 기록
  }

  Tree.prototype._log = function (kind, text, focus) {
    this.steps.push({ kind: kind, text: text, focus: focus || null, snapshot: this.snapshot() });
  };

  /* 현재 트리 모양을 순수 데이터로 복사 (시각화가 안전하게 붙잡을 수 있게) */
  Tree.prototype.snapshot = function () {
    function cp(n) {
      if (!n) return null;
      return { name: n.name, color: n.color, left: cp(n.left), right: cp(n.right) };
    }
    return cp(this.root);
  };

  Tree.prototype._rotateLeft = function (x) {
    var y = x.right;
    x.right = y.left;
    if (y.left) y.left.parent = x;
    y.parent = x.parent;
    if (!x.parent) this.root = y;
    else if (x === x.parent.left) x.parent.left = y;
    else x.parent.right = y;
    y.left = x;
    x.parent = y;
  };

  Tree.prototype._rotateRight = function (x) {
    var y = x.left;
    x.left = y.right;
    if (y.right) y.right.parent = x;
    y.parent = x.parent;
    if (!x.parent) this.root = y;
    else if (x === x.parent.right) x.parent.right = y;
    else x.parent.left = y;
    y.right = x;
    x.parent = y;
  };

  Tree.prototype.insert = function (name, payload) {
    var z = new Node(name, payload);
    var y = null, x = this.root;
    var path = [];
    while (x) {
      y = x;
      var c = cmpName(z.name, x.name);
      if (c === 0) throw new Error('중복된 이름: ' + name);
      path.push({ at: x.name, dir: c < 0 ? 'left' : 'right', cmp: c });
      x = c < 0 ? x.left : x.right;
    }
    z.parent = y;
    if (!y) this.root = z;
    else if (cmpName(z.name, y.name) < 0) y.left = z;
    else y.right = z;

    this._log('descend',
      path.length
        ? '"' + name + '"을(를) 넣을 자리를 찾아 내려간다: ' +
          path.map(function (p) { return p.at + '에서 ' + (p.dir === 'left' ? '왼쪽' : '오른쪽'); }).join(' → ')
        : '"' + name + '"이(가) 이 트리의 첫 노드가 된다.',
      name);
    this._log('insert', '"' + name + '"을(를) RED로 삽입했다. RED로 넣어야 검은 높이가 깨지지 않는다.', name);

    this._fixup(z);
    if (this.root.color !== BLACK) {
      this.root.color = BLACK;
      this._log('recolor', '루트는 항상 BLACK이어야 하므로 "' + this.root.name + '"을(를) 검게 칠한다.', this.root.name);
    }
    return z;
  };

  Tree.prototype._fixup = function (z) {
    while (z.parent && z.parent.color === RED) {
      var gp = z.parent.parent;
      if (!gp) break;
      var isLeftBranch = z.parent === gp.left;
      var uncle = isLeftBranch ? gp.right : gp.left;

      if (uncle && uncle.color === RED) {
        /* 경우 1: 삼촌도 RED → 색만 바꾸고 할아버지에서 다시 검사 */
        z.parent.color = BLACK;
        uncle.color = BLACK;
        gp.color = RED;
        this._log('recolor',
          '위반: RED "' + z.name + '"의 부모도 RED다. 삼촌 "' + uncle.name + '"도 RED이므로 ' +
          '부모와 삼촌을 BLACK으로, 할아버지 "' + gp.name + '"을(를) RED로 칠해 문제를 위로 올린다.', gp.name);
        z = gp;
      } else {
        /* 경우 2: 안쪽으로 꺾였으면 먼저 펴 준다 */
        if (isLeftBranch && z === z.parent.right) {
          z = z.parent;
          this._rotateLeft(z);
          this._log('rotate', '"' + z.name + '"을(를) 기준으로 왼쪽 회전해서 꺾인 모양을 일직선으로 편다.', z.name);
        } else if (!isLeftBranch && z === z.parent.left) {
          z = z.parent;
          this._rotateRight(z);
          this._log('rotate', '"' + z.name + '"을(를) 기준으로 오른쪽 회전해서 꺾인 모양을 일직선으로 편다.', z.name);
        }
        /* 경우 3: 색을 바꾸고 할아버지를 회전 */
        z.parent.color = BLACK;
        z.parent.parent.color = RED;
        var g = z.parent.parent;
        if (z === z.parent.left) {
          this._rotateRight(g);
          this._log('rotate', '"' + g.name + '"을(를) 기준으로 오른쪽 회전. 부모가 올라와 BLACK이 되고 균형이 맞는다.', g.name);
        } else {
          this._rotateLeft(g);
          this._log('rotate', '"' + g.name + '"을(를) 기준으로 왼쪽 회전. 부모가 올라와 BLACK이 되고 균형이 맞는다.', g.name);
        }
      }
    }
  };


  /* --- 이미 파일에 저장된 링크들로부터 트리를 복원한다 -----------------
   * 디렉터리 엔트리에는 left/right/color만 있으므로, 그것으로 메모리상의
   * 트리를 되살려야 삽입(회전 포함)을 이어서 할 수 있다.               */
  Tree.fromLinks = function (rootKey, get) {
    var t = new Tree();
    var NONE = 0xffffffff;
    function build(key, parent) {
      if (key === NONE || key === undefined || key === null) return null;
      var d = get(key);
      if (!d) return null;
      var n = new Node(d.name, d.payload);
      n.color = d.color;
      n.parent = parent;
      n.left = build(d.left, n);
      n.right = build(d.right, n);
      return n;
    }
    t.root = build(rootKey, null);
    return t;
  };

  /* 정렬된 목록으로 완전히 새 트리를 만든다 (삭제 후 재구성용).
   * 실제 구현들(Apache POI 등)도 삭제 시 트리를 다시 세우는 쪽을 택한다. */
  Tree.rebuild = function (items) {
    var t = new Tree();
    var sorted = items.slice().sort(function (a, b) { return cmpName(a.name, b.name); });
    /* 가운데를 뿌리로 하는 균형 이진 트리를 만든 뒤, 마지막 층만 RED로 칠해
     * 레드-블랙 성질(모든 경로의 검은 노드 수가 같다)을 만족시킨다. */
    var maxDepth = Math.floor(Math.log2(sorted.length || 1));
    function build(lo, hi, depth, parent) {
      if (lo > hi) return null;
      var mid = (lo + hi) >> 1;
      var n = new Node(sorted[mid].name, sorted[mid].payload);
      n.parent = parent;
      n.left = build(lo, mid - 1, depth + 1, n);
      n.right = build(mid + 1, hi, depth + 1, n);
      var isDeepest = !n.left && !n.right && depth === maxDepth;
      n.color = isDeepest ? RED : BLACK;
      return n;
    }
    t.root = build(0, sorted.length - 1, 0, null);
    if (t.root) t.root.color = BLACK;
    if (!t.validate().ok) {
      /* 안전망: 균형 배치로 성질이 깨지면 한 개씩 삽입해서 다시 만든다 */
      t = new Tree();
      sorted.forEach(function (it) { t.insert(it.name, it.payload); });
    }
    return t;
  };

  /* 트리를 이름 순서(= 중위 순회)로 나열 */
  Tree.prototype.inorder = function () {
    var out = [];
    (function walk(n) {
      if (!n) return;
      walk(n.left); out.push(n); walk(n.right);
    })(this.root);
    return out;
  };

  Tree.prototype.all = function () {
    var out = [];
    (function walk(n) {
      if (!n) return;
      out.push(n); walk(n.left); walk(n.right);
    })(this.root);
    return out;
  };

  /* 검은 높이 검증 — 교육용으로 "정말 유효한 RB 트리인가"를 보여 준다 */
  Tree.prototype.validate = function () {
    var problems = [];
    if (this.root && this.root.color !== BLACK) problems.push('루트가 BLACK이 아니다');
    var bh = -1;
    (function walk(n, blacks) {
      if (!n) {
        if (bh === -1) bh = blacks;
        else if (bh !== blacks) problems.push('경로마다 검은 노드 수가 다르다');
        return;
      }
      if (n.color === RED) {
        if (n.left && n.left.color === RED) problems.push('RED ' + n.name + '의 왼쪽 자식도 RED');
        if (n.right && n.right.color === RED) problems.push('RED ' + n.name + '의 오른쪽 자식도 RED');
      }
      var b = blacks + (n.color === BLACK ? 1 : 0);
      walk(n.left, b); walk(n.right, b);
    })(this.root, 0);
    return { ok: problems.length === 0, blackHeight: bh, problems: problems };
  };

  root.RBTree = { Tree: Tree, Node: Node, cmpName: cmpName, RED: RED, BLACK: BLACK };
})(typeof window !== 'undefined' ? window : globalThis);
