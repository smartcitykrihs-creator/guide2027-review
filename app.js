(function () {
  'use strict';
  var C = window.APP_CONFIG || {};
  var root = document.getElementById('app');
  document.title = C.title || document.title;

  var S = {
    name: '', code: '', member: null, agendas: [], second: {}, saved: {}, answers: {},
    closed: false, cur: '', shared: null, sharedTotal: 0, busy: false
  };

  /* ---------- 도우미 ---------- */
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] === true) e.setAttribute(k, '');
      else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function stable(o) {
    if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
    if (o && typeof o === 'object') return '{' + Object.keys(o).sort().map(function (k) { return JSON.stringify(k) + ':' + stable(o[k]); }).join(',') + '}';
    return JSON.stringify(o);
  }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* 저장소 사용 불가 */ } }
  function ssGet(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* 저장소 사용 불가 */ } }
  function ssDel(k) { try { window.sessionStorage.removeItem(k); } catch (e) { /* 저장소 사용 불가 */ } }
  function agendaOf(id) { for (var i = 0; i < S.agendas.length; i++) if (S.agendas[i].id === id) return S.agendas[i]; return null; }
  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate()) + '. ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  var FAIL_SAVE = '저장되지 않았습니다. 휴대폰으로 접속하시거나 메일로 회신해 주십시오.';
  function contactLine() {
    return C.contactEmail ? ('문의: ' + (C.organization || '') + ' (' + C.contactEmail + ')') : ('문의: ' + (C.organization || ''));
  }

  /* ---------- 서버 통신 ---------- */
  function api(payload) {
    return new Promise(function (resolve) {
      if (!C.api) { resolve({ok: false, error: 'network', message: '서버 주소가 설정되어 있지 않습니다.'}); return; }
      var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 25000);
      var opt = {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify(payload), redirect: 'follow'};
      if (ctl) opt.signal = ctl.signal;
      fetch(C.api, opt).then(function (r) { return r.json(); }).then(function (j) {
        clearTimeout(timer); resolve(j && typeof j === 'object' ? j : {ok: false, error: 'network', message: '서버 응답을 읽을 수 없습니다.'});
      }).catch(function () {
        clearTimeout(timer); resolve({ok: false, error: 'network', message: '서버에 연결하지 못했습니다.'});
      });
    });
  }

  /* ---------- 답변 모델 ---------- */
  function emptyAnswer(a) {
    if (a.mode === 'discuss') return {sel: {g: {}, agree: false}, opinion: ''};
    if (a.mode === 'agreement') return {sel: {mode: '', items: ''}, opinion: ''};
    return {sel: {mode: ''}, opinion: ''};
  }
  function isFilled(a, ans) {
    if (!ans) return false;
    var s = ans.sel || {};
    if (a.mode === 'discuss') {
      var any = !!s.agree;
      var g = s.g || {};
      Object.keys(g).forEach(function (k) { if (Array.isArray(g[k]) ? g[k].length : g[k]) any = true; });
      return any || !!(ans.opinion || '').trim();
    }
    return !!s.mode;
  }
  function snapshot(ans) { return stable({sel: ans.sel, opinion: ans.opinion}); }
  function status(aid) {
    var a = agendaOf(aid), ans = S.answers[aid], sv = S.saved[aid];
    var filled = isFilled(a, ans);
    var isSaved = sv && snapshot({sel: sv.sel, opinion: sv.opinion || ''}) === snapshot(ans);
    if (isSaved && filled) return 'saved';
    if (filled) return 'draft';
    return sv ? 'draft' : 'none';
  }
  function draftKey() { return 'sc3_draft_' + (S.member ? S.member.label : ''); }
  function loadDrafts() { try { return JSON.parse(lsGet(draftKey()) || '{}') || {}; } catch (e) { return {}; } }
  function persistDraft(aid) {
    var d = loadDrafts();
    var sv = S.saved[aid];
    var same = sv && snapshot({sel: sv.sel, opinion: sv.opinion || ''}) === snapshot(S.answers[aid]);
    if (same || !isFilled(agendaOf(aid), S.answers[aid]) && !sv) delete d[aid];
    else d[aid] = {sel: S.answers[aid].sel, opinion: S.answers[aid].opinion, t: new Date().toISOString()};
    lsSet(draftKey(), JSON.stringify(d));
  }
  function clearDraft(aid) {
    var d = loadDrafts(); delete d[aid]; lsSet(draftKey(), JSON.stringify(d));
  }
  function selText(a, sel) {
    sel = sel || {};
    if (a.mode === 'agreement') {
      if (sel.mode === 'none') return '이견 없음';
      if (sel.mode === 'yes') return '이견 있음' + (sel.items ? '(이견 문항: ' + sel.items + ')' : '');
      return '';
    }
    if (a.mode === 'confirm') {
      return sel.mode === 'agree' ? '다수 의견 채택에 동의' : (sel.mode === 'dissent' ? '이견 있음' : '');
    }
    var parts = [];
    (a.groups || []).forEach(function (g) {
      var v = (sel.g || {})[g.id];
      var vs = Array.isArray(v) ? v : (v ? [v] : []);
      var txt = g.options.filter(function (o) { return vs.indexOf(o[0]) >= 0; }).map(function (o) { return o[1]; });
      if (txt.length) parts.push(g.label.replace(/\(.*\)$/, '') + ': ' + txt.join(', '));
    });
    if (sel.agree) parts.push('연구진 검토 의견에 동의');
    return parts.join(' / ');
  }

  /* ---------- 로그인 ---------- */
  function renderLogin(errMsg, prefill) {
    root.textContent = '';
    var name = el('input', {type: 'text', id: 'f-name', autocomplete: 'off', 'aria-label': '성명', value: prefill || ''});
    var err = el('div', {id: 'login-err', class: 'msg err', role: 'alert', hidden: !errMsg, text: errMsg || ''});
    var btn = el('button', {class: 'primary', type: 'submit', id: 'btn-login', text: '확인'});
    var form = el('form', {id: 'login-form'}, [
      el('label', {class: 'fl', for: 'f-name', text: '성명'}), name,
      el('div', {class: 'actions'}, [btn]), err
    ]);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      doLogin(name.value, '', err, btn);
    });
    root.appendChild(el('div', {class: 'login'}, [
      el('div', {class: 'card'}, [
        el('h1', {text: C.title || ''}),
        el('p', {class: 'meta', text: '회의 일시: ' + (C.meeting || '')}),
        el('p', {class: 'meta', text: '회의 중 안건별로 선택하거나 의견을 입력해 주시면 논의에 반영하겠습니다. 성명을 입력해 주십시오. 입력하신 의견은 다른 위원님께도 성명과 함께 공유됩니다. 입력은 11월 30일(월)까지 가능합니다.'}),
        form,
        el('p', {class: 'small', text: '개인정보 수집·이용 안내: 입력하신 성명과 의견은 3차 자문회의 운영과 공모지침 개선 검토에만 쓰며, 자문위원과 연구진에게 공유되고 과업 종료 후 폐기합니다.'}),
        el('p', {class: 'small', text: contactLine()})
      ])
    ]));
  }

  function doLogin(n, c, err, btn) {
    if (S.busy) return;
    S.busy = true; btn.disabled = true; err.hidden = true;
    api({action: 'login', name: n, code: c}).then(function (res) {
      S.busy = false; btn.disabled = false;
      if (!res.ok) {
        err.textContent = res.error === 'network'
          ? '서버에 연결하지 못했습니다. 잠시 뒤 다시 시도하시거나 휴대폰으로 접속해 주십시오. 계속 접속되지 않으면 메일로 의견을 보내 주십시오.' + (C.contactEmail ? ' (' + C.contactEmail + ')' : '')
          : (res.message || '등록된 위원 성명이 아닙니다. 다시 확인해 주십시오.');
        err.hidden = false; return;
      }
      S.name = n; S.code = c;
      ssSet('sc3_cred', JSON.stringify({n: n, c: c}));
      enter(res);
    });
  }

  function enter(res) {
    S.member = res.member; S.agendas = res.agendas || []; S.second = res.second || {};
    S.saved = res.saved || {}; S.closed = !!res.closed; S.shared = null;
    var drafts = loadDrafts();
    S.answers = {};
    S.agendas.forEach(function (a) {
      var sv = S.saved[a.id], dr = drafts[a.id];
      var base = emptyAnswer(a);
      if (sv) {
        sv.opinion = sv.opinion || '';
        base = {sel: sv.sel || base.sel, opinion: sv.opinion};
      }
      if (dr && (!sv || String(dr.t) > String(sv.updated))) base = {sel: dr.sel, opinion: dr.opinion || ''};
      S.answers[a.id] = base;
    });
    S.cur = S.agendas.length ? S.agendas[0].id : 'status';
    renderMain();
  }

  function logout() {
    ssDel('sc3_cred');
    S = {name: '', code: '', member: null, agendas: [], second: {}, saved: {}, answers: {}, closed: false, cur: '', shared: null, sharedTotal: 0, busy: false};
    renderLogin();
  }

  /* ---------- 메인 화면 ---------- */
  var navBox = null, mainBox = null;
  function renderMain() {
    root.textContent = '';
    root.appendChild(el('div', {class: 'topbar'}, [
      el('div', {class: 't', text: C.title || ''}),
      el('div', {class: 'who', id: 'who', text: S.member.researcher ? S.member.label + ' · 시험 모드(저장되지 않음)' : S.member.name + ' 위원님'}),
      el('button', {type: 'button', id: 'btn-logout', text: '로그아웃', onclick: logout})
    ]));
    navBox = el('nav', {class: 'nav', 'aria-label': '안건 목차'});
    mainBox = el('main', {id: 'main'});
    root.appendChild(el('div', {class: 'layout'}, [navBox, mainBox]));
    renderNav();
    renderView();
  }

  function markFor(st) {
    return st === 'saved' ? ['saved', '저장'] : (st === 'draft' ? ['draft', '미저장'] : ['', '미입력']);
  }
  function renderNav() {
    if (!navBox) return;
    navBox.textContent = '';
    navBox.appendChild(el('h3', {text: '안건 목차'}));
    S.agendas.forEach(function (a) {
      var m = markFor(status(a.id));
      navBox.appendChild(el('button', {type: 'button', class: S.cur === a.id ? 'cur' : '', 'data-nav': a.id, onclick: function () { go(a.id); }}, [
        el('span', {class: 'mk ' + m[0], text: m[1]}),
        el('span', {class: 'full', text: a.title}),
        el('span', {class: 'sh', text: a.short})
      ]));
    });
    navBox.appendChild(el('h3', {text: '전체 보기'}));
    [['shared', '다른 위원 의견 보기', '위원 의견'], ['status', '제출 현황', '제출 현황']].forEach(function (x) {
      navBox.appendChild(el('button', {type: 'button', class: S.cur === x[0] ? 'cur' : '', 'data-nav': x[0], onclick: function () { go(x[0]); }}, [
        el('span', {class: 'full', text: x[1]}), el('span', {class: 'sh', text: x[2]})
      ]));
    });
  }
  function go(id) {
    S.cur = id; renderNav(); renderView();
    try { window.scrollTo(0, 0); } catch (e) { /* 무시 */ }
  }
  function renderView() {
    mainBox.textContent = '';
    if (S.cur === 'shared') return renderShared();
    if (S.cur === 'status') return renderStatus();
    var a = agendaOf(S.cur);
    if (a) renderAgenda(a);
  }

  /* ---------- 안건 화면 ---------- */
  function cellNode(items) {
    if (items.length === 1) return document.createTextNode(items[0]);
    var ul = el('ul'); items.forEach(function (t) { ul.appendChild(el('li', {text: t})); }); return ul;
  }
  function renderBlocks(a, box) {
    a.blocks.forEach(function (b) {
      if (b.table) {
        var t = el('table', {class: 't'});
        var tr = el('tr'); b.table.head.forEach(function (h) { tr.appendChild(el('th', {text: h})); });
        t.appendChild(el('thead', null, [tr]));
        var tb = el('tbody');
        b.table.rows.forEach(function (r) {
          var row = el('tr');
          r.forEach(function (c, i) { var td = el('td', {'data-label': b.table.head[i]}); td.appendChild(cellNode(c)); row.appendChild(td); });
          tb.appendChild(row);
        });
        t.appendChild(tb); box.appendChild(t);
      } else {
        var ul = el('ul');
        b.items.forEach(function (t2) { ul.appendChild(el('li', {text: t2})); });
        box.appendChild(el('div', {class: 'blk'}, [el('div', {class: 'lb', text: b.label}), b.items.length === 1 ? el('p', {text: b.items[0]}) : ul]));
      }
    });
  }

  function renderAgenda(a) {
    var ans = S.answers[a.id];
    var card = el('section', {class: 'card', 'data-agenda': a.id});
    card.appendChild(el('span', {class: 'tag', text: a.tag}));
    card.appendChild(el('h2', {text: a.title}));
    renderBlocks(a, card);
    var sc = S.second[a.id];
    if (sc) {
      var box = el('div', {class: 'second', id: 'second-' + a.id}, [el('div', {class: 'lb', text: '위원님의 2차 선택'})]);
      if (sc.choices && sc.choices.length) {
        var ul = el('ul'); sc.choices.forEach(function (c) { ul.appendChild(el('li', {text: c})); }); box.appendChild(ul);
      } else box.appendChild(el('p', {class: 'small', text: '2차 설문에 응답하지 않으셨습니다.'}));
      if (sc.comment) box.appendChild(el('p', {class: 'small nl', text: '기재하신 의견: ' + sc.comment}));
      card.appendChild(box);
    }
    var fs = el('fieldset', {class: 'inputbox', 'data-input': a.id});
    fs.appendChild(el('legend', {text: '의견 입력'}));
    var onChange = function () { persistDraft(a.id); renderNav(); setMsg(card, '', ''); };
    if (a.mode === 'agreement') {
      [['none', '이견 없음'], ['yes', '이견 있음']].forEach(function (o) {
        fs.appendChild(radio(a.id + '_m', o[0], o[1], ans.sel.mode === o[0], function () { ans.sel.mode = o[0]; onChange(); }));
      });
      fs.appendChild(el('label', {class: 'fl', for: 'f-items', text: '이견이 있는 문항(예: 문8, 문18)'}));
      var it = el('input', {type: 'text', id: 'f-items', maxlength: '200', value: ans.sel.items || ''});
      it.addEventListener('input', function () { ans.sel.items = it.value; onChange(); });
      fs.appendChild(it);
    } else if (a.mode === 'confirm') {
      [['agree', '다수 의견 채택에 동의'], ['dissent', '이견 있음']].forEach(function (o) {
        fs.appendChild(radio(a.id + '_m', o[0], o[1], ans.sel.mode === o[0], function () { ans.sel.mode = o[0]; onChange(); }));
      });
    } else {
      a.groups.forEach(function (g) {
        fs.appendChild(el('span', {class: 'gl', text: g.label}));
        g.options.forEach(function (o) {
          if (g.type === 'radio') {
            fs.appendChild(radio(a.id + '_' + g.id, o[0], o[1], (ans.sel.g || {})[g.id] === o[0], function () { ans.sel.g = ans.sel.g || {}; ans.sel.g[g.id] = o[0]; onChange(); }));
          } else {
            var cur = (ans.sel.g || {})[g.id] || [];
            fs.appendChild(check(a.id + '_' + g.id, o[0], o[1], cur.indexOf(o[0]) >= 0, function (on) {
              ans.sel.g = ans.sel.g || {};
              var arr = (ans.sel.g[g.id] || []).filter(function (x) { return x !== o[0]; });
              if (on) arr.push(o[0]);
              ans.sel.g[g.id] = arr; onChange();
            }));
          }
        });
      });
      fs.appendChild(el('span', {class: 'gl', text: '연구진 검토 의견'}));
      fs.appendChild(check(a.id + '_agree', 'agree', '연구진 검토 의견에 동의', !!ans.sel.agree, function (on) { ans.sel.agree = on; onChange(); }));
    }
    fs.appendChild(el('label', {class: 'fl', for: 'f-op', text: '의견(선택 사항, 5,000자 이내)'}));
    var ta = el('textarea', {id: 'f-op', maxlength: '5000'}); ta.value = ans.opinion || '';
    ta.addEventListener('input', function () { ans.opinion = ta.value; onChange(); });
    fs.appendChild(ta);
    card.appendChild(fs);
    var btn = el('button', {type: 'button', class: 'primary', id: 'btn-save', text: S.closed ? '입력이 마감되었습니다' : '저장', disabled: S.closed});
    btn.addEventListener('click', function () { saveOne(a.id, card, btn); });
    var tip = el('span', {class: 'small', text: '입력하신 내용은 이 기기에 임시 저장되며, 「저장」을 눌러야 서버에 제출됩니다.'});
    card.appendChild(el('div', {class: 'actions'}, [btn, tip]));
    card.appendChild(el('div', {class: 'msg', id: 'savemsg', role: 'status', hidden: true}));
    var idx = S.agendas.indexOf(a);
    var nav2 = el('div', {class: 'actions'});
    if (idx > 0) nav2.appendChild(el('button', {type: 'button', class: 'ghost', text: '이전 안건', onclick: function () { go(S.agendas[idx - 1].id); }}));
    nav2.appendChild(el('button', {type: 'button', class: 'ghost', text: idx < S.agendas.length - 1 ? '다음 안건' : '제출 현황', onclick: function () { go(idx < S.agendas.length - 1 ? S.agendas[idx + 1].id : 'status'); }}));
    card.appendChild(nav2);
    mainBox.appendChild(card);
  }
  function radio(name, val, text, checked, fn) {
    var i = el('input', {type: 'radio', name: name, value: val, checked: checked});
    i.addEventListener('change', function () { if (i.checked) fn(); });
    return el('label', {class: 'opt'}, [i, el('span', {text: text})]);
  }
  function check(name, val, text, checked, fn) {
    var i = el('input', {type: 'checkbox', name: name, value: val, checked: checked});
    i.addEventListener('change', function () { fn(i.checked); });
    return el('label', {class: 'opt'}, [i, el('span', {text: text})]);
  }
  function setMsg(card, kind, text) {
    var m = card.querySelector('#savemsg'); if (!m) return;
    m.className = 'msg' + (kind ? ' ' + kind : ''); m.textContent = text; m.hidden = !text;
  }

  function onSaved(ids, updated) {
    ids.forEach(function (aid) {
      S.saved[aid] = {sel: JSON.parse(JSON.stringify(S.answers[aid].sel)), opinion: S.answers[aid].opinion, updated: (updated && updated[aid]) || new Date().toISOString()};
      clearDraft(aid);
    });
  }
  var TEST_SAVE = '연구진 시험 계정이므로 서버에 저장하지 않았습니다(저장 동작만 확인).';
  function failText(res) {
    if (res.error === 'closed') return res.message || '입력이 마감되어 저장할 수 없습니다.';
    if (res.error === 'network') return FAIL_SAVE + ' 입력하신 내용은 이 기기에 임시 저장되어 있습니다.' + (C.contactEmail ? ' (메일: ' + C.contactEmail + ')' : '');
    return (res.message || '') + ' ' + FAIL_SAVE;
  }
  function saveOne(aid, card, btn) {
    if (S.busy || S.closed) return;
    S.busy = true; btn.disabled = true; setMsg(card, 'warn', '저장 중입니다.');
    var ans = S.answers[aid];
    api({action: 'save', name: S.name, code: S.code, items: [{agendaId: aid, sel: ans.sel, opinion: ans.opinion || ''}]}).then(function (res) {
      S.busy = false; btn.disabled = S.closed;
      if (res.ok) {
        onSaved([aid], res.updated); renderNav();
        setMsg(card, 'ok', res.test ? TEST_SAVE : '저장되었습니다(' + fmtTime(res.updated && res.updated[aid]) + ').');
      } else {
        if (res.error === 'closed') { S.closed = true; btn.disabled = true; btn.textContent = '입력이 마감되었습니다'; }
        setMsg(card, 'err', failText(res));
      }
    });
  }

  /* ---------- 제출 현황 ---------- */
  function renderStatus() {
    var card = el('section', {class: 'card', id: 'status-card'});
    card.appendChild(el('h2', {text: '제출 현황'}));
    card.appendChild(el('p', {class: 'small', text: '안건별 입력 여부입니다. 「저장」은 서버에 제출된 상태, 「미저장」은 이 기기에만 입력된 상태입니다.'}));
    var t = el('table', {class: 't'});
    var hr = el('tr'); ['안건', '입력 여부', '내용'].forEach(function (h) { hr.appendChild(el('th', {text: h})); });
    t.appendChild(el('thead', null, [hr]));
    var tb = el('tbody'), nSaved = 0, nDraft = 0;
    S.agendas.forEach(function (a) {
      var st = status(a.id), m = markFor(st);
      if (st === 'saved') nSaved++; else if (st === 'draft') nDraft++;
      var row = el('tr', {class: 'statusrow', 'data-status-row': a.id}, [
        el('td', {'data-label': '안건'}, [el('button', {type: 'button', class: 'ghost', text: a.title, onclick: function () { go(a.id); }})]),
        el('td', {class: 's-' + m[0], 'data-label': '입력 여부', text: st === 'saved' ? '저장됨' : (st === 'draft' ? '입력했으나 저장하지 않음' : '미입력')}),
        el('td', {'data-label': '내용', text: selText(a, S.answers[a.id].sel) || '-'})
      ]);
      tb.appendChild(row);
    });
    t.appendChild(tb); card.appendChild(t);
    card.appendChild(el('p', {id: 'status-sum', text: '전체 ' + S.agendas.length + '개 안건 중 저장 ' + nSaved + '개, 미저장 ' + nDraft + '개, 미입력 ' + (S.agendas.length - nSaved - nDraft) + '개'}));
    var btn = el('button', {type: 'button', class: 'primary', id: 'btn-saveall', text: S.closed ? '입력이 마감되었습니다' : '미저장 안건 모두 저장', disabled: S.closed || nDraft === 0});
    var msg = el('div', {class: 'msg', id: 'savemsg', role: 'status', hidden: true});
    btn.addEventListener('click', function () {
      if (S.busy) return;
      var ids = S.agendas.filter(function (a) { return status(a.id) === 'draft' && isFilled(a, S.answers[a.id]); }).map(function (a) { return a.id; });
      if (!ids.length) return;
      S.busy = true; btn.disabled = true; setMsg(card, 'warn', '저장 중입니다.');
      api({action: 'save', name: S.name, code: S.code, items: ids.map(function (id) { return {agendaId: id, sel: S.answers[id].sel, opinion: S.answers[id].opinion || ''}; })}).then(function (res) {
        S.busy = false;
        if (res.ok) { onSaved(ids, res.updated); renderNav(); renderView(); var c2 = mainBox.querySelector('#status-card'); setMsg(c2, 'ok', res.test ? TEST_SAVE : ids.length + '개 안건을 저장했습니다.'); }
        else { btn.disabled = false; if (res.error === 'closed') S.closed = true; setMsg(card, 'err', failText(res)); }
      });
    });
    card.appendChild(el('div', {class: 'actions'}, [btn]));
    card.appendChild(msg);
    mainBox.appendChild(card);
  }

  /* ---------- 다른 위원 의견 ---------- */
  function renderShared() {
    var card = el('section', {class: 'card', id: 'shared-card'}, [el('h2', {text: '다른 위원 의견 보기'}),
      el('p', {class: 'small', text: '위원별 의견을 성명과 함께 표시합니다. 본인 의견은 「(나)」로 표시합니다. 저장된 의견만 보입니다.'})]);
    mainBox.appendChild(card);
    var loading = el('p', {text: '불러오는 중입니다.'}); card.appendChild(loading);
    api({action: 'shared', name: S.name, code: S.code}).then(function (res) {
      if (S.cur !== 'shared') return;
      loading.remove();
      if (!res.ok) {
        card.appendChild(el('div', {class: 'msg err', role: 'alert', text: res.error === 'network' ? '서버에 연결하지 못해 다른 위원 의견을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주십시오.' : (res.message || '불러오지 못했습니다.')}));
        card.appendChild(el('div', {class: 'actions'}, [el('button', {type: 'button', class: 'ghost', text: '다시 불러오기', onclick: renderViewAgain})]));
        return;
      }
      card.appendChild(el('div', {class: 'actions'}, [el('button', {type: 'button', class: 'ghost', id: 'btn-reload', text: '새로 고침', onclick: renderViewAgain})]));
      S.agendas.forEach(function (a) { card.appendChild(sharedSection(a, (res.shared || {})[a.id] || [], res.total || 9)); });
    });
  }
  function renderViewAgain() { renderView(); }
  function count(list, fn) { var n = 0; list.forEach(function (e) { if (fn(e.sel || {})) n++; }); return n; }
  function sharedSection(a, list, total) {
    var sec = el('div', {class: 'sharedsec', 'data-shared': a.id});
    sec.appendChild(el('h3', {text: a.title}));
    sec.appendChild(el('p', {class: 'small', text: '입력한 위원 ' + list.length + '명 / 전체 ' + total + '명'}));
    var agg = el('div', {class: 'agg'});
    if (a.mode === 'agreement') {
      agg.appendChild(el('span', {text: '이견 없음 ' + count(list, function (s) { return s.mode === 'none'; }) + '명'}));
      agg.appendChild(el('span', {text: '이견 있음 ' + count(list, function (s) { return s.mode === 'yes'; }) + '명'}));
    } else if (a.mode === 'confirm') {
      agg.appendChild(el('span', {text: '동의 ' + count(list, function (s) { return s.mode === 'agree'; }) + '명'}));
      agg.appendChild(el('span', {text: '이견 있음 ' + count(list, function (s) { return s.mode === 'dissent'; }) + '명'}));
    } else {
      a.groups.forEach(function (g) {
        g.options.forEach(function (o) {
          var n = count(list, function (s) { var v = (s.g || {})[g.id]; return Array.isArray(v) ? v.indexOf(o[0]) >= 0 : v === o[0]; });
          agg.appendChild(el('span', {text: o[1] + ' ' + n + '명'}));
        });
      });
      agg.appendChild(el('span', {text: '연구진 검토 의견에 동의 ' + count(list, function (s) { return !!s.agree; }) + '명'}));
    }
    sec.appendChild(agg);
    list.forEach(function (e) {
      var head = el('div', {class: 'who'}, [e.label]);
      if (e.me) head.appendChild(el('span', {class: 'me-mk', text: '(나)'}));
      if (e.after) head.appendChild(el('span', {class: 'me-mk', text: '11.30. 12시 이후 수정'}));
      var ent = el('div', {class: 'ent' + (e.me ? ' me' : ''), 'data-entry': e.label}, [head]);
      var st = selText(a, e.sel);
      ent.appendChild(el('div', {text: st || '선택 없음'}));
      if (e.opinion) ent.appendChild(el('div', {class: 'nl small', text: '의견: ' + e.opinion}));
      sec.appendChild(ent);
    });
    if (!list.length) sec.appendChild(el('p', {class: 'small', text: '아직 저장된 의견이 없습니다.'}));
    return sec;
  }

  /* ---------- 시작 ---------- */
  var cred = null;
  try { cred = JSON.parse(ssGet('sc3_cred') || 'null'); } catch (e) { cred = null; }
  renderLogin();
  if (cred && cred.n) {
    api({action: 'login', name: cred.n, code: cred.c}).then(function (res) {
      if (res.ok) { S.name = cred.n; S.code = cred.c; enter(res); }
      else ssDel('sc3_cred');
    });
  }
})();
