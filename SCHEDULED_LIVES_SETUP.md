# לייבים מתוזמנים — מדריך הקמה (עדי)

הפיצ'ר הזה נותן לך טופס אחד באתר שיוצר **אירוע לייב עתידי** — גם באתר StratNinja וגם
(בשלב ב') **שידור מתוזמן ביוטיוב** עם כותרת, תיאור, תמונה וספירה לאחור, בדיוק כמו שהיה
פעם. המנויים יקבלו התראה אוטומטית "⏰ עולה לייב בעוד 30 דק'".

יש שני שלבים. **שלב א' עובד כבר עכשיו** (רק צריך להריץ SQL + לפרוס). **שלב ב'** (יוטיוב)
דורש הקמה חד-פעמית של Google שאתה עושה בעצמך — כל השלבים כאן למטה.

---

## שלב א' — הפעלה באתר (עובד מיד, בלי יוטיוב)

1. **הרץ את ה-SQL** ב-Supabase:
   - היכנס ל-Supabase → פרויקט StratNinja → **SQL Editor**.
   - פתח את הקובץ `scheduled_lives.sql` (נמצא בריפו), העתק את כל התוכן, הדבק והרץ (**Run**).
   - בסוף אמור להופיע: `OK: grants verified`. זהו.
2. **פרוס את האתר**: `git push` ל-main (Vercel יבנה אוטומטית). *(כבר נעשה אם קיבלת הודעה שזה עלה.)*
3. **שימוש**: היכנס ל-`/live` (מחובר עם המייל `koriatmanagement@gmail.com`) → לחץ **🎛️ ניהול** →
   גלול לקטע **📅 לייבים מתוזמנים** → **➕ לייב חדש** → מלא כותרת, תיאור, זמן התחלה, ותמונה (לא חובה) → **צור לייב**.
   - מאותו רגע יופיע באתר `/live` באנר **"🔴 לייב קרוב"** עם ספירה לאחור.
   - **30 דקות לפני** הזמן שקבעת — כל מי שרשום להתראות יקבל פוש לנייד אוטומטית.
   - ההתראה **"🔴 בלייב עכשיו"** נשארת כמו שהיא — אתה שולח אותה ידנית ברגע שאתה באמת עולה.

> בשלב א' הטופס אומר "YouTube עדיין לא מחובר — רק באתר". זה תקין. אחרי שלב ב' זה ייווצר גם ביוטיוב אוטומטית.

---

## שלב ב' — חיבור יוטיוב (הקמה חד-פעמית)

המטרה: לתת לאתר הרשאה ליצור שידורים מתוזמנים **בערוץ שלך** (Strat-Ninja). בסוף תקבל 3 ערכי
סוד שתדביק ב-Vercel. **אל תשלח אף אחד מהסודות האלה אליי בצ'אט** — אתה מזין אותם לבד ב-Vercel.

### 2.1 — צור פרויקט ב-Google Cloud
1. היכנס ל-https://console.cloud.google.com **עם חשבון הגוגל של הערוץ** (`koriatmanagement@gmail.com`).
2. למעלה, ליד הלוגו, לחץ על בורר הפרויקטים → **New Project** → תן שם `StratNinja Live` → **Create**.
3. ודא שהפרויקט החדש נבחר (שמו מופיע למעלה).

### 2.2 — הפעל את YouTube Data API v3
1. בתפריט (☰) → **APIs & Services** → **Library**.
2. חפש `YouTube Data API v3` → היכנס אליו → **Enable**.

### 2.3 — מסך ההסכמה (OAuth consent screen)
1. תפריט → **APIs & Services** → **OAuth consent screen**.
2. בחר **External** → **Create**.
3. מלא: App name = `StratNinja`, User support email = המייל שלך, Developer contact = המייל שלך → **Save and Continue**.
4. במסך **Scopes** אפשר פשוט ללחוץ **Save and Continue** (נגדיר את ההרשאה בשלב 2.5).
5. במסך **Test users** → **Add users** → הוסף את `koriatmanagement@gmail.com` → **Save and Continue**.
6. **חשוב מאוד — פרסם את האפליקציה**: חזור ל-OAuth consent screen → לחץ **Publish app** → אשר.
   - **למה זה קריטי:** אם האפליקציה נשארת במצב "Testing", ה-refresh token **מת אחרי 7 ימים**
     והלייבים יפסיקו להיווצר. במצב "In production" הוא חי לאורך זמן.
   - תראה אזהרת "unverified app" — זה בסדר גמור, זה הערוץ שלך ואתה הבעלים. אין צורך באימות של גוגל
     כי רק אתה משתמש בזה.

### 2.4 — צור OAuth Client ID
1. תפריט → **APIs & Services** → **Credentials** → **+ Create Credentials** → **OAuth client ID**.
2. **Application type**: בחר **Web application**.
3. תן שם `StratNinja Live Client`.
4. תחת **Authorized redirect URIs** → **+ Add URI** → הדבק בדיוק:
   `https://developers.google.com/oauthplayground`
5. **Create**. ייפתח חלון עם **Client ID** ו-**Client secret** — שמור אותם (נשתמש בהם מיד). אלה
   שני הסודות הראשונים: `YT_CLIENT_ID` ו-`YT_CLIENT_SECRET`.

### 2.5 — הפק refresh token (דרך OAuth Playground — בלי קוד)
1. היכנס ל-https://developers.google.com/oauthplayground (באותו דפדפן, מחובר עם חשבון הערוץ).
2. למעלה מימין לחץ על גלגל השיניים ⚙️ (**OAuth 2.0 configuration**):
   - סמן **Use your own OAuth credentials**.
   - הדבק את ה-**Client ID** וה-**Client secret** מסעיף 2.4 → סגור את החלונית.
3. בצד שמאל, בתיבת **Input your own scopes**, הדבק את שתי ההרשאות (מופרדות ברווח):
   ```
   https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.force-ssl
   ```
   ולחץ **Authorize APIs**.
4. ייפתח מסך התחברות של גוגל → בחר את חשבון הערוץ → אשר ("Continue" גם אם מופיעה אזהרת unverified).
5. חזרת ל-Playground. לחץ **Exchange authorization code for tokens**.
6. בצד ימין יופיע **Refresh token** (מתחיל ב-`1//`). זהו הסוד השלישי: `YT_REFRESH_TOKEN`.
   העתק אותו (זה הערך הארוך אחרי "Refresh token").

### 2.6 — הדבק את הסודות ב-Vercel
1. היכנס ל-https://vercel.com → פרויקט `stratninja-platform` → **Settings** → **Environment Variables**.
2. הוסף שלושה משתנים (Environment = **Production**, וגם Preview אם תרצה):
   | Name | Value |
   |------|-------|
   | `YT_CLIENT_ID` | ה-Client ID מסעיף 2.4 |
   | `YT_CLIENT_SECRET` | ה-Client secret מסעיף 2.4 |
   | `YT_REFRESH_TOKEN` | ה-Refresh token מסעיף 2.5 |
3. אופציונלי:
   - `YT_PRIVACY` = `public` (ברירת מחדל) / `unlisted` / `private`.
   - `YT_STREAM_ID` = **השאר ריק** — המערכת תמצא לבד את מפתח השידור הקבוע שלך (זה שבו OBS→Cloudflare
     משדרים ליוטיוב). הוסף ערך רק אם יש לך כמה מפתחות קבועים ואתה רוצה לבחור מפתח ספציפי.
4. אחרי שהוספת — צריך **Redeploy** אחד כדי שהמשתנים ייכנסו לתוקף: Vercel → Deployments → ⋯ על
   הפריסה האחרונה → **Redeploy**.

### 2.7 — בדיקה
1. היכנס ל-`/live` → 🎛️ ניהול → 📅 לייבים מתוזמנים → ➕ לייב חדש → צור לייב (קבע זמן כמה דקות קדימה).
2. הטופס אמור להגיד **"נשמר ✓ + שידור יוטיוב נוצר"**.
3. היכנס ל-YouTube Studio → **Content** → **Live** — אמור להופיע שם שידור מתוזמן עם הכותרת והתמונה.
4. כשתעלה בפועל ב-OBS (אותו multistream ל-Cloudflare→YouTube כמו תמיד) — השידור ייכנס לתוך
   האירוע המתוזמן הזה, והמנויים שכבר קיבלו התראה ייכנסו.

---

## איך זה עובד מאחורי הקלעים (לידיעה)
- **האתר**: טבלת `scheduled_lives` ב-Supabase (קריאה ציבורית, כתיבה רק מהשרת עם service-role).
- **הבאנר + ספירה לאחור** ב-`/live` קוראים מ-`GET /api/scheduled-lives`.
- **ההתראה "30 דק' לפני"**: הוורקר בפייתון בשרת Hetzner (רץ כל דקה) מזהה לייב שמתחיל בעוד ≤30 דק',
  מסמן אותו כ"נשלח" (פעם אחת) ומכניס פוש ל-`push_outbox` — אותה מערכת פוש קיימת ומוכחת.
- **יוטיוב**: `api/scheduled-lives.js` מרענן access token מה-refresh token, קורא ל-`liveBroadcasts.insert`,
  מעלה תמונה (`thumbnails.set`), ומקשר (`liveBroadcasts.bind`) למפתח השידור הקבוע שלך — הכל אוטומטית
  ברגע שיצרת לייב בטופס.

## פתרון תקלות
- **"נשמר באתר ✓ אבל יצירת השידור ביוטיוב נכשלה (yt_auth)"** → בדרך כלל ה-refresh token פג (אם לא
  פרסמת את האפליקציה — ראה 2.3 סעיף 6) או הסודות לא נכונים. הפק refresh token מחדש (2.5) ועדכן ב-Vercel.
- **"yt_insert"** → בדוק שב-YouTube Studio הפעלת פעם אחת אפשרות לייב בערוץ (Go Live) כדי שהערוץ מורשה לשידורים חיים.
- **הלייב לא נכנס לשידור המתוזמן ב-OBS** → ודא שאתה משדר לאותו מפתח שידור קבוע; אם יש כמה — הגדר
  `YT_STREAM_ID` למפתח הנכון.
- **לא הגיעה התראת "30 דק'"** → ודא שהרצת את ה-SQL, ושהשרת (scheduler) רץ. בדוק לוג: `docker compose logs scheduler | grep prepush`.
