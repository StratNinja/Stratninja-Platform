/* StratNinja — footer + legal pages (disclaimer / privacy / terms / accessibility / about / contact).
 * Self-contained: fills every .site-footer-mount and opens legal content in a lightweight modal.
 * Works on both the landing page and the app (no dependency on the router). */
(function () {
  "use strict";
  const EMAIL = "Stratninja312@gmail.com";
  const OWNER = "Adi Koriat";
  const STMT_DATE = "יולי 2026";

  const SOCIAL =
    '<a href="https://www.youtube.com/@Strat-Ninja" target="_blank" rel="noopener" class="social yt" aria-label="YouTube"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M23 12s0-3.5-.45-5.18a2.78 2.78 0 0 0-1.95-1.96C18.9 4.4 12 4.4 12 4.4s-6.9 0-8.6.46A2.78 2.78 0 0 0 1.45 6.82C1 8.5 1 12 1 12s0 3.5.45 5.18a2.78 2.78 0 0 0 1.95 1.96c1.7.46 8.6.46 8.6.46s6.9 0 8.6-.46a2.78 2.78 0 0 0 1.95-1.96C23 15.5 23 12 23 12zM9.75 15.5v-7l6 3.5-6 3.5z"/></svg></a>' +
    '<a href="https://www.instagram.com/strat_ninja/?hl=he" target="_blank" rel="noopener" class="social ig" aria-label="Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none"/></svg></a>' +
    '<a href="https://www.tiktok.com/@strat_ninja" target="_blank" rel="noopener" class="social tk" aria-label="TikTok"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M16.5 3c.3 2.1 1.6 3.7 3.7 3.9v2.6c-1.2.1-2.3-.2-3.5-.9v6.3c0 3.4-2.6 5.6-5.7 5.6A5.4 5.4 0 0 1 5.6 15c0-3.2 2.9-5.5 6.1-4.9v2.7c-.3-.1-.7-.2-1-.2-1.3 0-2.4 1-2.4 2.4 0 1.3 1 2.4 2.4 2.4 1.4 0 2.5-1.1 2.5-2.5V3h3.3z"/></svg></a>' +
    '<a href="https://x.com/KoriatTrade" target="_blank" rel="noopener" class="social x" aria-label="X"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M18.9 2H22l-7.3 8.3L23 22h-6.6l-5.2-6.8L5.3 22H2l7.8-8.9L1.5 2h6.8l4.7 6.2L18.9 2zm-1.2 18h1.8L7.4 3.9H5.5L17.7 20z"/></svg></a>';

  const LEGAL = {
    disclaimer:
      '<h2>⚠️ הבהרה פיננסית ואזהרת סיכון</h2>' +
      '<p>הפלטפורמה StratNinja והתוכן בה (סורקים, נתוני שוק, יומן מסחר, ניתוחים וכל מידע אחר) נועדו ל<b>מטרות חינוכיות ומידעיות בלבד</b>, ואינם מהווים ייעוץ השקעות, שיווק השקעות, המלצה או הצעה לביצוע פעולה כלשהי בניירות ערך או בכל נכס פיננסי.</p>' +
      '<p>' + OWNER + ' <b>אינו יועץ השקעות מורשה</b>, והמידע אינו מותאם אישית לצרכים, למצב הכלכלי או למטרות של משתמש כלשהו.</p>' +
      '<p>מסחר והשקעה בשוק ההון כרוכים ב<b>סיכון ממשי לאובדן כספי</b>. ביצועי עבר אינם מעידים על תוצאות עתידיות. כל החלטת מסחר היא באחריותך המלאה בלבד — מומלץ להיוועץ ביועץ השקעות מורשה לפני קבלת החלטה.</p>' +
      '<p>StratNinja ובעליה אינם אחראים לכל נזק, הפסד או החלטה שהתקבלה בהסתמך על המידע באתר.</p>',
    privacy:
      '<h2>🔒 מדיניות פרטיות</h2>' +
      '<p>אנו מכבדים את פרטיותך. להלן איזה מידע נאסף וכיצד נעשה בו שימוש:</p>' +
      '<p><b>מידע שנאסף:</b> בעת התחברות עם חשבון Google — שם וכתובת דוא"ל; נתוני שימוש אנונימיים (סטטיסטיקות מבקרים, ללא זיהוי אישי); ונתונים שאתה מזין בעצמך (יומן מסחר, מועדפים, העדפות).</p>' +
      '<p><b>היכן נשמר:</b> בענן (Supabase) המשויך לחשבונך, וכן מקומית בדפדפן שלך (localStorage). נתוני היומן והמועדפים גלויים לך בלבד.</p>' +
      '<p><b>צד שלישי:</b> אנו נעזרים בשירותי Google (התחברות), Supabase (אחסון) ו-Vercel (אירוח וסטטיסטיקות). <b>איננו מוכרים</b> את המידע שלך לאף גורם.</p>' +
      '<p><b>הזכויות שלך:</b> באפשרותך לעיין, לתקן או למחוק את המידע שלך בכל עת (לרבות מחיקת החשבון). לפניות: <a href="mailto:' + EMAIL + '">' + EMAIL + '</a>.</p>',
    terms:
      '<h2>📄 תנאי שימוש</h2>' +
      '<p>השימוש ב-StratNinja כפוף לתנאים הבאים; שימוש באתר מהווה הסכמה להם.</p>' +
      '<p><b>1.</b> השירות ניתן "כמות שהוא" (AS IS), ללא התחייבות לזמינות, לדיוק או להתאמה למטרה מסוימת.</p>' +
      '<p><b>2.</b> התוכן אינו ייעוץ השקעות (ראה "הבהרה פיננסית"). כל שימוש בו הוא באחריותך.</p>' +
      '<p><b>3.</b> StratNinja ובעליה אינם אחראים לכל נזק ישיר או עקיף, הפסד או החלטה הנובעים מהשימוש בשירות.</p>' +
      '<p><b>4.</b> אין לעשות שימוש לרעה בשירות, לנסות לפרוץ אליו או לפגוע בזכויות של אחרים.</p>' +
      '<p><b>5.</b> אנו רשאים לשנות, להוסיף או להפסיק תכונות ואת השירות כולו בכל עת.</p>',
    accessibility:
      '<h2>♿ הצהרת נגישות</h2>' +
      '<p>אנו רואים חשיבות רבה בהנגשת האתר לכלל המשתמשים, לרבות אנשים עם מוגבלות, ופועלים לעמידה בדרישות תקן ישראלי ת"י 5568 (המבוסס על הנחיות WCAG 2.0 ברמה AA).</p>' +
      '<p>הנגשת האתר היא תהליך מתמשך. ייתכן שחלקים מסוימים טרם הונגשו במלואם — אנו פועלים לשיפור מתמיד.</p>' +
      '<p><b>רכז הנגישות:</b> ' + OWNER + '<br><b>ליצירת קשר בנושאי נגישות:</b> <a href="mailto:' + EMAIL + '">' + EMAIL + '</a></p>' +
      '<p>נתקלת בבעיית נגישות? נשמח שתעדכן אותנו ונטפל בהקדם האפשרי.</p>' +
      '<p class="legal-date">תאריך עדכון ההצהרה: ' + STMT_DATE + '</p>',
    about:
      '<h2>עליי — Strat Ninja</h2>' +
      '<img src="hero.jpg" alt="Adi Koriat — StratNinja" class="about-photo" onerror="this.remove()">' +
      '<p>שמי <b>' + OWNER + '</b>, ובקהילה אני מוכר בתור <b>Strat Ninja</b>. אני סוחר וחוקר שוק ההון האמריקאי לפי שיטת <b>TheStrat</b> — גישה שמבוססת על מבנה נרות מדויק ומסגרות זמן, במקום ניחושים ותחזיות.</p>' +
      '<p>הדרך שלי התחילה מהבנה אחת פשוטה: <b>הדבר הכי קשה במסחר הוא לא הגרף — אלא הרגש האנושי</b>. שיטת TheStrat, יחד עם גישת "בחזרה לממוצע", עוזרת לי ולקהילה לפשט את המסחר ולפעול לפי נתונים ומבנה מחיר — לא לפי פחד או תאוותנות.</p>' +
      '<p>מאחורי StratNinja עומד סיפור אמיתי: אני אבא טרי שעובד במשרה מלאה, ואת הכל בניתי מתוך חלום — ליצור קהילה וכלים (בעזרת אוטומציה ו-AI) שיובילו אותי ואתכם לעבר <b>חופש כלכלי</b>. אני משתף את הדרך כמו שהיא, על ההצלחות והטעויות, בלי קיצורי דרך.</p>' +
      '<p>את הפלטפורמה הזו בניתי כדי לתת לך את <b>כל התמונה במקום אחד</b> — סקירת שוק, סורקי תבניות Strat, ניתוח גרפים ויומן מסחר — בלי לקפוץ בין עשרה מסכים. בקהילה תמצא גם חדשות בוקר יומיות, לייבים שבועיים וניתוחים חיים, בשפה ברורה לסוחר מתחיל ומנוסה כאחד.</p>' +
      '<p><b>נינג’ות לא מנחשות — הן פועלות בדיוק ובאחריות.</b> בוא נסחור חכם יחד.</p>' +
      '<a href="https://www.patreon.com/14520383/join" target="_blank" rel="noopener" class="about-cta">🏆 הצטרפו לקהילת הדיסקורד</a>' +
      '<div class="legal-social">' + SOCIAL + "</div>",
    contact:
      '<h2>📧 יצירת קשר</h2>' +
      '<p>נשמח לשמוע ממך — שאלות, הצעות, שיתופי פעולה או דיווח על תקלה:</p>' +
      '<p><b>דוא"ל:</b> <a href="mailto:' + EMAIL + '">' + EMAIL + "</a></p>" +
      "<p>וברשתות החברתיות:</p>" +
      '<div class="legal-social">' + SOCIAL + "</div>",
  };

  const LINKS = [
    ["about", "עליי"], ["contact", "יצירת קשר"], ["disclaimer", "הבהרה פיננסית"],
    ["privacy", "מדיניות פרטיות"], ["terms", "תנאי שימוש"], ["accessibility", "הצהרת נגישות"],
  ];

  function footerHtml() {
    const year = new Date().getFullYear();
    return '<footer class="site-footer">' +
      '<div class="sf-top">' +
        '<div class="sf-brand"><img src="favicon.svg" class="sf-logo-img" alt="StratNinja"><span><b>StratNinja</b><span class="sf-tag">The Strat Scanner</span></span></div>' +
        '<nav class="sf-links">' + LINKS.map(l => '<a href="#" data-legal="' + l[0] + '">' + l[1] + "</a>").join("") + "</nav>" +
        '<div class="sf-social">' + SOCIAL + "</div>" +
      "</div>" +
      '<div class="sf-bottom">' +
        "<span>© " + year + " StratNinja · " + OWNER + "</span>" +
        '<span class="sf-disc">⚠️ מידע חינוכי בלבד · לא ייעוץ השקעות · מסחר כרוך בסיכון</span>' +
      "</div>" +
    "</footer>";
  }

  function escClose(e) { if (e.key === "Escape") closeLegal(); }
  function closeLegal() { const b = document.getElementById("legalBg"); if (b) b.remove(); document.removeEventListener("keydown", escClose); }
  function openLegal(key) {
    closeLegal();
    const bg = document.createElement("div"); bg.className = "legal-bg"; bg.id = "legalBg";
    const m = document.createElement("div"); m.className = "legal-modal";
    m.innerHTML = '<button class="legal-x" aria-label="סגירה">✕</button><div class="legal-body">' + (LEGAL[key] || "") + "</div>";
    bg.appendChild(m); document.body.appendChild(bg);
    m.querySelector(".legal-x").onclick = closeLegal;
    let down = false;
    bg.addEventListener("mousedown", e => { down = (e.target === bg); });
    bg.addEventListener("click", e => { if (e.target === bg && down) closeLegal(); });
    document.addEventListener("keydown", escClose);
  }
  window.openLegal = openLegal;

  function mount() {
    document.querySelectorAll(".site-footer-mount").forEach(el => { el.innerHTML = footerHtml(); });
    document.querySelectorAll("[data-legal]").forEach(a => { a.onclick = e => { e.preventDefault(); openLegal(a.dataset.legal); }; });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
