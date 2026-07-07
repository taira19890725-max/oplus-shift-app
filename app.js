(function(){
'use strict';
var h = React.createElement;
var useState = React.useState, useEffect = React.useEffect, useMemo = React.useMemo;

var STORAGE_KEY = 'oplus-shift-manager-v1';

// ---------- Firebase config ----------
// Firebase コンソール(https://console.firebase.google.com) > プロジェクトの設定 >
// 全般 > マイアプリ > SDK の設定と構成 に表示される値をここへ貼り付けてください。
// この値自体は公開されて問題ありません(Firestore のセキュリティルールで保護します)。
var FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// 共通PIN。アプリを開ける人を軽く制限するためだけの簡易ロックです。
// (Firestore への読み書き自体は「匿名ログインした人なら誰でも」許可される設計のため、
//  本格的な機密データの保護にはなりません。URLとPINは関係者以外に共有しないでください)
var APP_PIN = "1234";
var PIN_KEY = 'oplus-pin-unlocked';

var firebaseReady = FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";
var db = null;
if (firebaseReady && window.firebase){
  firebase.initializeApp(FIREBASE_CONFIG);
  try{ firebase.firestore().enablePersistence({synchronizeTabs:true}).catch(function(){}); }catch(e){}
  db = firebase.firestore();
}

var SHIFT_TYPES = {
  early: {key:'early', label:'早番', time:'9:00-15:00', hours:6, cls:'day'},
  late:  {key:'late',  label:'遅番', time:'13:00-19:00', hours:6, cls:'dusk'},
  night: {key:'night', label:'夜勤', time:'19:00-翌2:00', hours:7, cls:'night'},
  off:   {key:'off',   label:'休',   time:'', hours:0, cls:'off'}
};
var SHIFT_ORDER = ['early','late','night','off'];
var WORK_SHIFTS = ['early','late','night'];
var DOW = ['月','火','水','木','金','土','日'];

function pad2(n){ return n<10 ? '0'+n : ''+n; }
function toISO(d){ return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
function fromISO(s){ var p=s.split('-'); return new Date(parseInt(p[0],10), parseInt(p[1],10)-1, parseInt(p[2],10)); }
function addDays(d,n){ var r=new Date(d); r.setDate(r.getDate()+n); return r; }
function getMonday(d){ var r=new Date(d); var day=r.getDay(); var diff=(day===0?-6:1-day); return addDays(r,diff); }
function fmtMD(d){ return (d.getMonth()+1)+'/'+d.getDate(); }
function shiftKey(empId, dateISO){ return empId+'|'+dateISO; }
function ym(d){ return d.getFullYear()+'-'+pad2(d.getMonth()+1); }

function seedData(){
  var sites = [
    {id:'s1', name:'渋谷店', required:{early:2, late:2, night:1}},
    {id:'s2', name:'新宿店', required:{early:3, late:2, night:1}},
    {id:'s3', name:'池袋店', required:{early:2, late:1, night:1}}
  ];
  var employees = [
    {id:'e1', name:'佐藤 陽菜', siteId:'s1', type:'正社員', wage:1400},
    {id:'e2', name:'鈴木 大輔', siteId:'s1', type:'正社員', wage:1400},
    {id:'e3', name:'高橋 美咲', siteId:'s1', type:'パート', wage:1150},
    {id:'e4', name:'田中 蓮',   siteId:'s1', type:'アルバイト', wage:1100},
    {id:'e5', name:'伊藤 さくら', siteId:'s1', type:'パート', wage:1150},
    {id:'e6', name:'渡辺 翔太', siteId:'s1', type:'アルバイト', wage:1100},
    {id:'e7', name:'山本 花子', siteId:'s2', type:'正社員', wage:1420},
    {id:'e8', name:'中村 健太', siteId:'s2', type:'正社員', wage:1420},
    {id:'e9', name:'小林 愛',   siteId:'s2', type:'パート', wage:1180},
    {id:'e10', name:'加藤 悠斗', siteId:'s2', type:'アルバイト', wage:1120},
    {id:'e11', name:'吉田 楓',   siteId:'s2', type:'パート', wage:1180},
    {id:'e12', name:'山田 直樹', siteId:'s2', type:'正社員', wage:1420},
    {id:'e13', name:'佐々木 蒼', siteId:'s3', type:'正社員', wage:1380},
    {id:'e14', name:'山口 結衣', siteId:'s3', type:'パート', wage:1140},
    {id:'e15', name:'松本 亮',   siteId:'s3', type:'アルバイト', wage:1090},
    {id:'e16', name:'井上 千夏', siteId:'s3', type:'パート', wage:1140},
    {id:'e17', name:'木村 拓海', siteId:'s3', type:'アルバイト', wage:1090},
    {id:'e18', name:'林 美月',   siteId:'s3', type:'正社員', wage:1380}
  ];

  var pattern = {
    e1:['early','early','off','late','early','off','late'],
    e2:['late','off','early','early','off','night','early'],
    e3:['off','early','early','off','early','late','off'],
    e4:['night','off','late','night','off','early','off'],
    e5:['early','late','off','early','off','early','late'],
    e6:['off','night','off','late','early','off','night'],
    e7:['early','early','late','off','early','off','late'],
    e8:['late','early','off','late','off','early','early'],
    e9:['off','late','early','off','late','early','off'],
    e10:['night','off','early','off','night','off','early'],
    e11:['early','off','late','early','off','late','off'],
    e12:['late','late','off','early','early','off','night'],
    e13:['early','off','late','early','off','night','early'],
    e14:['off','early','early','off','late','off','early'],
    e15:['night','off','off','late','early','off','late'],
    e16:['early','late','off','early','off','early','off'],
    e17:['off','night','early','off','late','off','night'],
    e18:['early','off','late','early','late','off','off']
  };

  var monday = getMonday(new Date());
  var shifts = {};
  for (var w=0; w<2; w++){
    for (var i=0;i<employees.length;i++){
      var emp = employees[i];
      var pat = pattern[emp.id];
      for (var d=0; d<7; d++){
        var date = addDays(monday, w*7+d);
        var iso = toISO(date);
        shifts[shiftKey(emp.id, iso)] = pat[d];
      }
    }
  }
  // deliberate rest-interval issue for demo: e2 night on day3 then early on day4 already in pattern (index2 night, index3 early? check e2 pattern index for wed 'early' after tue 'off' - adjust to create a real violation)
  var wedISO = toISO(addDays(monday,2));
  var thuISO = toISO(addDays(monday,3));
  shifts[shiftKey('e10', wedISO)] = 'night';
  shifts[shiftKey('e10', thuISO)] = 'early';

  var leaveRequests = [
    {id:'lr1', employeeId:'e5', date: toISO(addDays(monday,8)), status:'申請中', reason:'通院のため', requestedAt: toISO(new Date())},
    {id:'lr2', employeeId:'e14', date: toISO(addDays(monday,10)), status:'申請中', reason:'家族の用事', requestedAt: toISO(new Date())},
    {id:'lr3', employeeId:'e3', date: toISO(addDays(monday,-2)), status:'承認', reason:'私用', requestedAt: toISO(addDays(new Date(),-5))}
  ];

  return {employees:employees, sites:sites, shifts:shifts, leaveRequests:leaveRequests};
}

function loadData(){
  try{
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  }catch(e){}
  var seeded = seedData();
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded)); }catch(e){}
  return seeded;
}

function saveData(data){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }catch(e){}
}

function computeSiteStaffing(site, dateISO, shifts, employees){
  var counts = {early:0, late:0, night:0};
  employees.forEach(function(emp){
    if (emp.siteId !== site.id) return;
    var v = shifts[shiftKey(emp.id, dateISO)];
    if (v && counts.hasOwnProperty(v)) counts[v]++;
  });
  return counts;
}

function staffingStatus(counts, required){
  var worst = 'ok';
  WORK_SHIFTS.forEach(function(k){
    var req = required[k]||0;
    var have = counts[k]||0;
    if (have < req){
      var deficit = req-have;
      var level = deficit >= 2 ? 'danger' : 'warn';
      if (level==='danger') worst='danger';
      else if (worst!=='danger') worst='warn';
    }
  });
  return worst;
}

function hasRestViolation(employeeId, dateISO, shifts){
  var prevISO = toISO(addDays(fromISO(dateISO), -1));
  var prev = shifts[shiftKey(employeeId, prevISO)];
  var cur = shifts[shiftKey(employeeId, dateISO)];
  return prev === 'night' && cur === 'early';
}

function useOplusData(){
  var st = useState(firebaseReady ? null : loadData());
  var data = st[0], setDataState = st[1];
  var stSyncing = useState(firebaseReady);
  var syncing = stSyncing[0], setSyncing = stSyncing[1];
  var stError = useState(null);
  var syncError = stError[0], setSyncError = stError[1];

  useEffect(function(){
    if (!firebaseReady) return;
    var unsubAuth = firebase.auth().onAuthStateChanged(function(user){
      if (!user){
        firebase.auth().signInAnonymously().catch(function(err){ setSyncError(err.message); });
        return;
      }
      var docRef = db.collection('oplus').doc('shared-data');
      var unsubSnap = docRef.onSnapshot(function(snap){
        setSyncing(false);
        if (snap.exists){
          setDataState(snap.data());
        } else {
          var seeded = seedData();
          docRef.set(seeded);
        }
      }, function(err){ setSyncing(false); setSyncError(err.message); });
      unsubAuth._unsubSnap = unsubSnap;
    });
    return function(){
      if (unsubAuth._unsubSnap) unsubAuth._unsubSnap();
      unsubAuth();
    };
  }, []);

  useEffect(function(){
    if (!firebaseReady && data) saveData(data);
  }, [data]);

  function setData(updater){
    setDataState(function(prev){
      var next = typeof updater === 'function' ? updater(prev) : updater;
      if (firebaseReady){
        db.collection('oplus').doc('shared-data').set(next).catch(function(err){ setSyncError(err.message); });
      }
      return next;
    });
  }

  return [data, setData, {syncing:syncing, syncError:syncError, cloudSync:firebaseReady}];
}

var SIDEBAR_KEY = 'oplus-sidebar-collapsed';

function useToasts(){
  var st = useState([]);
  var toasts = st[0], setToasts = st[1];
  function notify(message, tone){
    var id = Date.now()+Math.random();
    setToasts(function(list){ return list.concat([{id:id, message:message, tone:tone||'ok'}]); });
    setTimeout(function(){
      setToasts(function(list){ return list.filter(function(t){ return t.id!==id; }); });
    }, 2600);
  }
  return [toasts, notify];
}

function ToastStack(props){
  return h('div', {className:'toast-stack'}, props.toasts.map(function(t){
    return h('div', {key:t.id, className:'toast '+t.tone},
      h(Icon, {name: t.tone==='danger' ? 'close' : 'check', size:14}), t.message);
  }));
}

var ICONS = {
  dashboard:[['rect',{x:3,y:3,width:7,height:7,rx:1.5}],['rect',{x:14,y:3,width:7,height:7,rx:1.5}],['rect',{x:14,y:14,width:7,height:7,rx:1.5}],['rect',{x:3,y:14,width:7,height:7,rx:1.5}]],
  schedule:[['rect',{x:3,y:4,width:18,height:17,rx:2}],['line',{x1:16,y1:2,x2:16,y2:6}],['line',{x1:8,y1:2,x2:8,y2:6}],['line',{x1:3,y1:10,x2:21,y2:10}]],
  employees:[['path',{d:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'}],['circle',{cx:9,cy:7,r:4}],['path',{d:'M22 21v-2a4 4 0 0 0-3-3.87'}],['path',{d:'M16 3.13a4 4 0 0 1 0 7.75'}]],
  leave:[['rect',{x:4,y:4,width:16,height:17,rx:2}],['path',{d:'M8 2v4'}],['path',{d:'M16 2v4'}],['path',{d:'M4 10h16'}],['path',{d:'M9 15l2 2 4-4'}]],
  reports:[['line',{x1:4,y1:20,x2:4,y2:12}],['line',{x1:10,y1:20,x2:10,y2:6}],['line',{x1:16,y1:20,x2:16,y2:14}],['line',{x1:4,y1:20,x2:20,y2:20}]],
  chevronLeft:[['polyline',{points:'15 18 9 12 15 6'}]],
  chevronRight:[['polyline',{points:'9 18 15 12 9 6'}]],
  plus:[['line',{x1:12,y1:5,x2:12,y2:19}],['line',{x1:5,y1:12,x2:19,y2:12}]],
  pencil:[['path',{d:'M12 20h9'}],['path',{d:'M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z'}]],
  trash:[['polyline',{points:'3 6 5 6 21 6'}],['path',{d:'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'}],['line',{x1:10,y1:11,x2:10,y2:17}],['line',{x1:14,y1:11,x2:14,y2:17}]],
  close:[['line',{x1:18,y1:6,x2:6,y2:18}],['line',{x1:6,y1:6,x2:18,y2:18}]],
  check:[['polyline',{points:'20 6 9 17 4 12'}]],
  search:[['circle',{cx:11,cy:11,r:8}],['line',{x1:21,y1:21,x2:16.65,y2:16.65}]],
  download:[['path',{d:'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'}],['polyline',{points:'7 10 12 15 17 10'}],['line',{x1:12,y1:15,x2:12,y2:3}]]
};

function Icon(props){
  var parts = ICONS[props.name] || [];
  var size = props.size || 18;
  return h('svg', {
    className:'icon', width:size, height:size, viewBox:'0 0 24 24', fill:'none',
    stroke:'currentColor', strokeWidth:1.8, strokeLinecap:'round', strokeLinejoin:'round',
    'aria-hidden':'true', style:props.style
  }, parts.map(function(p,i){ return h(p[0], Object.assign({key:i}, p[1])); }));
}

function PinGate(props){
  var stPin = useState('');
  var pin = stPin[0], setPin = stPin[1];
  var stErr = useState(false);
  var err = stErr[0], setErr = stErr[1];

  function submit(e){
    e.preventDefault();
    if (pin === APP_PIN){
      try{ localStorage.setItem(PIN_KEY, '1'); }catch(ex){}
      props.onUnlock();
    } else {
      setErr(true);
    }
  }

  return h('div', {className:'pin-gate'},
    h('form', {className:'pin-card', onSubmit:submit},
      h('div', {className:'pin-logo'},
        h('svg', {width:40, height:40, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:1.8, strokeLinecap:'round', strokeLinejoin:'round'},
          h('circle', {cx:12, cy:12, r:8}), h('circle', {cx:12, cy:12, r:3.2})
        )
      ),
      h('h1', null, 'Oplus'),
      h('p', null, 'シフト管理を開くにはPINコードを入力してください'),
      h('input', {
        className:'input pin-input', type:'password', inputMode:'numeric', autoFocus:true,
        value:pin, onChange:function(e){ setPin(e.target.value); setErr(false); }
      }),
      err && h('div', {className:'pin-error'}, 'PINが違います。もう一度お試しください'),
      h('button', {className:'btn primary', type:'submit'}, '開く')
    )
  );
}

function SyncBadge(props){
  if (!props.cloudSync) return null;
  var label = props.syncError ? '同期エラー' : (props.syncing ? '同期中…' : 'クラウド同期済み');
  var tone = props.syncError ? 'danger' : (props.syncing ? 'warn' : 'ok');
  return h('div', {className:'sync-badge '+tone, title:props.syncError||''},
    h('span', {className:'sync-dot'}), label);
}

function Sidebar(props){
  var items = [
    {id:'dashboard', label:'ダッシュボード', icon:'dashboard'},
    {id:'schedule', label:'シフト表', icon:'schedule'},
    {id:'employees', label:'従業員', icon:'employees'},
    {id:'leave', label:'休み希望', icon:'leave'},
    {id:'reports', label:'集計', icon:'reports'}
  ];
  return h('nav', {className:'sidebar'},
    h('button', {className:'sidebar-toggle', onClick:props.onToggle, title: props.collapsed ? 'サイドバーを開く' : 'サイドバーを閉じる'},
      h(Icon, {name: props.collapsed ? 'chevronRight' : 'chevronLeft', size:14})
    ),
    h('div', {className:'brand'}, props.collapsed ? 'O' : 'Oplus', h('small', null, 'SHIFT MANAGEMENT')),
    items.map(function(it){
      return h('button', {
        key:it.id,
        className:'nav-btn' + (props.view===it.id ? ' active':''),
        title:it.label,
        onClick:function(){ props.setView(it.id); }
      }, h('span', {className:'nav-icon'}, h(Icon, {name:it.icon, size:18})), h('span', {className:'nav-label'}, it.label));
    })
  );
}

function Pill(props){
  return h('span', {className:'pill '+props.tone}, props.children);
}

function ShiftTag(props){
  var t = SHIFT_TYPES[props.type];
  if (!t) return null;
  return h('span', {className:'tag '+t.cls}, t.label);
}

function KpiChip(props){
  return h('div', {className:'kpi-chip '+(props.tone||'')}, h('b', null, props.value), ' ', props.label);
}

// ---------- Dashboard ----------
function DashboardView(props){
  var data = props.data;
  var stDate = useState(toISO(new Date()));
  var dateISO = stDate[0], setDateISO = stDate[1];
  var date = fromISO(dateISO);

  var siteInfo = data.sites.map(function(site){
    var counts = computeSiteStaffing(site, dateISO, data.shifts, data.employees);
    var status = staffingStatus(counts, site.required);
    return {site:site, counts:counts, status:status};
  });

  var totalDanger = siteInfo.filter(function(s){return s.status==='danger';}).length;
  var totalWarn = siteInfo.filter(function(s){return s.status==='warn';}).length;
  var pendingLeave = data.leaveRequests.filter(function(r){return r.status==='申請中';}).length;

  var restViolations = [];
  data.employees.forEach(function(emp){
    if (hasRestViolation(emp.id, dateISO, data.shifts)){
      restViolations.push(emp);
    }
  });

  var alerts = [];
  siteInfo.forEach(function(s){
    if (s.status !== 'ok'){
      WORK_SHIFTS.forEach(function(k){
        var req = s.site.required[k]||0, have=s.counts[k]||0;
        if (have<req){
          alerts.push({tone:s.status, text: s.site.name+'「'+SHIFT_TYPES[k].label+'」が'+(req-have)+'名不足しています（必要'+req+'名 / 配置'+have+'名）'});
        }
      });
    }
  });
  restViolations.forEach(function(emp){
    alerts.push({tone:'danger', text: emp.name+'は前日「夜勤」明けに「早番」が割り当てられています（休息時間不足）', meta:'シフト表で確認・調整してください'});
  });

  return h('div', null,
    h('div', {className:'page-head'},
      h('div', null,
        h('h1', {className:'page-title'}, '現場別 稼働状況'),
        h('div', {className:'page-sub'}, '選択した日の各現場の充足状況を一覧で確認できます')
      ),
      h('div', {className:'field'},
        h('label', null, '確認する日付'),
        h('input', {type:'date', className:'input', value:dateISO, onChange:function(e){ setDateISO(e.target.value); }})
      )
    ),
    h('div', {className:'kpi-row'},
      h(KpiChip, {value: fmtMD(date)+'('+DOW[(date.getDay()+6)%7]+')', label:'表示日'}),
      h(KpiChip, {value: totalDanger, label:'重大な人員不足', tone: totalDanger>0?'danger':'ok'}),
      h(KpiChip, {value: totalWarn, label:'要注意', tone: totalWarn>0?'warn':'ok'}),
      h(KpiChip, {value: pendingLeave, label:'休み希望 承認待ち', tone: pendingLeave>0?'warn':'ok'})
    ),
    h('div', {className:'site-grid', style:{marginTop:18}},
      siteInfo.map(function(s){
        return h('div', {key:s.site.id, className:'card site-card'},
          h('div', {className:'site-card-head'},
            h('h3', null, s.site.name),
            h(Pill, {tone:s.status}, s.status==='ok'?'順調':(s.status==='warn'?'要確認':'不足'))
          ),
          WORK_SHIFTS.map(function(k){
            var req = s.site.required[k]||0, have=s.counts[k]||0;
            var tone = have<req ? (req-have>=2?'danger':'warn') : 'ok';
            return h('div', {key:k, className:'shift-row'},
              h(ShiftTag, {type:k}),
              h('span', {className:'count', style:{color: tone==='ok'?'var(--ink-muted)': tone==='warn'?'var(--warn)':'var(--danger)'}}, have+' / '+req+'名')
            );
          })
        );
      })
    ),
    h('div', {className:'card card-pad', style:{marginTop:18}},
      h('h3', {style:{fontSize:15, marginBottom:12}}, 'アラート'),
      alerts.length===0
        ? h('div', {className:'empty-note'}, '現在、対応が必要なアラートはありません')
        : h('div', {className:'alert-list'}, alerts.map(function(a,i){
            return h('div', {key:i, className:'alert-item '+a.tone},
              h('span', {className:'alert-dot'}),
              h('div', null, h('p', null, a.text), a.meta && h('div', {className:'meta'}, a.meta))
            );
          }))
    )
  );
}

// ---------- Schedule ----------
function ScheduleView(props){
  var data = props.data, setData = props.setData;
  var stSite = useState(data.sites[0].id);
  var siteId = stSite[0], setSiteId = stSite[1];
  var stWeek = useState(getMonday(new Date()));
  var weekStart = stWeek[0], setWeekStart = stWeek[1];

  var site = data.sites.filter(function(s){return s.id===siteId;})[0];
  var emps = data.employees.filter(function(e){return e.siteId===siteId;});
  var days = [];
  for (var i=0;i<7;i++) days.push(addDays(weekStart,i));

  function cycleShift(empId, dateISO){
    var cur = data.shifts[shiftKey(empId,dateISO)] || 'off';
    var idx = SHIFT_ORDER.indexOf(cur);
    var next = SHIFT_ORDER[(idx+1)%SHIFT_ORDER.length];
    var newShifts = Object.assign({}, data.shifts);
    newShifts[shiftKey(empId,dateISO)] = next;
    setData(Object.assign({}, data, {shifts:newShifts}));
  }

  return h('div', null,
    h('div', {className:'page-head'},
      h('div', null,
        h('h1', {className:'page-title'}, 'シフト表'),
        h('div', {className:'page-sub'}, 'セルをクリックするとシフト種別が切り替わります（早番→遅番→夜勤→休）')
      )
    ),
    h('div', {className:'toolbar'},
      h('div', {className:'field'},
        h('label', null, '現場'),
        h('select', {className:'select', value:siteId, onChange:function(e){ setSiteId(e.target.value); }},
          data.sites.map(function(s){ return h('option', {key:s.id, value:s.id}, s.name); })
        )
      ),
      h('div', {className:'week-nav'},
        h('button', {className:'btn sm', onClick:function(){ setWeekStart(addDays(weekStart,-7)); }}, h(Icon,{name:'chevronLeft',size:12}), '前週'),
        h('div', {className:'week-label'}, fmtMD(days[0])+' 〜 '+fmtMD(days[6])),
        h('button', {className:'btn sm', onClick:function(){ setWeekStart(addDays(weekStart,7)); }}, '翌週', h(Icon,{name:'chevronRight',size:12})),
        h('button', {className:'btn sm', onClick:function(){ setWeekStart(getMonday(new Date())); }}, '今週')
      )
    ),
    h('div', {className:'table-scroll'},
      h('table', {className:'grid-table'},
        h('thead', null,
          h('tr', null,
            h('th', {className:'sticky-col'}, '従業員'),
            days.map(function(d){
              var iso = toISO(d);
              var counts = computeSiteStaffing(site, iso, data.shifts, data.employees);
              return h('th', {key:iso},
                h('div', {className:'day-head'},
                  h('span', {className:'dow'}, fmtMD(d)+'('+DOW[(d.getDay()+6)%7]+')'),
                  h('div', {className:'staff-mini'},
                    WORK_SHIFTS.map(function(k){
                      var req=site.required[k]||0, have=counts[k]||0;
                      var short = have<req;
                      return h('span', {key:k, style:{
                        background: short ? 'var(--danger-soft)' : 'var(--ok-soft)',
                        color: short ? 'var(--danger)' : 'var(--ok)'
                      }}, SHIFT_TYPES[k].label[0]+have+'/'+req);
                    })
                  )
                )
              );
            })
          )
        ),
        h('tbody', null,
          emps.map(function(emp){
            return h('tr', {key:emp.id},
              h('td', {className:'sticky-col'},
                h('div', {className:'emp-name'}, emp.name),
                h('div', {className:'emp-meta'}, emp.type)
              ),
              days.map(function(d){
                var iso = toISO(d);
                var val = data.shifts[shiftKey(emp.id,iso)] || 'off';
                var violation = hasRestViolation(emp.id, iso, data.shifts);
                return h('td', {key:iso},
                  h('button', {
                    className:'shift-cell-btn',
                    title:'クリックして変更 '+SHIFT_TYPES[val].time,
                    onClick:function(){ cycleShift(emp.id, iso); }
                  },
                    h(ShiftTag, {type:val}),
                    violation && h('span', {className:'warn-flag', title:'休息時間不足'}, '!')
                  )
                );
              })
            );
          })
        )
      )
    ),
    h('div', {className:'legend'},
      SHIFT_ORDER.map(function(k){
        var t = SHIFT_TYPES[k];
        return h('span', {key:k}, h('i', {style:{background:'var(--shift-'+t.cls+', var(--shift-off))'}}), t.label+(t.time?'（'+t.time+'）':''));
      }),
      h('span', null, '! = 前日夜勤明けの早番（休息時間不足の可能性）')
    )
  );
}

// ---------- Employees ----------
function EmployeeModal(props){
  var editing = props.editing;
  var stForm = useState(editing || {name:'', siteId:props.sites[0].id, type:'アルバイト', wage:1100});
  var form = stForm[0], setForm = stForm[1];
  function update(k,v){ setForm(Object.assign({}, form, {[k]:v})); }
  return h('div', {className:'modal-overlay', onClick:function(e){ if(e.target===e.currentTarget) props.onClose(); }},
    h('div', {className:'modal'},
      h('div', {style:{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14}},
        h('h3', {style:{marginBottom:0}}, editing ? '従業員を編集' : '従業員を追加'),
        h('button', {className:'icon-btn', title:'閉じる', onClick:props.onClose}, h(Icon,{name:'close', size:14}))
      ),
      h('div', {className:'form-grid'},
        h('div', {className:'field'}, h('label', null, '氏名'),
          h('input', {className:'input', value:form.name, onChange:function(e){ update('name', e.target.value); }})),
        h('div', {className:'field'}, h('label', null, '所属現場'),
          h('select', {className:'select', value:form.siteId, onChange:function(e){ update('siteId', e.target.value); }},
            props.sites.map(function(s){ return h('option', {key:s.id, value:s.id}, s.name); }))),
        h('div', {className:'field'}, h('label', null, '雇用形態'),
          h('select', {className:'select', value:form.type, onChange:function(e){ update('type', e.target.value); }},
            ['正社員','パート','アルバイト'].map(function(t){ return h('option', {key:t, value:t}, t); }))),
        h('div', {className:'field'}, h('label', null, '時給（円）'),
          h('input', {type:'number', className:'input', value:form.wage, onChange:function(e){ update('wage', parseInt(e.target.value||'0',10)); }}))
      ),
      h('div', {className:'modal-actions'},
        h('button', {className:'btn', onClick:props.onClose}, 'キャンセル'),
        h('button', {className:'btn primary', onClick:function(){
          if (!form.name.trim()) return;
          props.onSave(Object.assign({}, form, {id: form.id || ('e'+Date.now())}));
        }}, h(Icon,{name:'check', size:14}), '保存')
      )
    )
  );
}

function EmployeesView(props){
  var data = props.data, setData = props.setData, notify = props.notify;
  var stModal = useState(null); // null | 'new' | employee object
  var modal = stModal[0], setModal = stModal[1];
  var stQuery = useState('');
  var query = stQuery[0], setQuery = stQuery[1];
  var stSiteFilter = useState('all');
  var siteFilter = stSiteFilter[0], setSiteFilter = stSiteFilter[1];

  function siteName(id){ var s=data.sites.filter(function(x){return x.id===id;})[0]; return s?s.name:'—'; }

  function saveEmployee(emp){
    var exists = data.employees.some(function(e){return e.id===emp.id;});
    var next = exists
      ? data.employees.map(function(e){ return e.id===emp.id ? emp : e; })
      : data.employees.concat([emp]);
    setData(Object.assign({}, data, {employees:next}));
    setModal(null);
    notify(exists ? '従業員情報を更新しました' : '従業員を追加しました', 'ok');
  }
  function removeEmployee(emp){
    setData(Object.assign({}, data, {employees: data.employees.filter(function(e){return e.id!==emp.id;})}));
    notify(emp.name+'を削除しました', 'danger');
  }

  var filtered = data.employees.filter(function(emp){
    if (siteFilter!=='all' && emp.siteId!==siteFilter) return false;
    if (query.trim() && emp.name.indexOf(query.trim())===-1) return false;
    return true;
  });

  return h('div', null,
    h('div', {className:'page-head'},
      h('div', null,
        h('h1', {className:'page-title'}, '従業員管理'),
        h('div', {className:'page-sub'}, data.employees.length+'名が登録されています')
      ),
      h('button', {className:'btn primary', onClick:function(){ setModal('new'); }}, h(Icon,{name:'plus',size:15}), '従業員を追加')
    ),
    h('div', {className:'toolbar'},
      h('div', {className:'field'},
        h('label', null, '検索'),
        h('div', {className:'search-field'},
          h(Icon, {name:'search', size:14}),
          h('input', {className:'input', placeholder:'氏名で検索', value:query, onChange:function(e){ setQuery(e.target.value); }})
        )
      ),
      h('div', {className:'field'},
        h('label', null, '現場で絞り込み'),
        h('select', {className:'select', value:siteFilter, onChange:function(e){ setSiteFilter(e.target.value); }},
          h('option', {value:'all'}, 'すべての現場'),
          data.sites.map(function(s){ return h('option', {key:s.id, value:s.id}, s.name); })
        )
      )
    ),
    h('div', {className:'table-scroll'},
      h('table', {className:'grid-table emp-table'},
        h('thead', null, h('tr', null,
          h('th', null, '氏名'), h('th', null, '現場'), h('th', null, '雇用形態'), h('th', null, '時給'), h('th', null, '')
        )),
        h('tbody', null,
          filtered.length===0
            ? h('tr', null, h('td', {colSpan:5, className:'empty-note'}, '該当する従業員がいません'))
            : filtered.map(function(emp){
            return h('tr', {key:emp.id},
              h('td', null, emp.name),
              h('td', null, siteName(emp.siteId)),
              h('td', null, emp.type),
              h('td', {className:'wage'}, '¥'+emp.wage.toLocaleString()),
              h('td', null,
                h('button', {className:'icon-btn', title:'編集', onClick:function(){ setModal(emp); }}, h(Icon,{name:'pencil',size:14})),
                ' ',
                h('button', {className:'icon-btn danger', title:'削除', onClick:function(){ removeEmployee(emp); }}, h(Icon,{name:'trash',size:14}))
              )
            );
          })
        )
      )
    ),
    modal && h(EmployeeModal, {
      editing: modal==='new' ? null : modal,
      sites: data.sites,
      onClose: function(){ setModal(null); },
      onSave: saveEmployee
    })
  );
}

// ---------- Leave Requests ----------
function LeaveView(props){
  var data = props.data, setData = props.setData, notify = props.notify;
  var stForm = useState({employeeId:data.employees[0].id, date: toISO(new Date()), reason:''});
  var form = stForm[0], setForm = stForm[1];
  var stFilter = useState('all');
  var filter = stFilter[0], setFilter = stFilter[1];

  function empName(id){ var e=data.employees.filter(function(x){return x.id===id;})[0]; return e?e.name:'—'; }

  function addRequest(){
    if (!form.reason.trim()) return;
    var req = {id:'lr'+Date.now(), employeeId:form.employeeId, date:form.date, status:'申請中', reason:form.reason, requestedAt: toISO(new Date())};
    setData(Object.assign({}, data, {leaveRequests: data.leaveRequests.concat([req])}));
    setForm(Object.assign({}, form, {reason:''}));
    notify(empName(form.employeeId)+'の休み希望を登録しました', 'ok');
  }
  function setStatus(id, status){
    var next = data.leaveRequests.map(function(r){ return r.id===id ? Object.assign({}, r, {status:status}) : r; });
    var updated = Object.assign({}, data, {leaveRequests: next});
    if (status==='承認'){
      var req = next.filter(function(r){return r.id===id;})[0];
      var newShifts = Object.assign({}, data.shifts);
      newShifts[shiftKey(req.employeeId, req.date)] = 'off';
      updated.shifts = newShifts;
    }
    setData(updated);
    var target = next.filter(function(r){return r.id===id;})[0];
    notify(empName(target.employeeId)+'の申請を'+status+'にしました', status==='却下' ? 'danger' : 'ok');
  }

  var tabs = [{id:'all', label:'すべて'}, {id:'申請中', label:'申請中'}, {id:'承認', label:'承認'}, {id:'却下', label:'却下'}];
  var sorted = data.leaveRequests
    .filter(function(r){ return filter==='all' || r.status===filter; })
    .slice().sort(function(a,b){ return a.date < b.date ? -1 : 1; });

  return h('div', null,
    h('div', {className:'page-head'},
      h('div', null,
        h('h1', {className:'page-title'}, '休み希望・申請'),
        h('div', {className:'page-sub'}, '承認するとシフト表の該当日が自動的に「休」になります')
      )
    ),
    h('div', {className:'card card-pad', style:{marginBottom:18}},
      h('h3', {style:{fontSize:15, marginBottom:12}}, '新規申請を代理登録'),
      h('div', {className:'toolbar'},
        h('div', {className:'field'}, h('label', null, '従業員'),
          h('select', {className:'select', value:form.employeeId, onChange:function(e){ setForm(Object.assign({},form,{employeeId:e.target.value})); }},
            data.employees.map(function(e){ return h('option', {key:e.id, value:e.id}, e.name); }))),
        h('div', {className:'field'}, h('label', null, '希望日'),
          h('input', {type:'date', className:'input', value:form.date, onChange:function(e){ setForm(Object.assign({},form,{date:e.target.value})); }})),
        h('div', {className:'field', style:{flex:1, minWidth:180}}, h('label', null, '理由'),
          h('input', {className:'input', value:form.reason, placeholder:'例）通院のため', onChange:function(e){ setForm(Object.assign({},form,{reason:e.target.value})); }})),
        h('button', {className:'btn primary', onClick:addRequest, style:{alignSelf:'flex-end'}}, h(Icon,{name:'plus',size:14}), '申請を追加')
      )
    ),
    h('div', {className:'filter-tabs'}, tabs.map(function(t){
      return h('button', {
        key:t.id, className:'filter-tab'+(filter===t.id?' active':''),
        onClick:function(){ setFilter(t.id); }
      }, t.label);
    })),
    h('div', {className:'leave-list'},
      sorted.length===0 ? h('div', {className:'card empty-note'}, '申請はありません') :
      sorted.map(function(r){
        var d = fromISO(r.date);
        return h('div', {key:r.id, className:'card leave-item'},
          h('div', null,
            h('div', {className:'who'}, empName(r.employeeId)+' — '+fmtMD(d)+'('+DOW[(d.getDay()+6)%7]+')'),
            h('div', {className:'emp-meta'}, r.reason)
          ),
          h('div', {style:{display:'flex', alignItems:'center', gap:10}},
            h(Pill, {tone: r.status==='承認'?'ok': r.status==='却下'?'danger':'warn'}, r.status),
            r.status==='申請中' && h('button', {className:'btn sm primary', onClick:function(){ setStatus(r.id,'承認'); }}, h(Icon,{name:'check',size:12}), '承認'),
            r.status==='申請中' && h('button', {className:'btn sm danger', onClick:function(){ setStatus(r.id,'却下'); }}, h(Icon,{name:'close',size:12}), '却下')
          )
        );
      })
    )
  );
}

// ---------- Reports ----------
function ReportsView(props){
  var data = props.data, notify = props.notify;
  var stMonth = useState(ym(new Date()));
  var month = stMonth[0], setMonth = stMonth[1];

  var rows = data.employees.map(function(emp){
    var hours = {early:0, late:0, night:0};
    Object.keys(data.shifts).forEach(function(key){
      var parts = key.split('|');
      if (parts[0]!==emp.id) return;
      if (ym(fromISO(parts[1])) !== month) return;
      var v = data.shifts[key];
      if (hours.hasOwnProperty(v)) hours[v] += SHIFT_TYPES[v].hours;
    });
    var totalHours = hours.early+hours.late+hours.night;
    var cost = Math.round(totalHours*emp.wage);
    return {emp:emp, hours:hours, totalHours:totalHours, cost:cost};
  });

  var siteTotal = {};
  data.sites.forEach(function(s){ siteTotal[s.id] = {hours:0, cost:0}; });
  rows.forEach(function(r){
    siteTotal[r.emp.siteId].hours += r.totalHours;
    siteTotal[r.emp.siteId].cost += r.cost;
  });

  function exportCSV(){
    var lines = ['氏名,現場,雇用形態,早番時間,遅番時間,夜勤時間,合計時間,概算人件費'];
    rows.forEach(function(r){
      var site = data.sites.filter(function(s){return s.id===r.emp.siteId;})[0];
      lines.push([r.emp.name, site?site.name:'', r.emp.type, r.hours.early, r.hours.late, r.hours.night, r.totalHours, r.cost].join(','));
    });
    var csv = lines.join('\n');
    var blob = new Blob(['﻿'+csv], {type:'text/csv;charset=utf-8;'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'oplus_'+month+'.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    notify(month+'のCSVを書き出しました', 'ok');
  }

  return h('div', null,
    h('div', {className:'page-head'},
      h('div', null,
        h('h1', {className:'page-title'}, '月次集計'),
        h('div', {className:'page-sub'}, '労働時間と概算人件費（時給×時間の単純計算）')
      ),
      h('div', {style:{display:'flex', gap:10}},
        h('input', {type:'month', className:'input', value:month, onChange:function(e){ setMonth(e.target.value); }}),
        h('button', {className:'btn primary', onClick:exportCSV}, h(Icon,{name:'download',size:14}), 'CSVをエクスポート')
      )
    ),
    h('div', {className:'site-grid', style:{marginBottom:18}},
      data.sites.map(function(s){
        var t = siteTotal[s.id];
        return h('div', {key:s.id, className:'card site-card'},
          h('h3', {style:{marginBottom:10}}, s.name),
          h('div', {className:'shift-row'}, h('span',null,'合計稼働時間'), h('span', {className:'count'}, t.hours+'h')),
          h('div', {className:'shift-row'}, h('span',null,'概算人件費'), h('span', {className:'count'}, '¥'+t.cost.toLocaleString()))
        );
      })
    ),
    h('div', {className:'table-scroll'},
      h('table', {className:'grid-table'},
        h('thead', null, h('tr', null,
          h('th', null,'氏名'), h('th',null,'早番(h)'), h('th',null,'遅番(h)'), h('th',null,'夜勤(h)'), h('th',null,'合計(h)'), h('th',null,'概算人件費')
        )),
        h('tbody', null, rows.map(function(r){
          return h('tr', {key:r.emp.id},
            h('td', null, r.emp.name),
            h('td', {className:'wage'}, r.hours.early),
            h('td', {className:'wage'}, r.hours.late),
            h('td', {className:'wage'}, r.hours.night),
            h('td', {className:'wage'}, r.totalHours),
            h('td', {className:'wage'}, '¥'+r.cost.toLocaleString())
          );
        }))
      )
    )
  );
}

function App(){
  var stUnlocked = useState(function(){
    if (!APP_PIN) return true;
    try{ return localStorage.getItem(PIN_KEY)==='1'; }catch(e){ return false; }
  });
  var unlocked = stUnlocked[0], setUnlocked = stUnlocked[1];

  var dataPair = useOplusData();
  var data = dataPair[0], setData = dataPair[1], sync = dataPair[2];
  var stView = useState('dashboard');
  var view = stView[0], setView = stView[1];
  var stCollapsed = useState(function(){
    try{ return localStorage.getItem(SIDEBAR_KEY)==='1'; }catch(e){ return false; }
  });
  var collapsed = stCollapsed[0], setCollapsed = stCollapsed[1];
  var toastPair = useToasts();
  var toasts = toastPair[0], notify = toastPair[1];

  function toggleCollapsed(){
    setCollapsed(function(c){
      var next = !c;
      try{ localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0'); }catch(e){}
      return next;
    });
  }

  if (!unlocked){
    return h(PinGate, {onUnlock:function(){ setUnlocked(true); }});
  }

  if (!data){
    return h('div', {className:'boot-loading'}, 'データを読み込んでいます…');
  }

  var viewComponent = {
    dashboard: h(DashboardView, {data:data}),
    schedule: h(ScheduleView, {data:data, setData:setData}),
    employees: h(EmployeesView, {data:data, setData:setData, notify:notify}),
    leave: h(LeaveView, {data:data, setData:setData, notify:notify}),
    reports: h(ReportsView, {data:data, notify:notify})
  }[view];

  return h('div', {className:'app-shell'+(collapsed?' collapsed':'')},
    h(Sidebar, {view:view, setView:setView, collapsed:collapsed, onToggle:toggleCollapsed}),
    h('main', {className:'main'},
      h(SyncBadge, sync),
      h('div', {key:view, className:'view-fade'}, viewComponent)
    ),
    h(ToastStack, {toasts:toasts})
  );
}

var root = ReactDOM.createRoot(document.getElementById('root'));
root.render(h(App));

if ('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('./sw.js').catch(function(){});
  });
}
})();
