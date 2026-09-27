import { getAllProgress, getAllStudents, exportBackup, importBackup, getUnsyncedProgress, syncProgress } from '../shared/db.js';
import { onProgressUpdate, getRaisedHands, onHandsChanged, lowerHand, LIVE_UPDATES_SUPPORTED } from '../shared/live-signal.js';

const SYNC_ENDPOINT_KEY = 'offlineOrbitSyncEndpoint';
const LAST_SYNC_KEY = 'offlineOrbitLastSyncAt';
const ASSIGNMENT_KEY = 'offlineOrbitAssignment';

// Only one Teacher Board can be "live-subscribed" at a time; re-rendering
// the board (route change, language toggle, manual refresh) tears down the
// previous subscription before creating a new one so listeners don't pile up.
let teardownLiveTeacherBoard = null;

// A lesson counts as "advanced" once a completed run scores at or above this,
// and "on track" once it scores at or above this (below it, completed work
// still counts as needing help). Mirrors the spirit of ATTENTION_SCORE below
// but split into three bands instead of a single pass/fail line.
const GROUP_ADVANCED_SCORE = 0.8;
const GROUP_ONTRACK_SCORE = 0.5;

const LESSONS = [
  { id:'l1', subject:'Maths', subjectHi:'गणित', en:'Whole Numbers', hi:'पूर्ण संख्याएँ', icon:'🔢' },
  { id:'l2', subject:'Maths', subjectHi:'गणित', en:'Fractions', hi:'भिन्न', icon:'🍕' },
  { id:'l3', subject:'Maths', subjectHi:'गणित', en:'Basic Geometry', hi:'आधारभूत ज्यामिति', icon:'📐' },
  { id:'s1', subject:'Science', subjectHi:'विज्ञान', en:'Plants Around Us', hi:'हमारे आसपास के पौधे', icon:'🌱' },
  { id:'s2', subject:'Science', subjectHi:'विज्ञान', en:'States of Matter', hi:'पदार्थ की अवस्थाएँ', icon:'🧊' }
];

const ATTENTION_SCORE = 0.60;
const ATTENTION_ATTEMPTS_PER_QUESTION = 2;

// ---------------------------------------------------------------------------
// Translations for the dashboard family of pages (student dashboard, teacher
// dashboard, leaderboard, student drill-down). Everything else in the app
// (syllabus, lessons, hints) already had its own bilingual text baked into
// its markup/data; this dictionary covers the dashboard chrome that was
// still English-only. `t(lang, key, vars)` looks a string up and fills in
// `{placeholders}`. Falls back to English if a key is ever missing.
// ---------------------------------------------------------------------------
const STRINGS = {
  en: {
    loadingProgress: 'Loading progress…',
    loadingClassProgress: 'Loading class progress…',
    loadingLeaderboard: 'Loading leaderboard…',
    progressUnavailable: 'Progress unavailable',
    leaderboardUnavailable: 'Leaderboard unavailable',

    studentEyebrow: 'OFFLINEORBIT · PROGRESS',
    studentHeroTitle: "{name}'s Learning Orbit",
    studentHeroSub: 'Class {classId} · Progress is stored locally on this device.',
    overall: 'overall',
    statLessonsCompleted: 'Lessons completed',
    statQuestionsSolved: 'Questions solved',
    statAverageScore: 'Average score',
    statHintEffectiveness: 'Hint effectiveness',
    studentViewEyebrow: 'STUDENT VIEW',
    myLessonProgress: 'My Lesson Progress',
    backToLessons: '← Lessons',
    classLeaderboardEyebrow: 'CLASS LEADERBOARD',
    seeHowYouRank: 'See how you rank',
    fullLeaderboard: '🏆 Full leaderboard',
    leaderboardNote: 'Ranked by lessons completed, then average score. Everything stays on this device.',
    logoutSwitch: 'Log out / Switch student',

    statusCompleted: 'Completed',
    statusInProgress: 'In progress',
    statusNotStarted: 'Not started',
    lessonRowMeta: '{done}/{total} questions · {score}% score',

    teacherEyebrow: 'OFFLINEORBIT · TEACHER',
    classOverviewTitle: 'Class Progress Overview',
    classOverviewSub: 'Monitoring every student who has logged in on this device.',
    classAvg: 'class avg',
    teacherBoardEyebrow: 'TEACHER BOARD',
    studentsAndProgress: 'Students & Progress',
    teacherPanelNote: 'Click a student to inspect question-level history. Everything stays on this device.',
    refresh: '↻ Refresh',
    exportCsv: '⇩ Export CSV',
    exportPdf: '▣ Export PDF',
    liveBadgeOn: '● Live',
    liveBadgeOff: 'Not live on this browser',
    liveBadgeTitleOn: 'Updates instantly when a student answers or raises a hand in another tab on this device — no network needed. It will not update from a different tablet across the room.',
    liveBadgeTitleOff: "This browser doesn't support live in-tab updates; use Refresh instead.",

    raisedHandsEyebrow: "RAISED HANDS",
    raisedHandsTitle: '🙋 {n} student(s) need help right now',
    raisedHandsEmpty: 'No raised hands right now. When a student taps "I\'m stuck" on a question, it will appear here instantly.',
    raisedHandResolve: '✓ Resolve',
    raisedHandQuestion: 'Q{n}',
    raisedHandUnknownLesson: 'a lesson',
    summaryStudents: 'Students',
    summaryClassCompletion: 'Class completion',
    summaryNeedsAttention: 'Needs attention',
    summaryUpdatedToday: 'Updated today',
    summaryHintEffectiveness: 'Hint effectiveness',
    summaryPartialCredit: 'Partial-credit average',

    assignmentEyebrow: "THIS WEEK'S ASSIGNMENT",
    assignmentTitle: 'Assign a lesson',
    assignmentNote: 'Pick a lesson and due date; the dashboard tracks who has finished it instead of just lifetime totals.',
    assignmentLessonLabel: 'Lesson',
    assignmentDueLabel: 'Due date',
    assignmentNone: 'No assignment',
    assignmentClearBtn: 'Clear assignment',
    assignmentNoneSet: 'No assignment set yet. Pick a lesson and due date above, then Save.',
    assignmentProgress: '{done}/{total} students completed',
    assignmentPendingSummary: 'Not yet done ({n})',
    assignmentAllDone: '🎉 Everyone has completed this assignment.',
    assignmentOverdueBadge: 'Overdue',
    assignmentDueLabelInline: 'due {date}',

    weakSpotsEyebrow: 'CLASS WEAK SPOTS',
    weakSpotsTitle: 'Where the class needs re-teaching',
    weakSpotsNote: 'Questions the class misses most on the first try, ranked highest first. Question text is stored in English only, regardless of dashboard language.',
    weakSpotsEmpty: 'Not enough attempts recorded yet to show weak spots.',
    thLesson: 'Lesson',
    thQuestion: 'Question',
    thMissedFirstTry: 'Missed on 1st try',
    thAvgAttempts: 'Avg. attempts',

    groupingEyebrow: 'TOPIC GROUPS',
    groupingTitle: 'Group students for a focused session',
    groupingNote: "Grouped automatically from each student's score and attempts on the selected lesson.",
    groupLessonLabel: 'Lesson',
    groupRemedial: 'Needs help',
    groupOnTrack: 'On track',
    groupAdvanced: 'Advanced',
    groupNotStarted: 'Not started',
    groupEmptyRemedial: 'No one needs extra help here yet.',
    groupEmptyOnTrack: 'No one in this group yet.',
    groupEmptyAdvanced: 'No one has reached advanced yet.',
    groupEmptyNotStarted: 'Everyone has started this lesson.',

    homeworkEyebrow: "THIS WEEK'S HOMEWORK",
    homeworkDue: 'Due {date}',
    homeworkDoneBadge: 'Done',
    homeworkStartBtn: 'Open lesson',
    homeworkOverdueBadge: 'Overdue — open now',

    dataSafetyEyebrow: 'DATA SAFETY',
    dataSafetyTitle: 'Backup, restore & sync',
    dataSafetyNote: "Progress lives only in this browser's storage on this device. Back it up so a reset tablet or cleared cache doesn't lose it.",
    backupBtn: '⇩ Backup all progress',
    restoreBtn: '⇪ Restore from file',
    syncBtn: '⇅ Sync now',
    syncPendingSuffix: ' ({n} pending)',
    syncEndpointLabel: 'Sync server URL',
    syncEndpointPlaceholder: 'https://your-sync-endpoint.example.com',
    saveBtn: 'Save',
    syncEndpointHelp: 'Paste any URL that accepts a POST request with JSON — including a Google Apps Script Web App URL in front of a Google Sheet.',
    neverSynced: 'Never synced online yet. ',
    lastSynced: 'Last synced {date}. ',
    recordsNotSynced: '{n} record(s) not yet synced.',
    backupPreparing: 'Preparing backup…',
    backupDone: 'Backup downloaded: {n} record(s). Keep this file somewhere off this device (email, USB drive, cloud folder).',
    backupFailed: 'Backup failed: {message}',
    restoreConfirm: 'Restore progress from this backup file?\n\nRecords already on this device will only be replaced if the backup copy is newer, so nothing recent gets lost. This cannot be undone.',
    restoring: 'Restoring backup…',
    restoreDone: 'Restore complete: {imported} record(s) restored, {skipped} skipped (already up to date on this device).',
    restoreFailed: 'Restore failed: {message}',
    restoreInvalidFile: 'This file could not be read as an OfflineOrbit backup.',
    syncNoEndpoint: 'Enter a sync server URL below, then press "Sync now".',
    syncEndpointSaved: 'Sync server saved: {endpoint}',
    syncEndpointCleared: 'Sync server URL cleared.',
    syncing: 'Syncing…',
    syncSuccess: 'Synced {n} record(s) to {endpoint}.',
    syncNothingNew: 'Already up to date — nothing new to sync.',
    syncFailed: 'Sync failed: {message}',

    searchPlaceholder: 'Search student name or class…',
    searchAriaLabel: 'Search students',
    allClasses: 'All classes',
    inactive3: 'Inactive 3+ days',
    inactive7: 'Inactive 7+ days',
    inactive14: 'Inactive 14+ days',
    inactive30: 'Inactive 30+ days',
    needsAttentionToggle: '⚠️ Needs attention ({n})',
    showAllStudents: '⚠️ Show all students',
    attentionHelp: 'Flags: average score below 60%, at least 2 attempts per question on average, or no activity for the selected number of days. Hint effectiveness = correct on the next attempt after opening a hint.',

    thStudent: 'Student',
    thClass: 'Class',
    thOverall: 'Overall',
    thAttention: 'Attention',
    thLastActive: 'Last active',
    okBadge: '✓ OK',
    noActivity: 'No activity',
    emptyStateNoStudents: 'No students match this view.',
    lessonCellNotStarted: 'Not started',
    lessonCellComplete: '{score}% · Complete',
    lessonCellProgress: '{done}/{total} questions',
    openStudentTitle: "Open {name}'s detailed history",

    reasonLowScore: 'Low score {pct}%',
    reasonHighAttempts: 'High attempts {a}/{t}',
    reasonInactive: 'No activity for {days}+ days',

    studentDetailEyebrow: 'STUDENT DETAIL',
    drilldownNote: 'Attempt-by-attempt question history stored locally on this device.',
    loadingQuestionHistory: 'Loading question history…',
    notStartedStatus: 'Not started',
    completeStatus: '✓ Complete',
    inProgressStatus: 'In progress',
    attemptWord: 'Attempt {n}',
    correctWord: 'Correct',
    incorrectWord: 'Incorrect',
    hintOpenedTag: '💡 hint opened',
    hintHelpedTag: '✨ hint helped',
    noAttempt: 'No attempt',
    attemptsRecorded: '{n} attempt(s) recorded in the current data',
    questionFallback: 'Question {n}',
    questionMeta: '{count} attempt(s) · {score}% credit · {hintStatus}',
    hintHelpedStatus: 'Hint helped',
    hintUsedStatus: 'Hint used',
    noHintStatus: 'No hint',
    logout: 'Log out',

    leaderboardEyebrow: 'OFFLINEORBIT · LEADERBOARD',
    classLeaderboardTitle: 'Class Leaderboard',
    leaderboardSub: 'Ranked by lessons completed, then average score. Progress is stored locally on this device.',
    rankingsEyebrow: 'RANKINGS',
    topLearners: 'Top learners',
    backToMyProgress: '← My Progress',
    youSuffix: '(you)',
    lessonsWord: 'lessons',
    avgScoreWord: 'avg score',
    leaderboardEmpty: 'No one has started a lesson on this device yet — be the first!'
  },
  hi: {
    loadingProgress: 'प्रगति लोड हो रही है…',
    loadingClassProgress: 'कक्षा की प्रगति लोड हो रही है…',
    loadingLeaderboard: 'लीडरबोर्ड लोड हो रहा है…',
    progressUnavailable: 'प्रगति उपलब्ध नहीं है',
    leaderboardUnavailable: 'लीडरबोर्ड उपलब्ध नहीं है',

    studentEyebrow: 'ऑफ़लाइनऑर्बिट · प्रगति',
    studentHeroTitle: '{name} की लर्निंग ऑर्बिट',
    studentHeroSub: 'कक्षा {classId} · प्रगति इसी डिवाइस पर स्थानीय रूप से सहेजी जाती है।',
    overall: 'कुल',
    statLessonsCompleted: 'पूर्ण किए गए पाठ',
    statQuestionsSolved: 'हल किए गए प्रश्न',
    statAverageScore: 'औसत स्कोर',
    statHintEffectiveness: 'संकेत प्रभावशीलता',
    studentViewEyebrow: 'छात्र दृश्य',
    myLessonProgress: 'मेरी पाठ प्रगति',
    backToLessons: '← पाठ',
    classLeaderboardEyebrow: 'कक्षा लीडरबोर्ड',
    seeHowYouRank: 'देखें आपकी रैंक क्या है',
    fullLeaderboard: '🏆 पूरा लीडरबोर्ड',
    leaderboardNote: 'पूर्ण किए गए पाठों और फिर औसत स्कोर के आधार पर रैंकिंग। सब कुछ इसी डिवाइस पर रहता है।',
    logoutSwitch: 'लॉग आउट / छात्र बदलें',

    statusCompleted: 'पूर्ण',
    statusInProgress: 'प्रगति में',
    statusNotStarted: 'शुरू नहीं हुआ',
    lessonRowMeta: '{done}/{total} प्रश्न · {score}% स्कोर',

    teacherEyebrow: 'ऑफ़लाइनऑर्बिट · शिक्षक',
    classOverviewTitle: 'कक्षा प्रगति अवलोकन',
    classOverviewSub: 'इस डिवाइस पर लॉग इन किए हर छात्र की निगरानी।',
    classAvg: 'कक्षा औसत',
    teacherBoardEyebrow: 'शिक्षक बोर्ड',
    studentsAndProgress: 'छात्र और प्रगति',
    teacherPanelNote: 'प्रश्न-स्तर का इतिहास देखने के लिए किसी छात्र पर क्लिक करें। सब कुछ इसी डिवाइस पर रहता है।',
    refresh: '↻ ताज़ा करें',
    exportCsv: '⇩ CSV निर्यात करें',
    exportPdf: '▣ PDF निर्यात करें',
    liveBadgeOn: '● लाइव',
    liveBadgeOff: 'इस ब्राउज़र पर लाइव नहीं',
    liveBadgeTitleOn: 'जब कोई छात्र इसी डिवाइस के किसी अन्य टैब में उत्तर देता है या हाथ उठाता है, तो तुरंत अपडेट होता है — इंटरनेट की ज़रूरत नहीं। यह कमरे के किसी दूसरे टैबलेट से अपडेट नहीं होगा।',
    liveBadgeTitleOff: 'यह ब्राउज़र टैब के बीच लाइव अपडेट का समर्थन नहीं करता; इसके बजाय ताज़ा करें का उपयोग करें।',

    raisedHandsEyebrow: 'उठे हुए हाथ',
    raisedHandsTitle: '🙋 {n} छात्र(छात्रों) को अभी मदद चाहिए',
    raisedHandsEmpty: 'अभी कोई हाथ नहीं उठा है। जब कोई छात्र किसी प्रश्न पर "मुझे मदद चाहिए" दबाएगा, तो यह तुरंत यहाँ दिखाई देगा।',
    raisedHandResolve: '✓ हल हो गया',
    raisedHandQuestion: 'प्रश्न {n}',
    raisedHandUnknownLesson: 'एक पाठ',
    summaryStudents: 'छात्र',
    summaryClassCompletion: 'कक्षा पूर्णता',
    summaryNeedsAttention: 'ध्यान देने योग्य',
    summaryUpdatedToday: 'आज अपडेट हुए',
    summaryHintEffectiveness: 'संकेत प्रभावशीलता',
    summaryPartialCredit: 'आंशिक-क्रेडिट औसत',

    assignmentEyebrow: 'इस सप्ताह का असाइनमेंट',
    assignmentTitle: 'एक पाठ असाइन करें',
    assignmentNote: 'एक पाठ और नियत तारीख़ चुनें; डैशबोर्ड यह ट्रैक करेगा कि किसने इसे पूरा किया, न कि केवल जीवनभर की कुल प्रगति।',
    assignmentLessonLabel: 'पाठ',
    assignmentDueLabel: 'नियत तारीख़',
    assignmentNone: 'कोई असाइनमेंट नहीं',
    assignmentClearBtn: 'असाइनमेंट हटाएँ',
    assignmentNoneSet: 'अभी तक कोई असाइनमेंट सेट नहीं है। ऊपर एक पाठ और नियत तारीख़ चुनें, फिर सहेजें।',
    assignmentProgress: '{done}/{total} छात्रों ने पूरा किया',
    assignmentPendingSummary: 'अभी तक पूरा नहीं किया ({n})',
    assignmentAllDone: '🎉 सभी ने यह असाइनमेंट पूरा कर लिया है।',
    assignmentOverdueBadge: 'समय सीमा बीत गई',
    assignmentDueLabelInline: 'नियत तारीख़ {date}',

    weakSpotsEyebrow: 'कक्षा की कमज़ोर कड़ियाँ',
    weakSpotsTitle: 'कहाँ कक्षा को दोबारा पढ़ाने की ज़रूरत है',
    weakSpotsNote: 'जिन प्रश्नों में कक्षा पहले प्रयास में सबसे ज़्यादा गलती करती है, वे सबसे ऊपर हैं। प्रश्न पाठ हमेशा अंग्रेज़ी में सहेजा जाता है, चाहे डैशबोर्ड की भाषा कोई भी हो।',
    weakSpotsEmpty: 'कमज़ोर कड़ियाँ दिखाने के लिए अभी पर्याप्त प्रयास दर्ज नहीं हुए हैं।',
    thLesson: 'पाठ',
    thQuestion: 'प्रश्न',
    thMissedFirstTry: 'पहले प्रयास में गलत',
    thAvgAttempts: 'औसत प्रयास',

    groupingEyebrow: 'विषय समूह',
    groupingTitle: 'फ़ोकस्ड सत्र के लिए छात्रों को समूहित करें',
    groupingNote: 'चुने गए पाठ पर हर छात्र के स्कोर और प्रयासों के आधार पर स्वतः समूहित।',
    groupLessonLabel: 'पाठ',
    groupRemedial: 'सहायता चाहिए',
    groupOnTrack: 'ठीक चल रहा है',
    groupAdvanced: 'उन्नत',
    groupNotStarted: 'शुरू नहीं हुआ',
    groupEmptyRemedial: 'अभी किसी को अतिरिक्त सहायता की ज़रूरत नहीं है।',
    groupEmptyOnTrack: 'अभी इस समूह में कोई नहीं है।',
    groupEmptyAdvanced: 'अभी तक कोई उन्नत स्तर तक नहीं पहुँचा है।',
    groupEmptyNotStarted: 'सभी ने यह पाठ शुरू कर दिया है।',

    homeworkEyebrow: 'इस सप्ताह का गृहकार्य',
    homeworkDue: 'नियत तारीख़ {date}',
    homeworkDoneBadge: 'पूर्ण',
    homeworkStartBtn: 'पाठ खोलें',
    homeworkOverdueBadge: 'समय सीमा बीत गई — अभी खोलें',

    dataSafetyEyebrow: 'डेटा सुरक्षा',
    dataSafetyTitle: 'बैकअप, पुनर्स्थापन और सिंक',
    dataSafetyNote: 'प्रगति केवल इस डिवाइस के ब्राउज़र स्टोरेज में सहेजी जाती है। इसे बैकअप करें ताकि टैबलेट रीसेट होने या कैश साफ़ होने पर यह न खोए।',
    backupBtn: '⇩ पूरी प्रगति बैकअप करें',
    restoreBtn: '⇪ फ़ाइल से पुनर्स्थापित करें',
    syncBtn: '⇅ अभी सिंक करें',
    syncPendingSuffix: ' ({n} लंबित)',
    syncEndpointLabel: 'सिंक सर्वर URL',
    syncEndpointPlaceholder: 'https://your-sync-endpoint.example.com',
    saveBtn: 'सहेजें',
    syncEndpointHelp: 'कोई भी ऐसा URL पेस्ट करें जो JSON के साथ POST अनुरोध स्वीकार करता हो — जिसमें Google Sheet के आगे लगा Google Apps Script Web App URL भी शामिल है।',
    neverSynced: 'अभी तक ऑनलाइन सिंक नहीं हुआ। ',
    lastSynced: 'अंतिम बार सिंक: {date}। ',
    recordsNotSynced: '{n} रिकॉर्ड अभी सिंक नहीं हुए हैं।',
    backupPreparing: 'बैकअप तैयार किया जा रहा है…',
    backupDone: 'बैकअप डाउनलोड हुआ: {n} रिकॉर्ड। इस फ़ाइल को डिवाइस से बाहर कहीं सुरक्षित रखें (ईमेल, USB ड्राइव, क्लाउड फ़ोल्डर)।',
    backupFailed: 'बैकअप विफल: {message}',
    restoreConfirm: 'इस बैकअप फ़ाइल से प्रगति पुनर्स्थापित करें?\n\nडिवाइस पर मौजूद रिकॉर्ड तभी बदले जाएंगे जब बैकअप कॉपी नई हो, इसलिए हाल की कोई जानकारी नहीं खोएगी। यह पूर्ववत नहीं किया जा सकता।',
    restoring: 'बैकअप पुनर्स्थापित किया जा रहा है…',
    restoreDone: 'पुनर्स्थापन पूर्ण: {imported} रिकॉर्ड पुनर्स्थापित, {skipped} छोड़े गए (डिवाइस पर पहले से अपडेट)।',
    restoreFailed: 'पुनर्स्थापन विफल: {message}',
    restoreInvalidFile: 'यह फ़ाइल OfflineOrbit बैकअप के रूप में नहीं पढ़ी जा सकी।',
    syncNoEndpoint: 'नीचे सिंक सर्वर URL दर्ज करें, फिर "अभी सिंक करें" दबाएँ।',
    syncEndpointSaved: 'सिंक सर्वर सहेजा गया: {endpoint}',
    syncEndpointCleared: 'सिंक सर्वर URL हटाया गया।',
    syncing: 'सिंक हो रहा है…',
    syncSuccess: '{n} रिकॉर्ड {endpoint} पर सिंक हुए।',
    syncNothingNew: 'पहले से अद्यतन है — सिंक करने के लिए कुछ नया नहीं है।',
    syncFailed: 'सिंक विफल: {message}',

    searchPlaceholder: 'छात्र का नाम या कक्षा खोजें…',
    searchAriaLabel: 'छात्र खोजें',
    allClasses: 'सभी कक्षाएँ',
    inactive3: 'निष्क्रिय 3+ दिन',
    inactive7: 'निष्क्रिय 7+ दिन',
    inactive14: 'निष्क्रिय 14+ दिन',
    inactive30: 'निष्क्रिय 30+ दिन',
    needsAttentionToggle: '⚠️ ध्यान देने योग्य ({n})',
    showAllStudents: '⚠️ सभी छात्र दिखाएँ',
    attentionHelp: 'फ़्लैग: औसत स्कोर 60% से कम, प्रति प्रश्न औसतन कम से कम 2 प्रयास, या चुने गए दिनों तक कोई गतिविधि नहीं। संकेत प्रभावशीलता = संकेत खोलने के बाद अगले प्रयास में सही उत्तर।',

    thStudent: 'छात्र',
    thClass: 'कक्षा',
    thOverall: 'कुल',
    thAttention: 'ध्यान',
    thLastActive: 'अंतिम सक्रियता',
    okBadge: '✓ ठीक है',
    noActivity: 'कोई गतिविधि नहीं',
    emptyStateNoStudents: 'इस दृश्य से मेल खाने वाला कोई छात्र नहीं है।',
    lessonCellNotStarted: 'शुरू नहीं हुआ',
    lessonCellComplete: '{score}% · पूर्ण',
    lessonCellProgress: '{done}/{total} प्रश्न',
    openStudentTitle: '{name} का विस्तृत इतिहास खोलें',

    reasonLowScore: 'कम स्कोर {pct}%',
    reasonHighAttempts: 'अधिक प्रयास {a}/{t}',
    reasonInactive: '{days}+ दिनों से कोई गतिविधि नहीं',

    studentDetailEyebrow: 'छात्र विवरण',
    drilldownNote: 'हर प्रयास का प्रश्न इतिहास इसी डिवाइस पर स्थानीय रूप से सहेजा गया है।',
    loadingQuestionHistory: 'प्रश्न इतिहास लोड हो रहा है…',
    notStartedStatus: 'शुरू नहीं हुआ',
    completeStatus: '✓ पूर्ण',
    inProgressStatus: 'प्रगति में',
    attemptWord: 'प्रयास {n}',
    correctWord: 'सही',
    incorrectWord: 'गलत',
    hintOpenedTag: '💡 संकेत खोला गया',
    hintHelpedTag: '✨ संकेत सहायक रहा',
    noAttempt: 'कोई प्रयास नहीं',
    attemptsRecorded: '{n} प्रयास वर्तमान डेटा में दर्ज हैं',
    questionFallback: 'प्रश्न {n}',
    questionMeta: '{count} प्रयास · {score}% क्रेडिट · {hintStatus}',
    hintHelpedStatus: 'संकेत सहायक रहा',
    hintUsedStatus: 'संकेत उपयोग किया गया',
    noHintStatus: 'कोई संकेत नहीं',
    logout: 'लॉग आउट',

    leaderboardEyebrow: 'ऑफ़लाइनऑर्बिट · लीडरबोर्ड',
    classLeaderboardTitle: 'कक्षा लीडरबोर्ड',
    leaderboardSub: 'पूर्ण किए गए पाठों और फिर औसत स्कोर के आधार पर रैंकिंग। प्रगति इसी डिवाइस पर स्थानीय रूप से सहेजी जाती है।',
    rankingsEyebrow: 'रैंकिंग',
    topLearners: 'शीर्ष शिक्षार्थी',
    backToMyProgress: '← मेरी प्रगति',
    youSuffix: '(आप)',
    lessonsWord: 'पाठ',
    avgScoreWord: 'औसत स्कोर',
    leaderboardEmpty: 'इस डिवाइस पर अभी तक किसी ने पाठ शुरू नहीं किया — पहले आप बनें!'
  }
};

function t(lang, key, vars) {
  const dict = STRINGS[lang] || STRINGS.en;
  let str = dict[key] ?? STRINGS.en[key] ?? key;
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => { str = str.replaceAll(`{${k}}`, v); });
  }
  return str;
}

function currentLang() {
  return localStorage.getItem('preferredLang') === 'hi' ? 'hi' : 'en';
}

// The login form only has a name + class ID field. A student who logs in
// with the name "teacher" (any case) is treated as the teacher and gets the
// class-wide dashboard instead of a personal one.
function isTeacherLogin(student) {
  return !!student && String(student.name).trim().toLowerCase() === 'teacher';
}

export async function renderDashboard(container, currentStudent) {
  if (isTeacherLogin(currentStudent)) {
    return renderTeacherDashboard(container, currentStudent);
  }
  return renderStudentDashboard(container, currentStudent);
}

function bindLogout(container) {
  const btn = container.querySelector('#logout-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    localStorage.removeItem('offlineOrbitUser');
    window.location.hash = '';
    window.location.reload();
  });
}

async function renderStudentDashboard(container, currentStudent) {
  const lang = currentLang();
  container.innerHTML = `<div class="lesson-loading"><div class="spinner"></div><p>${t(lang, 'loadingProgress')}</p></div>`;

  try {
    const records = await getAllProgress();
    const mine = records.filter(r => r.studentId === currentStudent.studentId);
    const completed = mine.filter(r => r.completed).length;
    const overall = Math.round((completed / LESSONS.length) * 100);
    const solved = mine.reduce((n,r)=>n+(r.completedQuestions?.length||0),0);

    container.innerHTML = `
      <section class="dashboard-page">
        <div class="dashboard-hero">
          <div>
            <span class="eyebrow">${t(lang,'studentEyebrow')}</span>
            <h2>${t(lang,'studentHeroTitle',{name:escapeHtml(currentStudent.name)})}</h2>
            <p>${t(lang,'studentHeroSub',{classId:escapeHtml(currentStudent.classId)})}</p>
          </div>
          <div class="big-progress"><strong>${overall}%</strong><span>${t(lang,'overall')}</span></div>
        </div>

        ${renderHomeworkBanner(mine, lang)}

        <div class="stats-grid">
          <div class="stat-card"><span>📚</span><strong>${completed}/${LESSONS.length}</strong><small>${t(lang,'statLessonsCompleted')}</small></div>
          <div class="stat-card"><span>🧩</span><strong>${solved}</strong><small>${t(lang,'statQuestionsSolved')}</small></div>
          <div class="stat-card"><span>🎯</span><strong>${mine.length ? Math.round((mine.reduce((a,r)=>a+(r.score||0),0)/mine.length)*100) : 0}%</strong><small>${t(lang,'statAverageScore')}</small></div>
          <div class="stat-card"><span>💡</span><strong>${formatHintStats(mine).effectiveness}%</strong><small>${t(lang,'statHintEffectiveness')}</small></div>
        </div>

        <section class="progress-panel">
          <div class="panel-heading"><div><span class="eyebrow dark">${t(lang,'studentViewEyebrow')}</span><h3>${t(lang,'myLessonProgress')}</h3></div><a class="secondary-btn" href="#/syllabus">${t(lang,'backToLessons')}</a></div>
          <div class="progress-list">${LESSONS.map(l=>renderLessonRow(l,mine.find(r=>r.lessonId===l.id),lang)).join('')}</div>
        </section>

        <section class="progress-panel">
          <div class="panel-heading"><div><span class="eyebrow dark">${t(lang,'classLeaderboardEyebrow')}</span><h3>${t(lang,'seeHowYouRank')}</h3></div><a class="secondary-btn" href="#/leaderboard">${t(lang,'fullLeaderboard')}</a></div>
          <p class="panel-note">${t(lang,'leaderboardNote')}</p>
        </section>

        <button class="secondary-btn logout-dashboard" id="logout-btn">${t(lang,'logoutSwitch')}</button>
      </section>
    `;

    bindLogout(container);
  } catch (error) {
    container.innerHTML = `<div class="error-box"><div class="error-icon">!</div><h2>${t(lang,'progressUnavailable')}</h2><p class="error-detail">${escapeHtml(error.message)}</p></div>`;
  }
}

function teacherSummaryHtml(students, records, attention, lang) {
  const classCompletion = students.length ? Math.round((records.filter(r=>r.completed).length / (students.length*LESSONS.length))*100) : 0;
  return `
    <div><span>👥</span><strong>${students.length}</strong><small>${t(lang,'summaryStudents')}</small></div>
    <div><span>🏆</span><strong>${classCompletion}%</strong><small>${t(lang,'summaryClassCompletion')}</small></div>
    <div><span>⚠️</span><strong>${attention.length}</strong><small>${t(lang,'summaryNeedsAttention')}</small></div>
    <div><span>⚡</span><strong>${records.filter(r=>r.timestamp && new Date(r.timestamp).toDateString()===new Date().toDateString()).length}</strong><small>${t(lang,'summaryUpdatedToday')}</small></div>
    <div><span>💡</span><strong>${formatHintStats(records).effectiveness}%</strong><small>${t(lang,'summaryHintEffectiveness')}</small></div>
    <div><span>🧩</span><strong>${formatHintStats(records).partialCredit}%</strong><small>${t(lang,'summaryPartialCredit')}</small></div>
  `;
}

async function renderTeacherDashboard(container, currentStudent) {
  const lang = currentLang();
  container.innerHTML = `<div class="lesson-loading"><div class="spinner"></div><p>${t(lang,'loadingClassProgress')}</p></div>`;

  // Re-rendering the board (route change, manual refresh, language toggle)
  // means any previous live subscription is about to be orphaned — tear it
  // down before this render sets up its own.
  teardownLiveTeacherBoard?.();
  teardownLiveTeacherBoard = null;

  try {
    let records = await getAllProgress();
    let students = await getAllStudents();
    const attentionDays = Number(localStorage.getItem('teacherAttentionDays') || 7);
    let attention = students.filter(s => getAttentionReasons(s, records, attentionDays, lang).length);
    const classCompletion = students.length ? Math.round((records.filter(r=>r.completed).length / (students.length*LESSONS.length))*100) : 0;
    const pendingSync = records.filter(r => !r.synced).length;
    const lastSyncAt = localStorage.getItem(LAST_SYNC_KEY);
    const savedEndpoint = localStorage.getItem(SYNC_ENDPOINT_KEY) || '';

    container.innerHTML = `
      <section class="dashboard-page">
        <div class="dashboard-hero">
          <div>
            <span class="eyebrow">${t(lang,'teacherEyebrow')}</span>
            <h2>${t(lang,'classOverviewTitle')}</h2>
            <p>${t(lang,'classOverviewSub')}</p>
          </div>
          <div class="big-progress"><strong id="class-avg-value">${classCompletion}%</strong><span>${t(lang,'classAvg')}</span></div>
        </div>

        <div id="raised-hands-container">${raisedHandsHtml(getRaisedHands(), lang)}</div>

        <section class="teacher-panel" id="teacher-board">
          <div class="teacher-header">
            <div>
              <span class="eyebrow dark">${t(lang,'teacherBoardEyebrow')}</span>
              <h3>${t(lang,'studentsAndProgress')}</h3>
              <p class="panel-note">${t(lang,'teacherPanelNote')}</p>
            </div>
            <div class="teacher-header-actions">
              <span class="live-badge ${LIVE_UPDATES_SUPPORTED ? 'live-badge-on' : 'live-badge-off'}" title="${LIVE_UPDATES_SUPPORTED ? t(lang,'liveBadgeTitleOn') : t(lang,'liveBadgeTitleOff')}">${LIVE_UPDATES_SUPPORTED ? t(lang,'liveBadgeOn') : t(lang,'liveBadgeOff')}</span>
              <button class="secondary-btn" id="refresh-teacher">${t(lang,'refresh')}</button>
              <button class="primary-btn" id="export-csv">${t(lang,'exportCsv')}</button>
              <button class="secondary-btn" id="export-pdf">${t(lang,'exportPdf')}</button>
            </div>
          </div>

          <div class="teacher-summary" id="teacher-summary">${teacherSummaryHtml(students, records, attention, lang)}</div>

          <div id="assignment-panel-container">${renderAssignmentPanel(students, records, lang)}</div>

          <div id="weak-spots-panel-container">${renderWeakSpotsPanel(records, lang)}</div>

          <div id="grouping-panel-container">${renderGroupingPanel(students, records, lang)}</div>

          <section class="data-safety-panel">
            <div class="data-safety-head">
              <div>
                <span class="eyebrow dark">${t(lang,'dataSafetyEyebrow')}</span>
                <h3>${t(lang,'dataSafetyTitle')}</h3>
                <p class="panel-note">${t(lang,'dataSafetyNote')}</p>
              </div>
            </div>
            <div class="data-safety-actions">
              <button type="button" class="secondary-btn" id="backup-btn">${t(lang,'backupBtn')}</button>
              <button type="button" class="secondary-btn" id="restore-btn">${t(lang,'restoreBtn')}</button>
              <input type="file" id="restore-file-input" accept="application/json" hidden>
              <button type="button" class="secondary-btn" id="sync-btn">${t(lang,'syncBtn')}${pendingSync ? t(lang,'syncPendingSuffix',{n:pendingSync}) : ''}</button>
            </div>
            <div class="sync-endpoint-row">
              <label for="sync-endpoint-input">${t(lang,'syncEndpointLabel')}</label>
              <input type="url" id="sync-endpoint-input" placeholder="${t(lang,'syncEndpointPlaceholder')}" value="${escapeHtml(savedEndpoint)}">
              <button type="button" class="secondary-btn" id="sync-endpoint-save">${t(lang,'saveBtn')}</button>
            </div>
            <p class="sync-endpoint-help">${t(lang,'syncEndpointHelp')}</p>
            <p class="data-safety-note" id="data-safety-status">${lastSyncAt ? t(lang,'lastSynced',{date:formatDate(lastSyncAt)}) : t(lang,'neverSynced')}${t(lang,'recordsNotSynced',{n:pendingSync})}</p>
          </section>

          <div class="teacher-toolbar">
            <input id="teacher-search" type="search" placeholder="${t(lang,'searchPlaceholder')}" aria-label="${t(lang,'searchAriaLabel')}">
            <select id="teacher-class"><option value="">${t(lang,'allClasses')}</option>${[...new Set(students.map(s=>s.classId).filter(Boolean))].sort().map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select>
            <select id="teacher-attention-days" title="${t(lang,'attentionHelp')}"><option value="3">${t(lang,'inactive3')}</option><option value="7">${t(lang,'inactive7')}</option><option value="14">${t(lang,'inactive14')}</option><option value="30">${t(lang,'inactive30')}</option></select>
            <button type="button" class="attention-toggle secondary-btn" id="attention-toggle">${t(lang,'needsAttentionToggle',{n:attention.length})}</button>
          </div>
          <p class="attention-help">${t(lang,'attentionHelp')}</p>

          <div id="teacher-table-container">${renderTeacherTable(students, records, lang, attentionDays, false)}</div>
        </section>

        <button class="secondary-btn logout-dashboard" id="logout-btn">${t(lang,'logout')}</button>
      </section>
    `;

    document.getElementById('teacher-attention-days').value = String(attentionDays);
    let attentionOnly = false;

    const refresh = document.getElementById('refresh-teacher');
    refresh.addEventListener('click', () => renderTeacherDashboard(container, currentStudent));

    const search = document.getElementById('teacher-search');
    const classFilter = document.getElementById('teacher-class');
    const attentionDaysSelect = document.getElementById('teacher-attention-days');
    const attentionToggle = document.getElementById('attention-toggle');

    const updateTable = () => {
      const q = search.value.trim().toLowerCase();
      const cls = classFilter.value;
      const days = Number(attentionDaysSelect.value || 7);
      localStorage.setItem('teacherAttentionDays', String(days));
      const filtered = students.filter(s =>
        (!q || `${s.name} ${s.classId}`.toLowerCase().includes(q)) &&
        (!cls || s.classId === cls) &&
        (!attentionOnly || getAttentionReasons(s, records, days, lang).length)
      );
      document.getElementById('teacher-table-container').innerHTML = renderTeacherTable(filtered, records, lang, days, attentionOnly);
      bindStudentRows(document.getElementById('teacher-table-container'), records, lang);
      attentionToggle.textContent = attentionOnly
        ? t(lang,'showAllStudents')
        : t(lang,'needsAttentionToggle',{n:students.filter(s => getAttentionReasons(s, records, days, lang).length).length});
    };
    search.addEventListener('input', updateTable);
    classFilter.addEventListener('change', updateTable);
    attentionDaysSelect.addEventListener('change', updateTable);
    attentionToggle.addEventListener('click', () => { attentionOnly = !attentionOnly; updateTable(); });

    bindStudentRows(document.getElementById('teacher-table-container'), records, lang);
    document.getElementById('export-csv').addEventListener('click', () => exportClassCSV(students, records));
    document.getElementById('export-pdf').addEventListener('click', () => exportClassPDF(students, records, attentionDaysSelect.value));

    bindDataSafetyControls(container, lang, () => renderTeacherDashboard(container, currentStudent));

    bindAssignmentControls(container, students, records, lang, () => renderTeacherDashboard(container, currentStudent));
    bindGroupingControls(container, students, records, lang);

    bindRaisedHandsControls(container, () => renderRaisedHandsPanel());

    bindLogout(container);

    // --- Live updates -----------------------------------------------------
    // Refreshes just the panels that can change from another tab on this
    // device (a student answering, a hand raised/lowered) — never the
    // search box, class filter or attention-days the teacher is using, so a
    // live update never yanks the board out from under them mid-search.
    function renderRaisedHandsPanel() {
      const wrap = document.getElementById('raised-hands-container');
      if (!wrap) return;
      wrap.innerHTML = raisedHandsHtml(getRaisedHands(), lang);
      bindRaisedHandsControls(container, () => renderRaisedHandsPanel());
    }

    let liveRefreshInFlight = false;
    async function refreshProgressPanels() {
      if (liveRefreshInFlight) return;
      liveRefreshInFlight = true;
      try {
        records = await getAllProgress();
        students = await getAllStudents();
        const days = Number(attentionDaysSelect.value || attentionDays);
        attention = students.filter(s => getAttentionReasons(s, records, days, lang).length);

        const avgEl = document.getElementById('class-avg-value');
        if (avgEl) avgEl.textContent = `${students.length ? Math.round((records.filter(r=>r.completed).length / (students.length*LESSONS.length))*100) : 0}%`;

        const summaryEl = document.getElementById('teacher-summary');
        if (summaryEl) summaryEl.innerHTML = teacherSummaryHtml(students, records, attention, lang);

        const assignWrap = document.getElementById('assignment-panel-container');
        if (assignWrap) {
          assignWrap.innerHTML = renderAssignmentPanel(students, records, lang);
          bindAssignmentControls(container, students, records, lang, () => renderTeacherDashboard(container, currentStudent));
        }

        const weakWrap = document.getElementById('weak-spots-panel-container');
        if (weakWrap) weakWrap.innerHTML = renderWeakSpotsPanel(records, lang);

        const groupWrap = document.getElementById('grouping-panel-container');
        if (groupWrap) {
          groupWrap.innerHTML = renderGroupingPanel(students, records, lang);
          bindGroupingControls(container, students, records, lang);
        }

        updateTable();
      } catch (error) {
        console.warn('Live Teacher Board update failed', error);
      } finally {
        liveRefreshInFlight = false;
      }
    }

    const unsubscribeProgress = onProgressUpdate(() => { refreshProgressPanels(); });
    const unsubscribeHands = onHandsChanged(() => { renderRaisedHandsPanel(); });
    teardownLiveTeacherBoard = () => { unsubscribeProgress(); unsubscribeHands(); };
  } catch (error) {
    container.innerHTML = `<div class="error-box"><div class="error-icon">!</div><h2>${t(lang,'progressUnavailable')}</h2><p class="error-detail">${escapeHtml(error.message)}</p></div>`;
  }
}

// Student-facing leaderboard: ranks every student who has logged in on this
// device by lessons completed, then average score. The current student's row
// is highlighted. Teachers don't have a row here and never see this page.
export async function renderLeaderboard(container, currentStudent) {
  const lang = currentLang();
  container.innerHTML = `<div class="lesson-loading"><div class="spinner"></div><p>${t(lang,'loadingLeaderboard')}</p></div>`;

  try {
    const records = await getAllProgress();
    const students = await getAllStudents();

    const ranked = students
      .map(s => {
        const mine = records.filter(r => r.studentId === s.studentId);
        const completed = mine.filter(r => r.completed).length;
        const scored = mine.filter(r => typeof r.score === 'number');
        const avgScore = scored.length ? scored.reduce((a,r)=>a+r.score,0)/scored.length : 0;
        return { ...s, completed, avgScore, overall: Math.round((completed/LESSONS.length)*100) };
      })
      .sort((a,b) => b.completed - a.completed || b.avgScore - a.avgScore || a.name.localeCompare(b.name));

    const medal = (rank) => rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `#${rank+1}`;

    container.innerHTML = `
      <section class="dashboard-page">
        <div class="dashboard-hero">
          <div>
            <span class="eyebrow">${t(lang,'leaderboardEyebrow')}</span>
            <h2>${t(lang,'classLeaderboardTitle')}</h2>
            <p>${t(lang,'leaderboardSub')}</p>
          </div>
        </div>

        <section class="progress-panel leaderboard-panel">
          <div class="panel-heading"><div><span class="eyebrow dark">${t(lang,'rankingsEyebrow')}</span><h3>${t(lang,'topLearners')}</h3></div><a class="secondary-btn" href="#/dashboard">${t(lang,'backToMyProgress')}</a></div>
          ${ranked.length ? `<ol class="leaderboard-list">${ranked.map((s, i) => `
            <li class="leaderboard-row${s.studentId === currentStudent.studentId ? ' is-you' : ''}${i < 3 ? ' is-top' : ''}">
              <span class="leaderboard-rank">${medal(i)}</span>
              <span class="leaderboard-avatar">${escapeHtml(s.name.charAt(0).toUpperCase())}</span>
              <span class="leaderboard-name">${escapeHtml(s.name)}${s.studentId === currentStudent.studentId ? ` <em>${t(lang,'youSuffix')}</em>` : ''}<small>${t(lang,'thClass')} ${escapeHtml(s.classId || '—')}</small></span>
              <span class="leaderboard-stat"><strong>${s.completed}/${LESSONS.length}</strong><small>${t(lang,'lessonsWord')}</small></span>
              <span class="leaderboard-stat"><strong>${Math.round(s.avgScore*100)}%</strong><small>${t(lang,'avgScoreWord')}</small></span>
            </li>`).join('')}</ol>` : `<div class="empty-state">${t(lang,'leaderboardEmpty')}</div>`}
        </section>

        <button class="secondary-btn logout-dashboard" id="logout-btn">${t(lang,'logoutSwitch')}</button>
      </section>
    `;

    bindLogout(container);
  } catch (error) {
    container.innerHTML = `<div class="error-box"><div class="error-icon">!</div><h2>${t(lang,'leaderboardUnavailable')}</h2><p class="error-detail">${escapeHtml(error.message)}</p></div>`;
  }
}

function renderLessonRow(lesson, record, lang) {
  const done = record?.completedQuestions?.length || 0;
  const total = record?.totalQuestions || 6;
  const percent = record?.completed ? 100 : Math.round((done/total)*100);
  const status = record?.completed ? t(lang,'statusCompleted') : record ? t(lang,'statusInProgress') : t(lang,'statusNotStarted');
  const meta = t(lang,'lessonRowMeta',{done, total, score: record ? Math.round((record.score||0)*100) : 0});
  return `<div class="progress-row"><div class="progress-icon">${lesson.icon}</div><div class="progress-main"><div class="progress-title"><strong>${lesson[lang]}</strong><span>${status}</span></div><div class="bar"><i style="width:${percent}%"></i></div><small>${meta}</small></div></div>`;
}

function renderTeacherTable(students, records, lang, attentionDays, attentionOnly) {
  if (!students.length) return `<div class="empty-state">${t(lang,'emptyStateNoStudents')}</div>`;
  return `<div class="table-wrap"><table class="teacher-table"><thead><tr><th>${t(lang,'thStudent')}</th><th>${t(lang,'thClass')}</th><th>${t(lang,'thOverall')}</th><th>${t(lang,'thAttention')}</th>${LESSONS.map(l=>`<th>${l.icon} ${lang==='hi'?l.subjectHi:l.subject}<br><small>${l[lang]}</small></th>`).join('')}<th>${t(lang,'thLastActive')}</th></tr></thead><tbody>${students.map(student => {
    const mine=records.filter(r=>r.studentId===student.studentId);
    const done=mine.filter(r=>r.completed).length;
    const overall=Math.round(done/LESSONS.length*100);
    const latest=mine.map(r=>r.timestamp).filter(Boolean).sort().at(-1);
    const reasons=getAttentionReasons(student, records, attentionDays, lang);
    return `<tr class="student-row" data-student-id="${escapeHtml(student.studentId)}" tabindex="0" title="${escapeHtml(t(lang,'openStudentTitle',{name:student.name}))}">
      <td><div class="teacher-student"><span class="teacher-avatar">${escapeHtml(student.name.charAt(0).toUpperCase())}</span><button type="button" class="student-link" data-student-id="${escapeHtml(student.studentId)}">${escapeHtml(student.name)}</button></div></td>
      <td><span class="class-pill">${escapeHtml(student.classId||'—')}</span></td>
      <td><strong>${overall}%</strong><div class="mini-bar"><i style="width:${overall}%"></i></div></td>
      <td>${reasons.length ? `<span class="attention-badge">⚠️ ${reasons.length}</span><small>${escapeHtml(reasons[0])}</small>` : `<span class="ok-badge">${t(lang,'okBadge')}</span>`}</td>
      ${LESSONS.map(l=>renderLessonCell(mine.find(r=>r.lessonId===l.id), lang)).join('')}
      <td class="last-active">${latest ? formatDate(latest) : t(lang,'noActivity')}</td>
    </tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderLessonCell(record, lang){
  if(!record) return `<td><span class="status-dot status-none">—</span><small>${t(lang,'lessonCellNotStarted')}</small></td>`;
  const done=record.completedQuestions?.length||0, total=record.totalQuestions||6;
  if(record.completed) return `<td><span class="status-dot status-done">✓</span><small>${t(lang,'lessonCellComplete',{score:Math.round((record.score||0)*100)})}</small></td>`;
  return `<td><span class="status-dot status-progress">${Math.round(done/total*100)}%</span><small>${t(lang,'lessonCellProgress',{done,total})}</small></td>`;
}

function formatHintStats(records) {
  const list = Array.isArray(records) ? records : [];
  let opened = 0, helped = 0, completed = 0, creditTotal = 0;
  list.forEach(record => {
    const usage = record.hintUsage || {};
    const help = record.hintHelped || {};
    Object.values(usage).forEach(v => { if (v) opened += 1; });
    Object.values(help).forEach(v => { if (v) helped += 1; });
    const scores = record.questionScores || {};
    Object.entries(scores).forEach(([index, value]) => {
      if (record.completedQuestions?.includes(Number(index)) && typeof value === 'number') {
        completed += 1;
        creditTotal += value;
      }
    });
  });
  return {
    effectiveness: opened ? Math.round((helped / opened) * 100) : 0,
    partialCredit: completed ? Math.round((creditTotal / completed) * 100) : 0,
    opened,
    helped
  };
}

// ---------------------------------------------------------------------------
// Question-level analytics ("Class Weak Spots")
//
// The teacher table aggregates by student; this aggregates the other way —
// by question — using the attemptHistory each progress record already
// stores (one entry per attempt, with a `correct` flag and timestamp). For
// every lesson+question pair seen across any student's record, this counts
// how many students attempted it and how many of them got it wrong on their
// very first try, which is a much stronger "re-teach this" signal than raw
// attempt counts. Question text is pulled from questionDetails, which is
// always saved in English (see lesson-runtime.js), so it does not change
// with the dashboard's language toggle.
// ---------------------------------------------------------------------------
function computeQuestionAnalytics(records) {
  const byQuestion = new Map();

  records.forEach((record) => {
    const details = record.questionDetails || {};
    const history = record.attemptHistory || {};
    const total = record.totalQuestions || Object.keys(details).length || 0;

    for (let i = 0; i < total; i++) {
      const attempts = history[i] || [];
      if (!attempts.length) continue; // never attempted, nothing to learn from

      const key = `${record.lessonId}::${i}`;
      if (!byQuestion.has(key)) {
        byQuestion.set(key, {
          lessonId: record.lessonId,
          index: i,
          questionText: details[i]?.question || `Question ${i + 1}`,
          attemptedCount: 0,
          wrongFirstTryCount: 0,
          totalAttemptsSum: 0
        });
      }
      const agg = byQuestion.get(key);
      agg.attemptedCount += 1;
      agg.totalAttemptsSum += attempts.length;
      if (attempts[0]?.correct === false) agg.wrongFirstTryCount += 1;
    }
  });

  return Array.from(byQuestion.values())
    .map((agg) => ({
      ...agg,
      wrongFirstTryPct: agg.attemptedCount ? Math.round((agg.wrongFirstTryCount / agg.attemptedCount) * 100) : 0,
      avgAttempts: agg.attemptedCount ? Number((agg.totalAttemptsSum / agg.attemptedCount).toFixed(1)) : 0
    }))
    .sort((a, b) => b.wrongFirstTryPct - a.wrongFirstTryPct || b.attemptedCount - a.attemptedCount);
}

function renderWeakSpotsPanel(records, lang) {
  const top = computeQuestionAnalytics(records).filter((a) => a.wrongFirstTryCount > 0).slice(0, 8);
  const head = `<div class="panel-heading"><div><span class="eyebrow dark">${t(lang,'weakSpotsEyebrow')}</span><h3>${t(lang,'weakSpotsTitle')}</h3><p class="panel-note">${t(lang,'weakSpotsNote')}</p></div></div>`;

  if (!top.length) {
    return `<section class="weak-spots-panel">${head}<div class="empty-state">${t(lang,'weakSpotsEmpty')}</div></section>`;
  }

  const rows = top.map((a) => {
    const lesson = LESSONS.find((l) => l.id === a.lessonId);
    const lessonLabel = lesson ? `${lesson.icon} ${lesson[lang]}` : a.lessonId;
    return `<tr><td>${escapeHtml(lessonLabel)}</td><td class="weak-spot-question">${escapeHtml(a.questionText)}</td><td><strong>${a.wrongFirstTryPct}%</strong><small> (${a.wrongFirstTryCount}/${a.attemptedCount})</small></td><td>${a.avgAttempts}</td></tr>`;
  }).join('');

  return `<section class="weak-spots-panel">${head}<div class="table-wrap"><table class="teacher-table weak-spots-table"><thead><tr><th>${t(lang,'thLesson')}</th><th>${t(lang,'thQuestion')}</th><th>${t(lang,'thMissedFirstTry')}</th><th>${t(lang,'thAvgAttempts')}</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

// ---------------------------------------------------------------------------
// Automatic grouping ("Topic Groups")
//
// Turns the per-student "needs attention" flag into three named bands per
// lesson, plus a "not started" bucket, so a teacher can pull a small group
// for a focused re-teach instead of reading the whole class table row by
// row. Bands are based on the same score used for CSV/PDF export and the
// attention flag: a completed run below GROUP_ONTRACK_SCORE, or an
// in-progress run already averaging 2+ attempts per question, counts as
// needing help.
// ---------------------------------------------------------------------------
function computeLessonGroups(lessonId, students, records) {
  const groups = { remedial: [], onTrack: [], advanced: [], notStarted: [] };

  students.forEach((student) => {
    const record = records.find((r) => r.studentId === student.studentId && r.lessonId === lessonId);
    if (!record) { groups.notStarted.push({ student, record: null }); return; }

    const score = typeof record.score === 'number' ? record.score : 0;
    const total = record.totalQuestions || 0;
    const attemptsPerQuestion = total ? (record.attempts || 0) / total : 0;

    if (record.completed && score >= GROUP_ADVANCED_SCORE) groups.advanced.push({ student, record });
    else if (record.completed && score >= GROUP_ONTRACK_SCORE) groups.onTrack.push({ student, record });
    else if (record.completed) groups.remedial.push({ student, record });
    else if (attemptsPerQuestion >= ATTENTION_ATTEMPTS_PER_QUESTION) groups.remedial.push({ student, record });
    else groups.onTrack.push({ student, record });
  });

  return groups;
}

function renderGroupingPanel(students, records, lang, selectedLessonId) {
  const lessonId = LESSONS.some((l) => l.id === selectedLessonId) ? selectedLessonId : LESSONS[0].id;
  const groups = computeLessonGroups(lessonId, students, records);
  const lessonOptions = LESSONS.map((l) => `<option value="${l.id}" ${l.id === lessonId ? 'selected' : ''}>${l.icon} ${l[lang]}</option>`).join('');

  const renderList = (list, emptyKey) => list.length
    ? `<ul class="group-list">${list.map(({ student, record }) => `<li><span>${escapeHtml(student.name)}</span>${record ? `<small>${Math.round((record.score||0)*100)}%</small>` : ''}</li>`).join('')}</ul>`
    : `<p class="group-empty">${t(lang, emptyKey)}</p>`;

  return `<section class="grouping-panel">
    <div class="panel-heading">
      <div><span class="eyebrow dark">${t(lang,'groupingEyebrow')}</span><h3>${t(lang,'groupingTitle')}</h3><p class="panel-note">${t(lang,'groupingNote')}</p></div>
      <select id="grouping-lesson-select" aria-label="${t(lang,'groupLessonLabel')}">${lessonOptions}</select>
    </div>
    <div class="group-columns">
      <div class="group-column group-remedial"><h4>🔴 ${t(lang,'groupRemedial')} · ${groups.remedial.length}</h4>${renderList(groups.remedial,'groupEmptyRemedial')}</div>
      <div class="group-column group-ontrack"><h4>🟡 ${t(lang,'groupOnTrack')} · ${groups.onTrack.length}</h4>${renderList(groups.onTrack,'groupEmptyOnTrack')}</div>
      <div class="group-column group-advanced"><h4>🟢 ${t(lang,'groupAdvanced')} · ${groups.advanced.length}</h4>${renderList(groups.advanced,'groupEmptyAdvanced')}</div>
      <div class="group-column group-notstarted"><h4>⚪ ${t(lang,'groupNotStarted')} · ${groups.notStarted.length}</h4>${renderList(groups.notStarted,'groupEmptyNotStarted')}</div>
    </div>
  </section>`;
}

function bindGroupingControls(container, students, records, lang) {
  const wrap = container.querySelector('#grouping-panel-container');
  wrap?.querySelector('#grouping-lesson-select')?.addEventListener('change', (e) => {
    wrap.innerHTML = renderGroupingPanel(students, records, lang, e.target.value);
    bindGroupingControls(container, students, records, lang);
  });
}

// ---------------------------------------------------------------------------
// Assign / due-date mode
//
// A single "this week's assignment" (one lesson + optional due date) is
// stored in localStorage, since it's a teacher-wide setting for this device
// rather than per-student progress data. The teacher board shows completion
// against it; the student dashboard shows a homework banner for it.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Raised hands — "I'm stuck" buttons in the lesson runtime write here (via
// src/shared/live-signal.js), and this panel shows them to the teacher, live
// if a Teacher Board tab is already open on the same device (BroadcastChannel,
// no network) and immediately on load either way (localStorage-backed).
// ---------------------------------------------------------------------------
function raisedHandsHtml(hands, lang) {
  if (!hands.length) {
    return `<section class="raised-hands-panel raised-hands-empty">
      <span class="eyebrow dark">${t(lang,'raisedHandsEyebrow')}</span>
      <p class="panel-note">${t(lang,'raisedHandsEmpty')}</p>
    </section>`;
  }

  const items = hands
    .slice()
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map((h) => {
      const lesson = LESSONS.find((l) => l.id === h.lessonId);
      const lessonLabel = lesson ? `${lesson.icon} ${lesson[lang]}` : t(lang,'raisedHandUnknownLesson');
      const qLabel = typeof h.questionIndex === 'number' && h.questionIndex >= 0 ? t(lang,'raisedHandQuestion',{n:h.questionIndex+1}) : '';
      return `<li class="raised-hand-item">
        <div class="raised-hand-info">
          <strong>🙋 ${escapeHtml(h.name)}</strong>${h.classId ? ` <small>(${escapeHtml(h.classId)})</small>` : ''}
          <span class="raised-hand-lesson">${lessonLabel}${qLabel ? ` · ${qLabel}` : ''}</span>
          <time>${formatDate(h.timestamp)}</time>
        </div>
        <button type="button" class="secondary-btn raised-hand-resolve" data-student-id="${escapeHtml(h.studentId)}">${t(lang,'raisedHandResolve')}</button>
      </li>`;
    })
    .join('');

  return `<section class="raised-hands-panel raised-hands-active">
    <span class="eyebrow dark">${t(lang,'raisedHandsEyebrow')}</span>
    <h3>${t(lang,'raisedHandsTitle',{n:hands.length})}</h3>
    <ul class="raised-hand-list">${items}</ul>
  </section>`;
}

function bindRaisedHandsControls(container, onResolved) {
  container.querySelectorAll('.raised-hand-resolve').forEach((btn) => {
    btn.addEventListener('click', () => {
      lowerHand(btn.dataset.studentId);
      onResolved();
    });
  });
}

function getAssignment() {
  try { return JSON.parse(localStorage.getItem(ASSIGNMENT_KEY) || 'null'); }
  catch { return null; }
}

function saveAssignment(lessonId, dueDate) {
  if (!lessonId) { localStorage.removeItem(ASSIGNMENT_KEY); return; }
  localStorage.setItem(ASSIGNMENT_KEY, JSON.stringify({ lessonId, dueDate: dueDate || '', setAt: new Date().toISOString() }));
}

function formatDueDate(value) {
  if (!value) return '—';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderAssignmentPanel(students, records, lang) {
  const assignment = getAssignment();
  const lessonOptions = `<option value="">${t(lang,'assignmentNone')}</option>` +
    LESSONS.map((l) => `<option value="${l.id}" ${assignment?.lessonId === l.id ? 'selected' : ''}>${l.icon} ${l[lang]}</option>`).join('');

  let statusHtml;
  if (assignment?.lessonId) {
    const lesson = LESSONS.find((l) => l.id === assignment.lessonId);
    const doneIds = new Set(records.filter((r) => r.lessonId === assignment.lessonId && r.completed).map((r) => r.studentId));
    const pending = students.filter((s) => !doneIds.has(s.studentId));
    const dueTime = assignment.dueDate ? new Date(`${assignment.dueDate}T23:59:59`).getTime() : null;
    const overdue = !!dueTime && Date.now() > dueTime && pending.length > 0;

    statusHtml = `<div class="assignment-status${overdue ? ' assignment-overdue' : ''}">
      <p class="assignment-status-line"><strong>${lesson ? `${lesson.icon} ${lesson[lang]}` : escapeHtml(assignment.lessonId)}</strong>${assignment.dueDate ? ` · ${t(lang,'assignmentDueLabelInline',{date:formatDueDate(assignment.dueDate)})}` : ''}${overdue ? ` <span class="overdue-badge">${t(lang,'assignmentOverdueBadge')}</span>` : ''}</p>
      <p class="assignment-progress-line">${t(lang,'assignmentProgress',{done:doneIds.size, total:students.length})}</p>
      ${pending.length
        ? `<details class="assignment-pending"><summary>${t(lang,'assignmentPendingSummary',{n:pending.length})}</summary><ul>${pending.map((s) => `<li>${escapeHtml(s.name)}${s.classId ? ` <small>(${escapeHtml(s.classId)})</small>` : ''}</li>`).join('')}</ul></details>`
        : ''}
    </div>`;
  } else {
    statusHtml = `<p class="panel-note">${t(lang,'assignmentNoneSet')}</p>`;
  }

  return `<section class="assignment-panel">
    <div class="panel-heading"><div><span class="eyebrow dark">${t(lang,'assignmentEyebrow')}</span><h3>${t(lang,'assignmentTitle')}</h3><p class="panel-note">${t(lang,'assignmentNote')}</p></div></div>
    <div class="assignment-controls">
      <label>${t(lang,'assignmentLessonLabel')}<select id="assignment-lesson-select">${lessonOptions}</select></label>
      <label>${t(lang,'assignmentDueLabel')}<input type="date" id="assignment-due-input" value="${escapeHtml(assignment?.dueDate || '')}"></label>
      <button type="button" class="secondary-btn" id="assignment-save-btn">${t(lang,'saveBtn')}</button>
      ${assignment?.lessonId ? `<button type="button" class="secondary-btn" id="assignment-clear-btn">${t(lang,'assignmentClearBtn')}</button>` : ''}
    </div>
    ${statusHtml}
  </section>`;
}

function bindAssignmentControls(container, students, records, lang, onSaved) {
  const wrap = container.querySelector('#assignment-panel-container');
  wrap?.querySelector('#assignment-save-btn')?.addEventListener('click', () => {
    const lessonId = wrap.querySelector('#assignment-lesson-select').value;
    const dueDate = wrap.querySelector('#assignment-due-input').value;
    saveAssignment(lessonId, dueDate);
    onSaved();
  });
  wrap?.querySelector('#assignment-clear-btn')?.addEventListener('click', () => {
    localStorage.removeItem(ASSIGNMENT_KEY);
    onSaved();
  });
}

// Student-facing homework banner: only rendered when a teacher has set an
// assignment on this device. Shows the assigned lesson, its due date if
// any, and whether this particular student has completed it yet.
function renderHomeworkBanner(mine, lang) {
  const assignment = getAssignment();
  if (!assignment?.lessonId) return '';
  const lesson = LESSONS.find((l) => l.id === assignment.lessonId);
  if (!lesson) return '';

  const record = mine.find((r) => r.lessonId === assignment.lessonId);
  const done = !!record?.completed;
  const dueTime = assignment.dueDate ? new Date(`${assignment.dueDate}T23:59:59`).getTime() : null;
  const overdue = !done && !!dueTime && Date.now() > dueTime;

  return `<section class="homework-banner${done ? ' homework-done' : ''}${overdue ? ' homework-overdue' : ''}">
    <div>
      <span class="eyebrow dark">${t(lang,'homeworkEyebrow')}</span>
      <h3>${lesson.icon} ${lesson[lang]}</h3>
      ${assignment.dueDate ? `<p>${t(lang,'homeworkDue',{date:formatDueDate(assignment.dueDate)})}</p>` : ''}
    </div>
    <div class="homework-action">
      ${done
        ? `<span class="homework-badge">✓ ${t(lang,'homeworkDoneBadge')}</span>`
        : `<a class="primary-btn" href="#/lesson/${encodeURIComponent(lesson.id)}">${overdue ? `⚠️ ${t(lang,'homeworkOverdueBadge')}` : t(lang,'homeworkStartBtn')}</a>`}
    </div>
  </section>`;
}

function getAttentionReasons(student, records, days=7, lang='en') {
  const mine = records.filter(r=>r.studentId===student.studentId);
  const reasons=[];
  const scored = mine.filter(r=>typeof r.score === 'number');
  const avg = scored.length ? scored.reduce((sum,r)=>sum+r.score,0)/scored.length : 0;
  const totalQuestions = mine.reduce((sum,r)=>sum+(r.totalQuestions||0),0);
  const totalAttempts = mine.reduce((sum,r)=>sum+(r.attempts||0),0);
  if (scored.length && avg < ATTENTION_SCORE) reasons.push(t(lang,'reasonLowScore',{pct:Math.round(avg*100)}));
  if (totalQuestions && totalAttempts / totalQuestions >= ATTENTION_ATTEMPTS_PER_QUESTION) reasons.push(t(lang,'reasonHighAttempts',{a:totalAttempts,t:totalQuestions}));
  const latest = mine.map(r=>r.timestamp).filter(Boolean).sort().at(-1);
  const inactive = !latest || ((Date.now()-new Date(latest).getTime()) > days*86400000);
  if (inactive) reasons.push(t(lang,'reasonInactive',{days}));
  return reasons;
}

function bindStudentRows(container, records, lang){
  container.querySelectorAll('.student-link').forEach(btn=>btn.addEventListener('click', e=>openStudentDrilldown(btn.dataset.studentId, records, lang)));
  container.querySelectorAll('.student-row').forEach(row=>row.addEventListener('keydown', e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openStudentDrilldown(row.dataset.studentId, records, lang);}}));
}

async function openStudentDrilldown(studentId, records, lang){
  const student = records.find(r=>r.studentId===studentId);
  const studentName = student?.studentName || studentId;
  let modal=document.querySelector('.teacher-drilldown-modal');
  if(!modal){
    modal=document.createElement('div'); modal.className='teacher-drilldown-modal';
    modal.innerHTML='<div class="teacher-drilldown-backdrop"></div><div class="teacher-drilldown-card"><div class="teacher-drilldown-header"><div><span class="eyebrow dark"></span><h2></h2><p class="panel-note"></p></div><button class="worksheet-close-btn" type="button">×</button></div><div class="teacher-drilldown-body"></div></div>';
    document.body.appendChild(modal);
    const close=()=>modal.classList.remove('is-open');
    modal.querySelector('.worksheet-close-btn').addEventListener('click',close);
    modal.querySelector('.teacher-drilldown-backdrop').addEventListener('click',close);
    document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
  }
  modal.querySelector('.teacher-drilldown-header .eyebrow').textContent = t(lang,'studentDetailEyebrow');
  modal.querySelector('h2').textContent=studentName;
  modal.querySelector('.teacher-drilldown-header .panel-note').textContent=t(lang,'drilldownNote');
  modal.classList.add('is-open');
  const body=modal.querySelector('.teacher-drilldown-body');
  body.innerHTML=`<div class="lesson-loading"><div class="spinner"></div><p>${t(lang,'loadingQuestionHistory')}</p></div>`;
  const mine=records.filter(r=>r.studentId===studentId).sort((a,b)=>String(a.lessonId).localeCompare(String(b.lessonId)));
  const cards=[];
  for(const lesson of LESSONS){
    const record=mine.find(r=>r.lessonId===lesson.id);
    if(!record) { cards.push(`<section class="drill-lesson"><div class="drill-lesson-head"><strong>${lesson.icon} ${escapeHtml(lesson[lang])}</strong><span class="status-dot status-none">${t(lang,'notStartedStatus')}</span></div></section>`); continue; }
    const details=record.questionDetails || {};
    const history=record.attemptHistory || {};
    const total=record.totalQuestions||Object.keys(details).length||6;
    const qs=[];
    for(let i=0;i<total;i++){
      const d=details[i] || {question:t(lang,'questionFallback',{n:i+1}),options:[]};
      const attempts=history[i] || [];
      const count=record.questionAttempts?.[i] || attempts.length || 0;
      const fallback = count ? `<span class="attempt-muted">${t(lang,'attemptsRecorded',{n:count})}</span>` : `<span class="attempt-muted">${t(lang,'noAttempt')}</span>`;
      const attemptRows=attempts.length ? attempts.map(a=>`<li><strong>${t(lang,'attemptWord',{n:a.attempt})}</strong> · ${a.correct?t(lang,'correctWord'):t(lang,'incorrectWord')}${a.selected?` · ${escapeHtml(a.selected)}`:''}${a.hintOpened?` · ${t(lang,'hintOpenedTag')}`:''}${a.hintHelped?` · ${t(lang,'hintHelpedTag')}`:''} <time>${formatDate(a.timestamp)}</time></li>`).join('') : `<li>${fallback}</li>`;
      const qScore = typeof record.questionScores?.[i] === 'number' ? Math.round(record.questionScores[i]*100) : (count && attempts.some(a=>a.correct) ? Math.max(25, 100 - ((count-1)*25)) : 0);
      const hintStatus = record.hintUsage?.[i] ? (record.hintHelped?.[i] ? t(lang,'hintHelpedStatus') : t(lang,'hintUsedStatus')) : t(lang,'noHintStatus');
      qs.push(`<article class="drill-question"><div class="drill-question-title"><span>Q${i+1}</span><strong>${escapeHtml(d.question)}</strong><em>${t(lang,'questionMeta',{count,score:qScore,hintStatus})}</em></div><ol class="attempt-list">${attemptRows}</ol></article>`);
    }
    cards.push(`<section class="drill-lesson"><div class="drill-lesson-head"><strong>${lesson.icon} ${escapeHtml(lesson[lang])}</strong><span>${record.completed?t(lang,'completeStatus'):t(lang,'inProgressStatus')} · ${Math.round((record.score||0)*100)}%</span></div><div class="drill-questions">${qs.join('')}</div></section>`);
  }
  body.innerHTML=cards.join('');
}

// ---------------------------------------------------------------------------
// Data safety: Backup / Restore / Sync
//
// Sync used to prompt for the server URL with `window.prompt(...)`. Several
// of the tablet/kiosk-style browsers this app targets don't implement
// JS dialogs (alert/confirm/prompt) at all, so that prompt could silently
// do nothing when tapped — which looked exactly like "Sync now doesn't
// work". The endpoint is now a normal, always-visible text field with its
// own Save button instead, so it works the same everywhere and the current
// value is never hidden behind a dialog the browser might swallow.
// ---------------------------------------------------------------------------
function bindDataSafetyControls(container, lang, onDataChanged) {
  const statusEl = container.querySelector('#data-safety-status');
  const setStatus = (message) => { if (statusEl) statusEl.textContent = message; };

  container.querySelector('#backup-btn')?.addEventListener('click', async () => {
    setStatus(t(lang,'backupPreparing'));
    try {
      const payload = await exportBackup();
      const stamp = payload.exportedAt.slice(0, 10);
      downloadBlob(JSON.stringify(payload, null, 2), `offlineorbit-backup-${stamp}.json`, 'application/json');
      setStatus(t(lang,'backupDone',{n:payload.recordCount}));
    } catch (error) {
      setStatus(t(lang,'backupFailed',{message:error.message}));
    }
  });

  const fileInput = container.querySelector('#restore-file-input');
  container.querySelector('#restore-btn')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;

    const confirmed = window.confirm(t(lang,'restoreConfirm'));
    if (!confirmed) return;

    setStatus(t(lang,'restoring'));
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const result = await importBackup(payload);
      setStatus(t(lang,'restoreDone',{imported:result.imported, skipped:result.skipped}));
      onDataChanged();
    } catch (error) {
      setStatus(t(lang,'restoreFailed',{message: error.message || t(lang,'restoreInvalidFile')}));
    }
  });

  const endpointInput = container.querySelector('#sync-endpoint-input');
  container.querySelector('#sync-endpoint-save')?.addEventListener('click', () => {
    const value = (endpointInput?.value || '').trim();
    if (!value) {
      localStorage.removeItem(SYNC_ENDPOINT_KEY);
      setStatus(t(lang,'syncEndpointCleared'));
      return;
    }
    localStorage.setItem(SYNC_ENDPOINT_KEY, value);
    setStatus(t(lang,'syncEndpointSaved',{endpoint:value}));
  });

  container.querySelector('#sync-btn')?.addEventListener('click', async () => {
    const endpoint = (endpointInput?.value || localStorage.getItem(SYNC_ENDPOINT_KEY) || '').trim();
    if (!endpoint) {
      setStatus(t(lang,'syncNoEndpoint'));
      endpointInput?.focus();
      return;
    }
    localStorage.setItem(SYNC_ENDPOINT_KEY, endpoint);

    setStatus(t(lang,'syncing'));
    try {
      const result = await syncProgress(endpoint);
      localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
      setStatus(result.sent ? t(lang,'syncSuccess',{n:result.sent, endpoint}) : t(lang,'syncNothingNew'));
      onDataChanged();
    } catch (error) {
      console.error('OfflineOrbit sync failed', error);
      setStatus(t(lang,'syncFailed',{message:error.message}));
    }
  });
}

function exportClassCSV(students, records){
  const headers=['Student','Class','Lesson','Completed','Score %','Total Questions','Completed Questions','Total Attempts','Last Updated','Question','Question Attempts','Question Credit %','Hint Used','Hint Helped','Attempt','Selected Option','Result','Attempt Timestamp'];
  const rows=[];
  students.forEach(student=>{
    const mine=records.filter(r=>r.studentId===student.studentId);
    LESSONS.forEach(lesson=>{
      const r=mine.find(x=>x.lessonId===lesson.id);
      if(!r){rows.push([student.name,student.classId,lesson.en,'No',0,0,0,0,'','','',0,'No','No','','','','']);return;}
      const details=r.questionDetails||{}; const history=r.attemptHistory||{};
      const total=r.totalQuestions||Object.keys(details).length||0;
      for(let i=0;i<Math.max(total,1);i++){
        const attempts=history[i]||[];
        if(!attempts.length){rows.push([student.name,student.classId,lesson.en,r.completed?'Yes':'No',Math.round((r.score||0)*100),total,r.completedQuestions?.length||0,r.attempts||0,r.timestamp||'',details[i]?.question||`Question ${i+1}`,r.questionAttempts?.[i]||0,Math.round((r.questionScores?.[i]||0)*100),r.hintUsage?.[i]?'Yes':'No',r.hintHelped?.[i]?'Yes':'No','','','','']);continue;}
        attempts.forEach(a=>rows.push([student.name,student.classId,lesson.en,r.completed?'Yes':'No',Math.round((r.score||0)*100),total,r.completedQuestions?.length||0,r.attempts||0,r.timestamp||'',details[i]?.question||`Question ${i+1}`,r.questionAttempts?.[i]||attempts.length,Math.round((r.questionScores?.[i]||0)*100),a.hintOpened?'Yes':'No',a.hintHelped?'Yes':'No',a.attempt,a.selected,a.correct?'Correct':'Incorrect',a.timestamp]));
      }
    });
  });
  const csv='\ufeff'+[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
  downloadBlob(csv,'offlineorbit-class-progress.csv','text/csv;charset=utf-8');
}

function exportClassPDF(students, records, days){
  const w=window.open('','_blank');
  if(!w){alert('Please allow pop-ups to export the PDF report.');return;}
  const rows=students.map(s=>{
    const mine=records.filter(r=>r.studentId===s.studentId); const done=mine.filter(r=>r.completed).length; const score=mine.length?Math.round(mine.reduce((a,r)=>a+(r.score||0),0)/mine.length*100):0; const attempts=mine.reduce((a,r)=>a+(r.attempts||0),0); const reasons=getAttentionReasons(s,records,Number(days)||7);
    return `<tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.classId||'—')}</td><td>${Math.round(done/LESSONS.length*100)}%</td><td>${score}%</td><td>${attempts}</td><td>${reasons.length?escapeHtml(reasons.join('; ')):'OK'}</td><td>${formatDate(mine.map(r=>r.timestamp).filter(Boolean).sort().at(-1)||'')}</td></tr>`;
  }).join('');
  w.document.write(`<!doctype html><html><head><title>OfflineOrbit Class Progress</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#172033}h1{margin:0 0 6px}p{color:#5f6f82}table{width:100%;border-collapse:collapse;margin-top:20px;font-size:12px}th,td{border:1px solid #dbe3ec;padding:8px;text-align:left}th{background:#f2f6fa}@media print{button{display:none}}</style></head><body><h1>OfflineOrbit Class Progress</h1><p>Generated ${new Date().toLocaleString()} · Inactivity threshold: ${days} days</p><table><thead><tr><th>Student</th><th>Class</th><th>Completion</th><th>Avg score</th><th>Attempts</th><th>Needs attention</th><th>Last active</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

function csvCell(value){return `"${String(value??'').replaceAll('"','""').replaceAll('\n',' ')}"`;}
function downloadBlob(content,name,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function formatDate(value){if(!value)return '—';const d=new Date(value);if(Number.isNaN(d.getTime()))return '—';return d.toLocaleString([], {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});}
function escapeHtml(value){return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
