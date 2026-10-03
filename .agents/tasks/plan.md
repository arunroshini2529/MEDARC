# Implementation Plan — MED ARC Functional Fixes

**Single file:** `c:\Users\Arun\Desktop\STUDY PLANNER\index.html`  
**Edit order:** CSS additions first → HTML additions → JS modifications/additions  
**Backward-compat rule:** All code that reads `session.duration` must use `Number(s.duration)||0` so that old `{date, taskId}` records (no duration field) are treated as 0 minutes.

---

## FEAT-001 — Data model + session recording + streak

Fixes 1 (timer task linkage + richer sessions), 2 (orphaned session cleanup), 3 (longest streak).

- [ ] 1. **CSS — streak-best line + timerTask select styles**
      In `<style>`, before `@media(max-width:1050px)`, add:
      ```css
      .streak-best{font-size:10px;color:#b89a5a;margin-top:4px;font-weight:600}
      .dark .streak-best{color:#d4b97a}
      #timerTask{display:block;margin:14px auto 0;border:1px solid var(--line);border-radius:9px;padding:9px 12px;color:var(--ink);background:white;min-width:220px;max-width:340px}
      .dark #timerTask{background:#202838;color:var(--ink);border-color:#3a455b}
      ```
      Files: `index.html` (`<style>` block)
      Verify: Open in browser, confirm no FOUC or layout shift on timer page.

- [ ] 2. **HTML — timerTask `<select>` on Focus Timer page**
      In `page-focus`, inside `<article class="card timer-wrap">`, after `<p id="timerHint">…</p>` and before `<div class="timer-modes">`, insert:
      ```html
      <select id="timerTask"><option value="">— No task selected —</option></select>
      ```
      Files: `index.html` (`page-focus` section)
      Verify: Timer page shows a dropdown below the hint text.

- [ ] 3. **HTML — best-streak `<p>` in sidebar streak card**
      In `.streak-card`, after `<p id="streakText">…</p>`, add:
      ```html
      <p class="streak-best" id="streakBest" style="display:none"></p>
      ```
      Files: `index.html` (sidebar)
      Verify: Sidebar renders normally; the element is hidden until a streak exists.

- [ ] 4. **JS — richer session push in `bindTaskActions` checkbox handler**
      Find: `data.sessions.push({date:day(),taskId:t.id})`
      Replace with:
      ```js
      data.sessions.push({date:day(),taskId:t.id,duration:Number(t.duration)||0,startedAt:new Date().toISOString(),endedAt:new Date().toISOString()})
      ```
      Files: `index.html` (`bindTaskActions` function)
      Verify: Check off a task; inspect localStorage — session has `duration`, `startedAt`, `endedAt`.

- [ ] 5. **JS — richer timer completion session push**
      Find in the `timerToggle` `setInterval` callback (`if(remaining<=0)` block):
      `data.sessions.push({date:day(),taskId:null})`
      Replace with:
      ```js
      const _tid=$('#timerTask').value||null,_dur=mode==='focus'?25:5,_end=new Date().toISOString(),_start=new Date(Date.now()-_dur*60000).toISOString();data.sessions.push({date:day(),taskId:_tid,duration:_dur,startedAt:_start,endedAt:_end});
      ```
      Files: `index.html` (`timerToggle` click handler)
      Verify: Complete a timer session; localStorage session has `duration=25`, correct `taskId` if one was selected.

- [ ] 6. **JS — add `renderTimerTask()` function and call it**
      Add new function immediately before or after `renderTasks`:
      ```js
      function renderTimerTask(){const sel=$('#timerTask');if(!sel)return;const prev=sel.value;sel.innerHTML='<option value="">— No task selected —</option>'+data.tasks.filter(t=>!t.done).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).map(t=>`<option value="${esc(t.id)}">${esc(t.topic)} (${fmtDate(t.date,{month:'short',day:'numeric'})})</option>`).join('');if(prev)sel.value=prev}
      ```
      At the end of `renderTasks()`, add `renderTimerTask();`
      At the end of `renderDashboard()`, add `renderTimerTask();`
      Files: `index.html` (new function + two call sites)
      Verify: Go to Focus Timer — dropdown lists incomplete tasks.

- [ ] 7. **JS — update dashboard "Study time today" to sum session durations**
      In `renderDashboard`, find the line:
      `$('#studyTime').innerHTML=\`${completed} <small>min</small>\``
      Replace with:
      ```js
      const sessionMins=data.sessions.filter(s=>s.date===today).reduce((n,s)=>n+(Number(s.duration)||0),0);$('#studyTime').innerHTML=`${sessionMins} <small>min</small>`;
      ```
      (Leave the existing `completed` variable in place — it is still used for the progress ring.)
      Files: `index.html` (`renderDashboard`)
      Verify: Dashboard Study time shows summed minutes including timer completions, not just checked tasks.

- [ ] 8. **JS — orphaned session cleanup in `bindTaskActions` delete handler**
      Find:
      `root.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{data.tasks=data.tasks.filter(x=>x.id!==b.dataset.delete);update();toast('Session removed.')})`
      Replace with:
      ```js
      root.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{const _did=b.dataset.delete;data.tasks=data.tasks.filter(x=>x.id!==_did);data.sessions=data.sessions.filter(s=>s.taskId!==_did);update();toast('Session removed.')})
      ```
      Files: `index.html` (`bindTaskActions`)
      Verify: Delete a task that has sessions; reload page — sessions for that taskId are gone.

- [ ] 9. **JS — update `updateStreak()` to compute and display longest streak**
      Replace the full body of `updateStreak` with:
      ```js
      function updateStreak(){
        let dates=[...new Set(data.sessions.map(s=>s.date))].sort();
        // current streak
        let n=0,cursor=new Date(day()+'T12:00:00');
        if(!dates.includes(day()))cursor.setDate(cursor.getDate()-1);
        while(dates.includes(cursor.toISOString().slice(0,10))){n++;cursor.setDate(cursor.getDate()-1)}
        // longest streak
        let best=0,run=0;
        for(let i=0;i<dates.length;i++){
          if(i===0){run=1}else{
            const prev=new Date(dates[i-1]+'T12:00:00');prev.setDate(prev.getDate()+1);
            run=prev.toISOString().slice(0,10)===dates[i]?run+1:1
          }
          if(run>best)best=run
        }
        const prev=data.longestStreak||0;
        data.longestStreak=Math.max(prev,n,best);
        if(data.longestStreak!==prev)save();
        $('#streakTitle').textContent=n?`${n} ${n===1?'day':'days'} of showing up`:'A little progress adds up';
        $('#streakText').textContent=n?'A gentle rhythm, one session at a time. Missed a day? Today is a fresh start.':'Every study session is a fresh start. Keep showing up for yourself.';
        const best_el=$('#streakBest');
        if(best_el){if(data.longestStreak>0){best_el.textContent='🏆 Best: '+data.longestStreak+' '+(data.longestStreak===1?'day':'days');best_el.style.display=''}else best_el.style.display='none'}
      }
      ```
      Files: `index.html` (`updateStreak`)
      Verify: Create sessions on multiple days (manipulate localStorage dates to simulate). Best streak line appears in sidebar.

- [ ] 10. **JS — init guard for `data.longestStreak` and `data.weeklyGoalMinutes` in startup**
       In the `try{data={...initial,...JSON.parse(...)}}` block, after the `if(!Array.isArray(data.notes))` guard, add:
       ```js
       if(typeof data.longestStreak!=='number')data.longestStreak=0;
       if(typeof data.weeklyGoalMinutes!=='number')data.weeklyGoalMinutes=0;
       ```
       Also add to the `initial` object (after `notes:[]`):
       `longestStreak:0,weeklyGoalMinutes:0`
       Also add the same two guards in `syncWithServer` after the existing `if(!Array.isArray(data.notes))` guard.
       Files: `index.html` (initial object + two init guards)
       Verify: Load with empty localStorage — no console errors, longestStreak and weeklyGoalMinutes exist in data.

---

## FEAT-002 — Analytics page + weekly goal + per-subject progress

Fixes 4, 5, 6. **Depends on FEAT-001 being complete** (needs richer session durations).

- [ ] 11. **CSS — analytics page styles**
       In `<style>`, after the last `.dark .note-date` rule and before `</style>`, add:
       ```css
       .analytics-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:18px}
       .an-card{padding:20px 22px}
       .an-title{font:700 13px 'Segoe UI';margin:0 0 14px;color:#526078}
       .bar-chart{display:flex;align-items:flex-end;gap:6px;height:90px;padding-top:10px}
       .bar-col{display:flex;flex-direction:column;align-items:center;gap:4px;flex:1}
       .bar-fill{background:var(--blue);border-radius:4px 4px 0 0;width:100%;min-height:2px;transition:height .3s}
       .bar-label{font-size:9px;color:var(--muted);text-align:center}
       .bar-val{font-size:9px;color:var(--blue);font-weight:700}
       .subj-row{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--line)}
       .subj-row:first-of-type{border-top:0}
       .subj-bar-wrap{flex:1;background:#edf0f5;border-radius:4px;height:7px;overflow:hidden}
       .subj-bar-fill{height:100%;border-radius:4px}
       .goal-card{padding:18px 22px;margin-bottom:18px}
       .goal-bar-wrap{background:#edf0f5;border-radius:8px;height:11px;overflow:hidden;margin:10px 0 6px}
       .goal-bar-fill{height:100%;background:var(--blue);border-radius:8px;transition:width .4s}
       .goal-meta{font-size:11px;color:var(--muted);display:flex;justify-content:space-between}
       .week-compare{display:flex;gap:18px;margin-top:10px}
       .week-compare-item{flex:1;text-align:center;padding:14px 10px;border:1px solid var(--line);border-radius:12px}
       .week-compare-item strong{display:block;font:700 26px Manrope;color:var(--blue)}
       .week-compare-item span{font-size:11px;color:var(--muted)}
       .subj-progress-wrap{background:#edf0f5;border-radius:4px;height:6px;overflow:hidden;margin:6px 0 4px}
       .subj-progress-fill{height:100%;border-radius:4px}
       .dark .subj-bar-wrap,.dark .goal-bar-wrap,.dark .subj-progress-wrap{background:#303a4e}
       .dark .an-title{color:#b6c1d3}
       .dark .week-compare-item{border-color:#303a4e}
       .dark .week-compare-item strong{color:#8ca8ff}
       ```
       Files: `index.html` (`<style>` block)
       Verify: No console CSS errors; analytics page (once added) is styled correctly.

- [ ] 12. **HTML — Analytics nav button**
       In `<nav id="nav">`, after the Notes `<button data-page="notes">` button, add:
       ```html
       <button data-page="analytics"><span class="nav-icon">📊</span><span>Analytics</span></button>
       ```
       Files: `index.html` (nav)
       Verify: Sidebar shows 📊 Analytics button.

- [ ] 13. **HTML — Analytics page section**
       After `</section>` closing `page-focus`, before `</main>`, insert:
       ```html
       <section class="page" id="page-analytics">
         <div class="welcome-row"><div><p class="eyebrow">YOUR PROGRESS</p><h1>Analytics</h1><p class="subtitle">A look at how your study time is building up.</p></div></div>
         <div id="analyticsContent"></div>
       </section>
       ```
       Files: `index.html` (main content area)
       Verify: Clicking 📊 Analytics shows the page (empty until `renderAnalytics` is wired).

- [ ] 14. **HTML — Goal progress bar card on dashboard**
       In `page-dashboard`, after the closing `</div>` of `<div class="cards">` and before `<div class="content-grid">`, insert:
       ```html
       <article class="card goal-card" id="goalCard" style="display:none">
         <div class="section-head"><div><h2>Weekly study goal</h2><p id="goalCardSub">Set a weekly target to stay on track.</p></div><button class="text-btn" id="openGoalModal">Set goal</button></div>
         <div class="goal-bar-wrap"><div class="goal-bar-fill" id="goalBarFill" style="width:0%"></div></div>
         <div class="goal-meta"><span id="goalMetaLeft"></span><span id="goalMetaRight"></span></div>
       </article>
       ```
       Files: `index.html` (`page-dashboard`)
       Verify: Dashboard does not show the goal card initially (hidden); it appears after a goal is set.

- [ ] 15. **HTML — Goal modal**
       After the closing `</div>` of the existing task modal (`id="modal"`), add a new modal:
       ```html
       <div class="modal-backdrop" id="goalModal">
         <div class="modal">
           <div class="modal-head"><h2>Set weekly study goal</h2><button class="close" id="closeGoalModal">×</button></div>
           <div class="form">
             <label>Weekly goal (hours)<input id="goalHoursInput" type="number" min="0" max="100" step="0.5" placeholder="e.g. 10"></label>
             <div class="form-footer"><button class="secondary" id="cancelGoalModal">Cancel</button><button class="primary" id="saveGoalModal">Save goal</button></div>
           </div>
         </div>
       </div>
       ```
       Files: `index.html` (after existing task modal)
       Verify: Modal HTML is present in DOM; not visible until opened.

- [ ] 16. **JS — add `pageNames` entry for analytics**
       In the `pageNames` object literal, add `analytics:'Analytics'`.
       Files: `index.html` (pageNames object)
       Verify: Navigating to analytics sets the breadcrumb to "Analytics".

- [ ] 17. **JS — add `renderAnalytics()` function**
       Add after `updateStreak`:
       ```js
       function renderAnalytics(){
         const ac=$('#analyticsContent');if(!ac)return;
         // helpers
         const weekStart=(offsetWeeks=0)=>{const m=new Date();m.setHours(12,0,0,0);m.setDate(m.getDate()-((m.getDay()+6)%7)+offsetWeeks*7);return m};
         const isoDate=d=>d.toISOString().slice(0,10);
         const dayMins=d=>data.sessions.filter(s=>s.date===d).reduce((n,s)=>n+(Number(s.duration)||0),0);
         // 7-day bar chart (last 7 days)
         const days7=Array.from({length:7},(_,i)=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-6+i);return isoDate(d)});
         const mins7=days7.map(dayMins);
         const maxM=Math.max(...mins7,1);
         const barChart=`<div class="bar-chart">${days7.map((d,i)=>`<div class="bar-col"><div class="bar-val">${mins7[i]?minsText(mins7[i]):''}</div><div class="bar-fill" style="height:${Math.round(mins7[i]/maxM*78)}px"></div><div class="bar-label">${new Date(d+'T12:00:00').toLocaleDateString(undefined,{weekday:'short'})}</div></div>`).join('')}</div>`;
         // per-subject breakdown
         const subjMins=s=>data.sessions.filter(s2=>{const t=data.tasks.find(x=>x.id===s2.taskId);return t&&t.subject===s.id}).reduce((n,s2)=>n+(Number(s2.duration)||0),0);
         const maxSubjM=Math.max(...data.subjects.map(subjMins),1);
         const subjRows=data.subjects.map(s=>{const m=subjMins(s),total=data.tasks.filter(t=>t.subject===s.id).length,done=data.tasks.filter(t=>t.subject===s.id&&t.done).length,pct=total?Math.round(done/total*100):0;return `<div class="subj-row"><span class="subject-dot" style="--dot:${s.color}"></span><span style="font-size:12px;flex:1">${esc(s.name)}</span><div class="subj-bar-wrap" style="width:80px"><div class="subj-bar-fill" style="width:${Math.round(m/maxSubjM*100)}%;background:${s.color}"></div></div><span style="font-size:11px;color:var(--muted);min-width:60px;text-align:right">${minsText(m)} · ${pct}%</span></div>`}).join('');
         // this week vs last week completion
         const wMon0=isoDate(weekStart(0)),wSun0=isoDate(new Date(weekStart(0).getTime()+6*86400000));
         const wMon1=isoDate(weekStart(-1)),wSun1=isoDate(new Date(weekStart(-1).getTime()+6*86400000));
         const rateOf=(s,e)=>{const all=data.tasks.filter(t=>t.date>=s&&t.date<=e);return all.length?Math.round(all.filter(t=>t.done).length/all.length*100):0};
         const thisRate=rateOf(wMon0,wSun0),lastRate=rateOf(wMon1,wSun1);
         ac.innerHTML=`
           <div class="analytics-grid">
             <article class="card an-card"><p class="an-title">Study hours — last 7 days</p>${barChart}</article>
             <article class="card an-card"><p class="an-title">Per-subject breakdown</p>${subjRows||'<div class="empty">No subjects yet.</div>'}</article>
           </div>
           <div class="analytics-grid">
             <article class="card an-card"><p class="an-title">Completion rate</p><div class="week-compare"><div class="week-compare-item"><strong>${thisRate}%</strong><span>This week</span></div><div class="week-compare-item"><strong>${lastRate}%</strong><span>Last week</span></div></div></article>
             <article class="card an-card"><p class="an-title">Streaks</p><div style="display:flex;gap:18px;margin-top:8px"><div class="week-compare-item" style="flex:1"><strong>${(()=>{let dates=[...new Set(data.sessions.map(s=>s.date))].sort(),n=0,cursor=new Date(day()+'T12:00:00');if(!dates.includes(day()))cursor.setDate(cursor.getDate()-1);while(dates.includes(cursor.toISOString().slice(0,10))){n++;cursor.setDate(cursor.getDate()-1)}return n})()} <span style="font-size:14px">🔥</span></strong><span>Current streak (days)</span></div><div class="week-compare-item" style="flex:1"><strong>${data.longestStreak||0} <span style="font-size:14px">🏆</span></strong><span>Longest streak (days)</span></div></div></article>
           </div>`;
       }
       ```
       Files: `index.html` (new function)
       Verify: Navigate to Analytics — all four cards render without JS errors.

- [ ] 18. **JS — add `renderDashboardGoal()` function and call it**
       Add after `renderAnalytics`:
       ```js
       function renderDashboardGoal(){
         const card=$('#goalCard');if(!card)return;
         if(!data.weeklyGoalMinutes){card.style.display='none';return}
         card.style.display='';
         const m=weekStart(0),sun=new Date(m.getTime()+6*86400000);
         // helper weekStart already defined in renderAnalytics scope — redefine locally:
         const _mon=(()=>{const x=new Date();x.setHours(12,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x.toISOString().slice(0,10)})();
         const _sun=(()=>{const x=new Date();x.setHours(12,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7)+6);return x.toISOString().slice(0,10)})();
         const weekMins=data.sessions.filter(s=>s.date>=_mon&&s.date<=_sun).reduce((n,s)=>n+(Number(s.duration)||0),0);
         const pct=Math.min(100,data.weeklyGoalMinutes>0?weekMins/data.weeklyGoalMinutes*100:0);
         $('#goalBarFill').style.width=pct.toFixed(1)+'%';
         const goalH=+(data.weeklyGoalMinutes/60).toFixed(1),doneH=+(weekMins/60).toFixed(1);
         $('#goalMetaLeft').textContent=`${doneH}h of ${goalH}h this week`;
         $('#goalMetaRight').textContent=pct>=100?'Goal reached! 🎉':`${+(( data.weeklyGoalMinutes-weekMins)/60).toFixed(1)}h to go`;
       }
       ```
       At the very end of `renderDashboard()`, call `renderDashboardGoal();`.
       Files: `index.html` (new function + one call site)
       Verify: Set a weekly goal — goal card appears on dashboard with correct progress bar.

- [ ] 19. **JS — wire goal modal buttons**
       After the existing `['addTaskBtn','tasksAdd','calendarAdd','quickAddTop'].forEach(...)` modal-wiring block, add:
       ```js
       $('#openGoalModal').onclick=()=>{$('#goalHoursInput').value=data.weeklyGoalMinutes?(data.weeklyGoalMinutes/60).toFixed(1):'';$('#goalModal').classList.add('open');setTimeout(()=>$('#goalHoursInput').focus(),30)};
       $('#closeGoalModal').onclick=$('#cancelGoalModal').onclick=()=>$('#goalModal').classList.remove('open');
       $('#goalModal').onclick=e=>{if(e.target===$('#goalModal'))$('#goalModal').classList.remove('open')};
       $('#saveGoalModal').onclick=()=>{const h=parseFloat($('#goalHoursInput').value);if(isNaN(h)||h<0){toast('Enter a valid number of hours.');return}data.weeklyGoalMinutes=Math.round(h*60);$('#goalModal').classList.remove('open');update();toast(h===0?'Goal cleared.':'Weekly goal set!')};
       ```
       Also update the existing `document.onkeydown=e=>{if(e.key==='Escape')closeModal()}` to also close the goal modal:
       Replace it with `document.onkeydown=e=>{if(e.key==='Escape'){closeModal();$('#goalModal').classList.remove('open')}};`
       Files: `index.html` (JS wiring section)
       Verify: Click "Set goal" → modal opens → enter 10 → Save → goal card shows 0h of 10h.

- [ ] 20. **JS — call `renderAnalytics()` from `update()`**
       In `function update()`, after `updateStreak()`, add `renderAnalytics();`.
       Files: `index.html` (`update` function)
       Verify: Any data change (add task, check task) refreshes the analytics page.

- [ ] 21. **JS — update `renderSubjects()` to show per-subject progress**
       In `renderSubjects()`, inside the `.map(s=>{...})` callback, replace the existing subject card template where the `<p>` shows `${n} planned ${n===1?'session':'sessions'}` with:
       ```js
       const doneN=data.tasks.filter(t=>t.subject===s.id&&t.done).length;
       const pct=n?Math.round(doneN/n*100):0;
       const sHrs=data.sessions.filter(s2=>{const t=data.tasks.find(x=>x.id===s2.taskId);return t&&t.subject===s.id}).reduce((acc,s2)=>acc+(Number(s2.duration)||0),0);
       const hrsText=sHrs>=60?(Math.floor(sHrs/60)+'h '+(sHrs%60?sHrs%60+'m':'')).trim():(sHrs||0)+'m';
       ```
       Then in the returned HTML string, replace `<p>${n} planned ${n===1?'session':'sessions'}</p>` with:
       `<p>${n} ${n===1?'session':'sessions'} · ${pct}% done · ${hrsText} studied</p><div class="subj-progress-wrap"><div class="subj-progress-fill" style="width:${pct}%;background:${s.color}"></div></div>`
       Files: `index.html` (`renderSubjects`)
       Verify: Subjects page shows "3 sessions · 33% done · 45m studied" style text + progress bar per card.

---

## FEAT-003 — Polish fixes

Fixes 7 (search), 8 (CSV export), 9 (miniWeek cap), 10 (mobile task menu). Independent of FEAT-001/002 but implemented last to avoid conflicting with HTML regions already touched.

- [ ] 22. **CSS — search bar styles + mobile task menu fix**
       In `<style>`:
       a. Inside the `@media(max-width:480px)` rule, find `.task-menu{display:none}` and replace with `.task-menu{padding:2px 3px;font-size:14px}`.
       b. Outside all media queries (append before `</style>`):
       ```css
       .search-bar{display:flex;gap:8px;align-items:center;margin-bottom:10px}
       .search-bar input[type=search]{flex:1;border:1px solid var(--line);border-radius:9px;padding:8px 11px;color:var(--ink);background:white;outline:none;font:inherit}
       .search-bar input[type=search]:focus{border-color:#8eabfa}
       .dark .search-bar input[type=search]{background:#202838;color:var(--ink);border-color:#3a455b}
       ```
       Files: `index.html` (`<style>` block)
       Verify: On a 375px viewport, task ✎ and × buttons are visible.

- [ ] 23. **HTML — taskSearch input on Tasks page**
       In `page-tasks`, inside `<article class="card section-card">`, after the closing `</div>` of `<div class="section-head">` and before `<div class="task-list" id="allTasks">`, insert:
       ```html
       <div class="search-bar"><input type="search" id="taskSearch" placeholder="Search sessions…" aria-label="Search sessions"></div>
       ```
       Files: `index.html` (`page-tasks`)
       Verify: Tasks page shows a search input above the task list.

- [ ] 24. **HTML — noteSearch input on Notes page**
       In `page-notes`, inside the right-hand `<div>` column (the one containing `notes-list-head`), between `<div class="section-head notes-list-head">…</div>` and `<div class="notes-list" id="notesList">`, insert:
       ```html
       <div class="search-bar" style="margin-bottom:10px"><input type="search" id="noteSearch" placeholder="Search notes…" aria-label="Search notes"></div>
       ```
       Files: `index.html` (`page-notes`)
       Verify: Notes page shows a search input above the notes list.

- [ ] 25. **HTML — CSV export button on Tasks page**
       In `page-tasks`, in `<div class="welcome-row">`, after `<button class="primary" id="tasksAdd">＋ Add session</button>`, add:
       ```html
       <button class="secondary" id="exportCSV" style="margin-left:8px">↓ Export CSV</button>
       ```
       Files: `index.html` (`page-tasks` welcome-row)
       Verify: Tasks page header shows the Export CSV button next to Add session.

- [ ] 26. **JS — update `renderTasks()` to filter by taskSearch**
       In `renderTasks()`, after `let f=$('#taskFilter').value`, add:
       ```js
       const q=($('#taskSearch')?.value||'').toLowerCase().trim();
       ```
       Change the filter chain from `.filter(t=>f==='done'?t.done:f==='upcoming'?!t.done:true)` to:
       ```js
       .filter(t=>f==='done'?t.done:f==='upcoming'?!t.done:true)
       .filter(t=>!q||t.topic.toLowerCase().includes(q)||subject(t.subject).name.toLowerCase().includes(q))
       ```
       After the existing `$('#taskFilter').onchange=renderTasks` line, add:
       ```js
       $('#taskSearch').addEventListener('input',renderTasks);
       ```
       Files: `index.html` (`renderTasks` + event wiring)
       Verify: Type a keyword in task search — list filters live. Clear it — all tasks return.

- [ ] 27. **JS — update `renderNotes()` to filter by noteSearch**
       At the start of `renderNotes()`, after the `const list=$('#notesList')` line, add:
       ```js
       const nq=($('#noteSearch')?.value||'').toLowerCase().trim();
       ```
       Change `[...data.notes].sort(...)` to `[...data.notes].filter(n=>!nq||n.title.toLowerCase().includes(nq)||n.body.toLowerCase().includes(nq)).sort(...)`.
       Update the note count to use filtered count:
       ```js
       const filteredNotes=[...data.notes].filter(n=>!nq||n.title.toLowerCase().includes(nq)||n.body.toLowerCase().includes(nq));
       $('#noteCount').textContent=`${filteredNotes.length} ${filteredNotes.length===1?'note':'notes'}`;
       ```
       After `$('#clearNote').onclick=clearNoteEditor`, add:
       ```js
       $('#noteSearch').addEventListener('input',renderNotes);
       ```
       Files: `index.html` (`renderNotes` + event wiring)
       Verify: Type a keyword in note search — notes filter live.

- [ ] 28. **JS — add `exportCSV()` function and wire button**
       Add after `renderNotes` or near the end of the IIFE (before `syncWithServer`):
       ```js
       function exportCSV(){
         const header=['Topic','Subject','Date','Start Time','Duration (min)','Done','Exam','Session Count'];
         const rows=[header,...data.tasks.map(t=>[t.topic,subject(t.subject).name,t.date,t.time,t.duration,t.done?'Yes':'No',t.exam?'Yes':'No',data.sessions.filter(s=>s.taskId===t.id).length])];
         const csv='\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
         const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='study-sessions-'+day()+'.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);toast('CSV exported.')
       }
       ```
       After the `$('#taskFilter').onchange=renderTasks` line, add:
       ```js
       $('#exportCSV').onclick=exportCSV;
       ```
       Files: `index.html` (new function + wiring)
       Verify: Click Export CSV — a .csv file downloads with correct columns and all task rows.

- [ ] 29. **JS — remove `.slice(0,4)` cap from miniWeek in `renderDashboard()`**
       In `renderDashboard()`, find:
       `.slice(0,4).map(t=>`
       Replace with `.slice(0,6).map(t=>`.
       Then, after the `.join('')` that closes the map (and before the `:'<div class="empty"...'` fallback), add an "and N more" link if there are more than 6:
       The full miniWeek assignment becomes:
       ```js
       const sorted=weekTasks.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
       const visible=sorted.slice(0,6);
       const overflow=sorted.length-6;
       $('#miniWeek').innerHTML=weekTasks.length?(visible.map(t=>`<div style="display:flex;gap:9px;align-items:center;padding:8px 0;border-top:1px solid #f0f2f6"><span class="subject-dot" style="--dot:${subject(t.subject).color}"></span><span style="font-size:11px;color:#526078;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.topic)}</span><small style="color:#9aa3b1">${fmtDate(t.date,{weekday:'short'})}</small></div>`).join('')+(overflow>0?`<div style="padding:8px 0;border-top:1px solid #f0f2f6;text-align:right"><button class="text-btn" style="font-size:11px" onclick="switchPage('calendar')">and ${overflow} more →</button></div>`:'')):'<div class="empty" style="padding:15px">Nothing on the calendar this week yet.</div>';
       ```
       Remove the old `.slice(0,4).map(...)` chain that was there previously.
       Files: `index.html` (`renderDashboard`)
       Verify: Add 7+ tasks to the current week. Dashboard miniWeek shows 6 items and a "and N more →" link.

---

## Backward-Compatibility Notes

- **Old sessions `{date, taskId}`** (no `duration`, no `startedAt`, no `endedAt`): every place that reads `session.duration` uses `Number(s.duration)||0`, which safely returns 0 for undefined/null.
- **`data.longestStreak` and `data.weeklyGoalMinutes`**: guarded in both the initial load block and `syncWithServer`. Devices with old localStorage will get 0 defaults on first load.

## Edit Order Summary (minimise conflicts)

1. All CSS additions (items 1, 11, 22) — touchpoints: `<style>` block only  
2. All HTML additions (items 2, 3, 5, 12–15, 23–25) — add elements; never remove  
3. All JS modifications and additions (items 4–10, 16–21, 26–29) — touches IIFE body

Each item leaves the file in a parseable/runnable state. No item depends on a later item within the same FEAT block (ordering within FEATs is strictly dependency-ordered).
