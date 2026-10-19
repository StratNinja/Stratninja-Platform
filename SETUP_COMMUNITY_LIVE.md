# לייב קהילה פרטי ("כספת") — צ'קליסט הקמה

**מטרה:** רק חברי הקהילה המשלמים יראו את הלייב הפרטי והצ'אט. כל השאר יראו מסך "הלייב פרטי כרגע — להצטרפות הירשם לקהילה" + לינק לפטריון.

**הקריטריון לזכאות:** חברות בשרת ה-Discord שלך — כי כניסה לשרת כבר מותנית בתשלום ב-Patreon, כך ש**עצם החברות בשרת = משלם**. בנוי כך שבעתיד אפשר להחמיר לתפקיד (role) ספציפי או לדרגות, בלי לשכתב.

**למה זו "כספת אמיתית":** נפתח Live Input נפרד ב-Cloudflare שדורש "קישור חתום". הסטרים לא מתנגן בלי קישור חתום קצר-מועד, והשרת מנפיק אותו רק אחרי אימות זכאות — אי אפשר לעקוף מצד הלקוח.

---

## חלק א' — מה אתה מקים (פעם אחת, אני מלווה בכל שלב)

### Discord
1. היכנס ל-https://discord.com/developers/applications → **New Application** (שם: StratNinja Web).
2. לשונית **Bot** → **Add Bot** → **Reset Token** → **העתק ושמור את ה-Bot Token** (סוד, לא לשתף). הפעל את המתג **Server Members Intent**.
3. לשונית **OAuth2** → העתק **Client ID** ו-**Client Secret** (נשתמש בהם ב-Supabase). את ה-Redirect URL נוסיף אחרי שלב Supabase.
4. הוסף את הבוט לשרת שלך: **OAuth2 → URL Generator** → סמן scope `bot` → הרשאה `View Channels` → פתח את הקישור שנוצר → בחר את השרת שלך → Authorize.
5. הפעל **Developer Mode** (Settings → Advanced), ואז לחיצה ימנית על אייקון השרת → **Copy Server ID** → זה ה-**Guild ID**.

### Supabase
6. פרויקט Supabase → **Authentication → Providers → Discord** → הפעל, הדבק את ה-Client ID + Secret משלב 3 → שמור.
7. העתק את ה-**Callback URL** שמופיע שם, וחזור ל-Discord (שלב 3, OAuth2 → Redirects) והדבק אותו.

### Cloudflare Stream
8. צור **Live Input שני** עם **Require Signed URLs = ON** — זה ה-Input ה"סגור" לקהילה (הציבורי הקיים נשאר כמו שהוא). רשום את ה-**UID** שלו.
9. צור **Signing Key** ל-Stream → תקבל **Key ID** ו-**מפתח PEM פרטי** (סוד). שמור את שניהם.

### Vercel — משתני סביבה (Environment Variables)
10. הוסף: `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `CF_CLOSED_INPUT_ID`, `CF_STREAM_KEY_ID`, `CF_STREAM_KEY_PEM`.
    (הקיימים נשארים: `CF_ACCOUNT_ID`, `CF_CUSTOMER_CODE`, `CF_STREAM_API_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` וכו'.)

---

## חלק ב' — מה אני בונה (קוד)

**שלב 1 — זהות + זכאויות**
- הוספת "התחברות עם Discord" לאתר (דרך Supabase Auth).
- טבלת `entitlements` ב-Supabase (`user_id`, `scope`, `source`, `expires_at`) + RLS — כולל אפשרות לרשום ידנית חריגים.
- `POST /api/entitlement-sync` — השרת לוקח את ה-Discord ID של המשתמש, שואל את הבוט "האם הוא חבר בשרת?" (ובעתיד: "יש לו את התפקיד X?"), ורושם/מעדכן זכאות.

**שלב 2 — הכספת (לייב פרטי)**
- מתג **ציבורי / קהילה** בחלון האדמין של הלייב (`live_status` כבר שמר שורה עתידית ל-`community`).
- `POST /api/live-token` — מאמת את המשתמש (JWT) → בודק זכאות → מנפיק **קישור חתום זמני** ל-Input הסגור → מחזיר אותו לנגן. לא זכאי → 403.
- פרונט `/live`: בלייב "קהילה", הנגן מושך את הכתובת מ-`/api/live-token`. זכאי → רואה שידור; אחרת → מסך "הלייב פרטי, הירשם לקהילה" + לינק פטריון. הצ'אט ננעל לזכאים.

**שלב 3 — עתיד**
- ריענון זכאויות אוטומטי (מי שעזב את השרת / הפסיק לשלם מאבד גישה).
- `scopes` מוכנים לדרגות (קהילה / קורס) — מוכן לעוד מנויים.

---

*התוכנית תואמת למסמך `VIDEO_HUB_2.0_PLAN.md` הקיים (פריסת ה-COMMUNITY visibility).*
