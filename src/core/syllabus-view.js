import { getProgress } from '../shared/db.js';

let currentLang = localStorage.getItem('preferredLang') || 'en';

export function setLanguage(lang) {
  currentLang = lang === 'hi' ? 'hi' : 'en';
  localStorage.setItem('preferredLang', currentLang);
}
export function getLanguage(){ return currentLang; }

export async function renderSyllabus(container, student) {
  container.innerHTML='<p class="loading">Loading your learning orbit…</p>';
  let syllabus;
  try {
    const response=await fetch('/syllabus.json');
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    syllabus=await response.json();
  } catch(error){
    container.innerHTML=`<div class="error-box"><p class="error">Could not load the syllabus.</p><p class="error-detail">${escapeHtml(error.message)}</p></div>`;
    return;
  }

  const lang=currentLang;
  const wrapper=document.createElement('div'); wrapper.className='syllabus';
  const total=syllabus.units.reduce((n,u)=>n+(u.lessons||[]).length,0);
  const hero=document.createElement('section'); hero.className='orbit-hero';
  hero.innerHTML=`<div><span class="eyebrow">${lang==='hi'?'ऑफलाइन लर्निंग':'OFFLINE LEARNING'}</span><h2>${syllabus.subject?.[lang]||'Mathematics'} — ${lang==='hi'?'कक्षा':'Class'} ${syllabus.grade}</h2><p>${lang==='hi'?'सीखो, खेलो और आगे बढ़ो — इंटरनेट के बिना भी।':'Learn, explore and grow — even when the internet is away.'}</p><div class="hero-pills"><span>✦ ${lang==='hi'?'मज़ेदार पाठ':'Fun lessons'}</span><span>🧩 ${lang==='hi'?'अभ्यास क्विज़':'Practice quizzes'}</span><span>◉ ${lang==='hi'?'ऑफलाइन तैयार':'Offline ready'}</span></div></div><div class="hero-orbit">✦</div>`;
  wrapper.appendChild(hero);

  const heading=document.createElement('div'); heading.className='section-heading';
  heading.innerHTML=`<div><span class="eyebrow dark">${lang==='hi'?'आज का मिशन':'TODAY’S MISSION'}</span><h3>${lang==='hi'?'अपना अगला पाठ चुनें':'Choose a lesson to explore'}</h3></div><span class="lesson-count">${total} ${lang==='hi'?'पाठ':'lessons'}</span>`;
  wrapper.appendChild(heading);

  const imageMap={
    l1:'/images/whole-numbers.svg', l2:'/images/fractions.svg', l3:'/images/geometry.svg',
    s1:'/images/plants.svg', s2:'/images/matter.svg'
  };
  const descriptions={
    l1:{en:'Explore numbers, number lines and patterns.',hi:'संख्याएँ, संख्या रेखा और पैटर्न सीखें।'},
    l2:{en:'Discover fractions through everyday sharing.',hi:'रोज़मर्रा की चीज़ों से भिन्न समझें।'},
    l3:{en:'Meet shapes, angles and geometry around you.',hi:'अपने आसपास आकार और कोण पहचानें।'},
    s1:{en:'Discover how plants grow, make food and help us.',hi:'जानें पौधे कैसे बढ़ते हैं, भोजन बनाते हैं और हमारी मदद करते हैं।'},
    s2:{en:'Explore solids, liquids and gases with everyday examples.',hi:'ठोस, द्रव और गैस को रोज़मर्रा के उदाहरणों से समझें।'}
  };

  for (const unit of syllabus.units) {
    const unitEl=document.createElement('section'); unitEl.className='unit';
    const unitTitle=document.createElement('h3'); unitTitle.textContent=unit.title?.[lang]||unit.title?.en||unit.id; unitEl.appendChild(unitTitle);
    const list=document.createElement('ul'); list.className='lesson-list';

    for (const lesson of (unit.lessons||[])) {
      let progress = null;
      if (student?.studentId) {
        try { progress = await getProgress(lesson.id, student.studentId); } catch {}
      }
      const completed = !!progress?.completed;
      const done = progress?.completedQuestions?.length || 0;
      const totalQuestions = progress?.totalQuestions || 6;

      const item=document.createElement('li');
      item.className=`lesson-item${completed?' completed':''}`;
      const img=document.createElement('img'); img.className='lesson-thumb'; img.src=imageMap[lesson.id]||imageMap.l1; img.alt=lesson.title?.[lang]||lesson.title?.en||lesson.id; item.appendChild(img);
      const content=document.createElement('div'); content.className='lesson-card-content';
      const link=document.createElement('a'); link.className='lesson-link'; link.href=`#/lesson/${encodeURIComponent(lesson.id)}`; link.textContent=lesson.title?.[lang]||lesson.title?.en||lesson.id; content.appendChild(link);
      const desc=document.createElement('p'); desc.textContent=descriptions[lesson.id]?.[lang]||''; content.appendChild(desc);

      const progressLine=document.createElement('div'); progressLine.className='lesson-progress-line';
      progressLine.innerHTML = completed
        ? `✓ ${lang==='hi'?'पूरा हुआ':'Completed'} • ${Math.round((progress.score||0)*100)}%`
        : done
          ? `${done}/${totalQuestions} ${lang==='hi'?'प्रश्न पूरे':'questions complete'}`
          : (lang==='hi'?'अभी शुरू नहीं हुआ':'Not started');
      content.appendChild(progressLine);

      const button=document.createElement('a'); button.className='lesson-start'; button.href=`#/lesson/${encodeURIComponent(lesson.id)}`; button.innerHTML=`<span>${completed ? (lang==='hi'?'फिर से देखें':'Review lesson') : (lang==='hi'?'पाठ खोलें':'Open lesson')}</span><b>→</b>`; content.appendChild(button);
      item.appendChild(content); list.appendChild(item);
    }
    unitEl.appendChild(list); wrapper.appendChild(unitEl);
  }
  container.replaceChildren(wrapper);
}

function escapeHtml(value){return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
