# StratNinja Video Hub — תוכנית ארכיטקטורה (שלב 2.0)

> מסמך תכנון בלבד. אין בו קוד להרצה, אין שינוי DB, אין Deploy — הכול ממתין לאישור נפרד.
> נכתב 2026-10-16, בהמשך למערכת ה-PUBLIC LIVE (שלב 1) שמוכנה ל-Production.

---

## 0. נקודת המוצא (מה כבר קיים)

| רכיב | מצב | רלוונטיות ל-2.0 |
|---|---|---|
| עמוד `/live` + קישור קבוע | ✅ בנוי (שלב 1) | נשאר מרכז השידורים |
| Cloudflare Stream Live Input (ציבורי) | ✅ מוגדר | המקור לשידור הציבורי + הקלטותיו |
| `scheduled_at` + מצב "בקרוב" + ספירה לאחור | ✅ בנוי | בסיס לאירועים מתוזמנים |
| פאנל ניהול בסיסי (כותרת/תיאור/מצב/תזמון) | ✅ בנוי | יורחב ל-CRUD מלא |
| הזדהות: Google OAuth דרך Supabase (`SNAuth`) | ✅ קיים | בסיס הזהות |
| זיהוי מנהל: אימייל קבוע `koriatmanagement@gmail.com` | ✅ קיים | יישאר בסיס ההרשאה הניהולית |
| **מנגנון חברוּת / מנוי / tier / הרשאות-תוכן** | ❌ **לא קיים** | ⚠️ **תלות קריטית — חייבים לבנות** |

**המסקנה החשובה ביותר:** היום "מחובר = גישה מלאה". אין שום דרך לסמן "זה חבר קהילה" או "לזה יש גישה לקורס The Strat". ללא מקור-אמת לזכאות, לא ניתן לאכוף COMMUNITY/COURSE. לכן שלב 2.0 חייב להתחיל בבניית **שכבת זכאות (Entitlements)**.

---

## 1. ארכיטקטורה כללית

```
                         ┌─────────────────────────────────────────┐
                         │               דפדפן (SPA)                │
                         │  /live  ·  /watch/<id>  ·  /courses/<id>  │
                         └───────────────┬───────────────┬──────────┘
            קריאה ציבורית (ללא טוקן)      │               │  תוכן מוגבל: בקשת טוקן
                                         ▼               ▼
                 ┌──────────────────────────┐   ┌──────────────────────────┐
                 │  GET /api/video (ציבורי) │   │  POST /api/video-token    │
                 │  מחזיר רק פריטים PUBLIC   │   │  מאמת JWT + בודק זכאות     │
                 │  + metadata גלוי          │   │  → מנפיק CF Signed Token   │
                 └───────────┬──────────────┘   └───────────┬───────────────┘
                             │  service_role                 │  CF signing key (PEM)
                             ▼                                ▼  (שרת בלבד!)
                 ┌──────────────────────────┐   ┌──────────────────────────┐
                 │   Supabase (metadata)    │   │   Cloudflare Stream       │
                 │ video_items · courses ·   │   │ Live Inputs (public/closed)│
                 │ entitlements · live_status│   │ VOD assets · signed URLs  │
                 └──────────────────────────┘   └──────────────────────────┘
```

**עקרונות על:**
- **Metadata ב-Supabase, וידאו ב-Cloudflare.** Supabase מחזיק כותרות/תמונות/הרשאות; Cloudflare מחזיק ומגיש את הווידאו.
- **אכיפה בצד השרת בלבד.** הדפדפן אף פעם לא מחליט אם מישהו רשאי לצפות. פריט מוגבל פשוט לא ינוגן בלי טוקן חתום שהשרת הנפיק אחרי בדיקת זכאות. הסתרת כפתורים = נוחות UI, לא אבטחה.
- **אפס סודות בדפדפן.** CF API Token, Stream signing key (PEM), service_role — כולם env בצד שרת בלבד, כמו בשלב 1.

---

## 2. מודל התוכן וההרשאות

### סוגי תוכן (`kind`)
1. `live` — שידור חי פעיל.
2. `scheduled` — אירוע מתוזמן (כותרת/תיאור/שעה/thumbnail/ספירה לאחור), לפני שהוא עולה.
3. `vod` — הקלטה של שידור קודם, לצפייה חוזרת.
4. `course_lesson` — פרק בתוך קורס (VOD משויך לקורס + סדר).

### רמות נראות (`visibility`) — עצמאית לכל פריט
| רמה | מי רואה | אכיפה |
|---|---|---|
| `public` | כולם, ללא התחברות | CF ללא signed URL; API מחזיר למי שלא מחובר |
| `community` | חברי קהילה מאומתים בלבד | CF `requireSignedURLs=true` + בדיקת זכאות `community` בשרת |
| `course` | בעלי הרשאה לקורס הספציפי | כנ"ל + בדיקת זכאות `course:<id>` בשרת |

נראות נקבעת **לכל פריט בנפרד** (שדה בטבלה), וניתנת לשינוי בדיעבד (למשל להפוך הקלטת-קהילה לציבורית, או להפך). שינוי נראות של VOD = עדכון שדה ב-Supabase **+** עדכון `requireSignedURLs` על אותו וידאו ב-Cloudflare דרך ה-API (צעד שרת-צד).

### 2.1 מיפוי מסלולי מנוי → זכאויות (מודל ההרשאות שנקבע)

מטריצת הגישה המאושרת:

| תוכן | ציבורי (אורח) | מסלול רגיל | Advanced $50 | Pro $100 |
|---|:---:|:---:|:---:|:---:|
| לייב ציבורי | ✓ | ✓ | ✓ | ✓ |
| סרטונים ציבוריים | ✓ | ✓ | ✓ | ✓ |
| לייב לקהילה | ✗ | ✓ | ✓ | ✓ |
| הקלטות לקהילה | ✗ | ✓ | ✓ | ✓ |
| **קורס The Strat** | 🔒 | 🔒 | ✓ | ✓ |

**זכאויות (scopes) נגזרות — לא שם-מסלול ולא חסימת-UI:**
- `community` → מוענקת לכל **מנוי פעיל** (מסלול רגיל / Advanced / Pro).
- `course_the_strat` → מוענקת **אוטומטית למנויי Advanced ו-Pro פעילים בלבד**.

**למה הרשאה עצמאית `course_the_strat` ולא בדיקת "שם מסלול":** אם בעתיד ישתנו מחירים, ייווסף מסלול, או יוצע הקורס כרכישה נפרדת — משנים רק את **כלל המיפוי** שמעניק את הזכאות, בלי לגעת בכל מנגנון האבטחה (הבדיקה בשרת תמיד שואלת "יש `course_the_strat`?", לא "המסלול נקרא Advanced?").

**מקור-האמת של המנוי:** נקבע ע"י מערכת המנויים הפעילה (ראה סעיף 9, תלות #1). כלל-המיפוי (מסלול פעיל → scope) רץ בצד השרת: בעת הנפקת טוקן, או כ-sync שמעדכן את טבלת `entitlements`. **תוקף המנוי חייב להיבדק בצד השרת** — מנוי שפג לא יקבל טוקן, גם אם ה-scope נשמר בטבלה (נשתמש ב-`expires_at`).

---

## 3. הפרדת Live Inputs — ציבורי מול סגור (ההמלצה שביקשת)

### ✅ המלצה חד-משמעית: **כן, להפריד.** שני Live Inputs נפרדים (לפחות).

| Input | `requireSignedURLs` | שימוש | הקלטות |
|---|---|---|---|
| **PUBLIC input** | `false` | שידורים ציבוריים | הופכות ל-VOD ציבורי |
| **CLOSED input** | `true` | שידורי קהילה / קורסים | הקלטות **יורשות** את ההגבלה → חסומות כברירת מחדל |

**למה זה קריטי (וזה בדיוק החשש שהעלית):**
- ב-Cloudflare, הגדרת ה-signed-URL נקבעת **ברמת ה-Input**, וההקלטות **יורשות** אותה. אם נשדר קהילה דרך ה-Input הציבורי, גם השידור וגם ההקלטה שלו יהיו **ציבוריים לכל מי שמחזיק את ה-UID** — דליפה שקטה.
- ה-UID של ה-Input הציבורי מוטמע בדפדפן (זה תקין — הוא ציבורי). ה-Input הסגור לעולם לא נחשף ככזה; גישה אליו רק דרך טוקן חתום.
- הפרדה = הגנה "by default": אי אפשר בטעות לפרסם שידור קהילה.

**המחיר:** ב-OBS תבחר לפני כל שידור לאיזה Input/Stream Key לשדר (ציבורי או סגור). תיעוד קצר של שני הפרופילים ב-OBS יפתור את זה. שווה את זה.

**הערה על "שדרוג נראות":** הכי בטוח לקבוע את הנראות **לפני** השידור (בבחירת ה-Input). להפוך הקלטת-קהילה לציבורית בדיעבד = אפשרי (מעדכנים `requireSignedURLs=false` על אותו וידאו ספציפי דרך ה-API), אבל לא להפך-בקלות על Input חי. לכן: החלטת ציבורי/סגור נקבעת בזמן התזמון.

---

## 4. סכמת נתונים מוצעת (Supabase — להרצה עתידית, לא עכשיו)

> כולן טבלאות **חדשות**. לא נוגעות ב-`giveaways` / `giveaway_entries` / `scanner_data` / `market_snapshot` הקיימות.

```sql
-- 4.1 זכאויות: מקור-האמת היחיד למי רשאי למה (התלות הקריטית)
create table if not exists entitlements (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,              -- Supabase auth user id
  scope       text not null,              -- 'community'  |  'course_the_strat'  | ...
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz,                -- null = ללא תפוגה; אחרת נבדק בשרת (מנוי שפג → אין טוקן)
  source      text default 'admin',       -- 'admin' | 'subscription' | 'redeem_code' | 'discord' | 'purchase'
  unique (user_id, scope)
);
-- כלל המיפוי (רץ בשרת, לא בדפדפן):
--   מנוי פעיל (מסלול רגיל/Advanced/Pro)      → scope 'community'
--   מנוי פעיל Advanced ($50) או Pro ($100)   → scope 'course_the_strat'
-- שינוי מחיר/מסלול בעתיד = שינוי כלל המיפוי בלבד; מנגנון האבטחה לא משתנה.

-- 4.2 קורסים
create table if not exists courses (
  id            text primary key,          -- slug, למשל 'thestrat'
  title         text not null,
  description   text default '',
  thumbnail_url text default '',
  visibility    text not null default 'course',  -- ברירת מחדל להרשאת הקורס
  order_index   int  default 0,
  published     boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 4.3 פריטי תוכן (live / scheduled / vod / course_lesson)
create table if not exists video_items (
  id             text primary key,          -- slug / uuid, משמש גם ל-/watch/<id>
  kind           text not null,             -- 'live'|'scheduled'|'vod'|'course_lesson'
  visibility     text not null default 'public',  -- 'public'|'community'|'course'
  title          text not null default '',
  description    text default '',
  thumbnail_url  text default '',
  -- וידאו/שידור
  cf_live_input  text,                      -- לאיזה Input שייך (live/scheduled)
  cf_video_uid   text,                      -- ה-VOD ב-Cloudflare (vod/course_lesson)
  duration_sec   int,
  -- תזמון ומצב
  scheduled_at   timestamptz,
  started_at     timestamptz,
  ended_at       timestamptz,
  status         text default 'draft',      -- 'draft'|'scheduled'|'live'|'ended'|'archived'
  -- שיוך
  course_id      text references courses(id),
  order_index    int default 0,             -- סדר פרקים בקורס
  source_live_id text references video_items(id),  -- איזה שידור חי הפיק את ה-VOD
  -- פרסום
  published      boolean default false,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_video_pub  on video_items (visibility, published, kind);
create index if not exists idx_video_course on video_items (course_id, order_index);

-- 4.4 הרשאות (RLS) — לפי התבנית המוקשחת של live_status (שלב 1)
--   • קריאה ציבורית: רק שורות published = true AND visibility = 'public'
--   • כל השאר (community/course/draft): נקרא רק דרך השרת (service_role) אחרי בדיקת זכאות
--   • אנונימי/מחובר: SELECT מוגבל בלבד; INSERT/UPDATE/DELETE חסומים (service_role בלבד)
```

**איך הרשאות נאכפות בפועל:**
- `GET /api/video` (ציבורי) מחזיר **רק** `public + published`. פריטי community/course כלל לא נשלחים לדפדפן של מי שלא זכאי (גם לא ה-metadata הרגיש).
- `GET /api/video?scope=mine` (מחובר) מוסיף פריטים שהמשתמש **זכאי** להם, אחרי שהשרת הצליב `entitlements`.
- RLS ב-Supabase הוא שכבת-הגנה שנייה: גם אם מישהו פונה ישירות ל-PostgREST עם ה-anon key, הוא לא יראה שורות מוגבלות (בדיוק כמו ש-anon קיבל 401 על כתיבה בשלב 1).

---

## 5. אבטחת תוכן מוגבל — Signed URLs + בדיקת זכאות

זרימת צפייה בפריט `community`/`course`:

```
1. דפדפן: POST /api/video-token { item_id }  + Authorization: Bearer <supabase JWT>
2. שרת: מאמת את ה-JWT מול Supabase (/auth/v1/user) → מזהה user_id
3. שרת: שולף את video_items[item_id] → קורא את visibility שלו
4. שרת: בודק entitlements (ותוקף — expires_at):
        visibility='community' → קיימת שורה scope='community' תקפה?
        visibility='course'    → קיימת שורה scope='course_the_strat' תקפה?
5. אם לא זכאי → 403 (וזהו — אין טוקן, אין ניגון)
6. אם זכאי → השרת חותם CF Stream Signed Token (JWT עם kid+PEM, exp קצר ~2 שעות)
7. שרת מחזיר רק את ה-URL עם הטוקן. הדפדפן טוען iframe/HLS עם הטוקן.
```

**נקודות מפתח:**
- ה-video ב-Cloudflare מוגדר `requireSignedURLs=true` → **בלי** טוקן חתום, Cloudflare עצמו מסרב להגיש. גם אם מישהו מצא את ה-UID ב-DevTools — חסום.
- ה-**signing key (PEM)** נשמר ב-Vercel env (שרת בלבד), לעולם לא בדפדפן. זהו הסוד היחיד החדש בשלב זה.
- טוקן קצר-מועד (exp) → אם משתפים לינק, הוא פג מהר. אפשר להוסיף `accessRules` (למשל הגבלת IP/מדינה) בעתיד.
- "אל תסתמך על הסתרת כפתורים" — מיושם: ההגנה היא ב-Cloudflare (requireSignedURLs) + בהנפקת הטוקן בשרת, לא ב-UI.

---

## 6. מסכים (UI)

### ציבורי
- **`/live`** — מרכז השידורים (קישור קבוע):
  - **Hero**: שידור חי פעיל (נגן) **או** האירוע המתוזמן הקרוב (thumbnail גדול + כותרת + ספירה לאחור).
  - **"שידורים קרובים"**: רשימת אירועים מתוזמנים.
  - **"ספריית הקלטות"**: רשת VOD (thumbnail · תאריך · כותרת · משך) — מסוננת למה שהצופה רשאי לראות.
  - **"קורסים"**: כניסה לספריית הקורסים.
- **`/watch/<id>`** — דף פריט בודד (שידור/אירוע/VOD): נגן + כותרת/תיאור + קשורים. פריט מוגבל שאין זכאות אליו → מסך "תוכן לחברי קהילה / קורס" + CTA להצטרפות, **בלי** נגן.
- **`/courses`** + **`/courses/<id>`** — דף קורס: רשימת פרקים לפי סדר; פרק נעול מציג מנעול → קליק → אם אין זכאות, CTA.

### מנהל (רק `koriatmanagement@gmail.com`)
- **Video Hub → אירועים**: יצירה/עריכה של אירועים מתוזמנים ושידורים (כותרת, תיאור, העלאת thumbnail, שעה, נראות, בחירת Input ציבורי/סגור). כל אירוע מקבל קישור ייחודי `/watch/<id>`.
- **Video Hub → הקלטות**: רשימת ההקלטות מ-Cloudflare; שיוך הקלטה לאירוע המקורי (יורש כותרת+thumbnail); קביעת נראות; פרסום/הסתרה.
- **Video Hub → קורסים**: יצירת קורס, הוספת פרקים (מתוך VOD קיים), סידור, קביעת גישה.
- **Video Hub → זכאויות**: הענקה/שלילה של `community` / `course:<id>` למשתמש (ידני; בעתיד קודי-מימוש/סנכרון דיסקורד).

---

## 7. מחזור חיים של הקלטה (Cloudflare → ארכיון)

```
OBS → Live Input (recording.mode=automatic)
   → בסיום השידור, Cloudflare מכין VOD (status: 'ready')
   → קליטה לארכיון, אחת משתיים:
       (א) Webhook/Notification "video ready"  → /api/video-ingest יוצר שורת vod אוטומטית
       (ב) המנהל לוחץ "רענן הקלטות" → השרת שואל את CF API ומציג הקלטות שטרם שויכו
   → המנהל משייך ל-אירוע המקורי (source_live_id) → יורש כותרת + thumbnail
   → קובע נראות + published → מופיע ב-"ספריית הקלטות"
```
- שיוך אוטומטי אפשרי לפי `cf_live_input` + חלון זמן השידור.
- נראות ברירת-מחדל של הקלטה = נראות ה-Input שהפיק אותה (ציבורי→public, סגור→community).

---

## 8. עלויות צפויות (Cloudflare Stream)

| מרכיב | תעריף | הערכה |
|---|---|---|
| אחסון | ~$5 / 1000 דקות מאוחסנות לחודש | 8 שידורים × 60 דק' = 480 דק'/חודש ≈ **$2.4/חודש** (מצטבר ככל שהספרייה גדלה: ~שנה ≈ 5,760 דק' ≈ **$29/חודש**) |
| הגשה (צפייה) | ~$1 / 1000 דקות נצפות | לייב של שעה שנצפה 100 פעם ≈ 6,000 דק' ≈ **$6** |
| Signed URLs / signing keys | חינם | — |
| Supabase (metadata) | זניח | טבלאות קטנטנות |
| Thumbnails (Supabase Storage / CF auto) | זניח | — |

**שליטה בעלות:** מדיניות שימור (לשמור רק N שידורים אחרונים, או רק מסומנים "ארכיון קבוע"); קורסים ארוכים = אחסון מצטבר — להחליט מראש מה נשמר לתמיד.

---

## 9. תלויות, סיכונים ופתרונות

| # | נושא | סיכון | פתרון |
|---|---|---|---|
| 1 | **אין מנגנון זכאות/מנוי באתר** | ❗ חוסם COMMUNITY/COURSE | לבנות טבלת `entitlements` + כלל מיפוי מסלול→scope בשרת (2.0c). מקור המנוי הפעיל צריך להתחבר (ידני/תשלום/דיסקורד). תוקף נבדק תמיד בשרת |
| 1b | **קורס The Strat לא זמין** (ערוץ YouTube נחסם) | אין מה להעלות | ⚠️ **תלות תוכן**: Cloudflare לא משחזרת סרטונים שהיו רק ב-YouTube. חובה להשיג קודם את **קובצי המקור / עותקי ההקלטות** לפני בניית הקורס מחדש |
| 2 | סוד חדש: CF signing key (PEM) | חשיפה = עקיפת הגנה | Vercel env, שרת בלבד; אף פעם לא בדפדפן/לוג (כמו שלב 1) |
| 3 | ערבוב ציבורי/סגור על Input אחד | דליפת שידורי קהילה | **Input נפרד לכל רמה** (סעיף 3) |
| 4 | הגדרת נראות שגויה על פריט | חשיפה לא מכוונת | ברירת מחדל מחמירה (`community`) לכל מה שלא-ציבורי-מפורש; RLS כשכבה שנייה |
| 5 | פגיעה בהגרלות/אתר קיים | — | טבלאות + endpoints + קבצים **חדשים** בלבד; אפס שינוי ב-giveaway/feed/scanner |
| 6 | תאימות למשתמשים קיימים | — | מתבסס על `SNAuth` הקיים; המנהל נשאר לפי אימייל |

---

## 10. שלבי ביצוע (מודולרי — כל שלב עומד בפני עצמו)

> כל שלב מתחיל בפיתוח מקומי + טסטים, ועולה ל-Preview לפני Production — בדיוק כמו שלב 1.

**שלב 2.0a — תשתית + אירועים מתוזמנים + Thumbnails**
- טבלאות `video_items` + `courses` (ללא עדיין community/course אכיפה).
- `/api/video` (ציבורי + ניהול CRUD למנהל).
- הרחבת פאנל הניהול: יצירת אירועים, העלאת thumbnail, קישור ייחודי לכל אירוע.
- `/live` מציג אירוע מתוזמן עם thumbnail + ספירה לאחור (מרחיב את מה שכבר קיים).

**שלב 2.0b — ספריית VOD ציבורית**
- הפעלת הקלטה אוטומטית על ה-Input הציבורי.
- קליטת הקלטות (webhook או "רענן הקלטות") → שיוך לאירוע → `/live` archive + `/watch/<id>`.

**שלב 2.0c — תוכן מוגבל (קהילה/קורס) + Signed URLs** ← הלב של 2.0
- טבלת `entitlements` + פאנל הענקה.
- Input סגור (`requireSignedURLs=true`).
- `/api/video-token` (אימות JWT → בדיקת זכאות → CF signed token).
- UI של קורסים + נעילת פרקים.

**שלב 2.0d — ליטוש**
- נגן צף/Mini Player (ראה סעיף 11), אנליטיקות צפייה, מדיניות שימור.

---

## 11. נגן צף (תכנון עתידי — לא ממומש כעת)

- Mini Player שממשיך לנגן בעת מעבר בין עמודים (כמו יוטיוב).
- **אתגר תאימות לשלב 1:** היום `teardown()` מסיר את ה-iframe בכל יציאה מ-/live (מונע שמע-רקע). נגן צף ידרוש הפרדה בין "יציאה מהעמוד" לבין "סגירת הנגן": ה-iframe יעבור לקונטיינר צף גלובלי במקום להימחק, והשמע ייפסק רק בלחיצת ✕.
- יישמר העיקרון: נגן יחיד בכל רגע; תוכן מוגבל בצף עדיין דורש טוקן תקף.

---

## 12. סדר ההשקה המאושר + החלטות פתוחות

**סדר ההשקה (לפי החלטת Adi):**
1. קודם — להשיק את ה-**PUBLIC LIVE** הקיים (שלב 1, מוכן ל-Production).
2. אחר כך 2.0 בשני שלבים: **(א)** תזמון שידורים + ארכיון הקלטות (ציבורי); **(ב)** ספריית קורסים מאובטחת לחברי Advanced/Pro.

**נקבע כבר:**
- מודל ההרשאות: PUBLIC / COMMUNITY / `course_the_strat` (סעיף 2.1) — זכאות עצמאית, אימות שרת-צד.
- הפרדת Live Inputs ציבורי/סגור — מומלץ ומאושר עקרונית.

**החלטות שעדיין פתוחות (לכשנגיע ל-2.0):**
1. **מקור המנוי הפעיל** — איך השרת יודע שמנוי Advanced/Pro פעיל? (מערכת תשלום קיימת? רשומה ידנית? סנכרון דיסקורד?) זו התלות שתפעיל את כלל המיפוי.
2. **השגת קובצי המקור של קורס The Strat** — תנאי מקדים לבנייתו מחדש (YouTube לא ניתן לשחזור).
3. **מדיניות שימור הקלטות** — לשמור הכול, או רק N אחרונים/מסומנים?

> **הערה:** אין לפתח את Video Hub 2.0 כעת. המיקוד הנוכחי — פרסום ה-PUBLIC LIVE בלבד. אין Merge/Deploy עד אישור מפורש.
```
