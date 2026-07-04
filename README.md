# StratNinja Platform

יומן מסחר חכם (Tradezella-style) — פלטפורמה חדשה עם התחברות-גוגל ושמירה בענן.

## Stack
- אתר סטטי (HTML/CSS/JS, ללא שלב build)
- **Supabase** — התחברות (Google OAuth) + מסד נתונים בענן (Postgres)
- מתארח על **Vercel**

## מצבי הרצה
- **מצב מקומי** (ברירת מחדל, ללא הגדרת Supabase) — ללא התחברות, הנתונים ב-`localStorage`. נוח לפיתוח.
- **מצב ענן** — מלא ב-`config.js` את `SUPABASE_URL` ו-`SUPABASE_ANON_KEY` → מפעיל התחברות-גוגל ושמירה בענן.

## קבצים
| קובץ | תפקיד |
|------|-------|
| `index.html` | דף נחיתה + מעטפת האפליקציה |
| `landing.css` / `style.css` | עיצוב |
| `config.js` | הגדרות Supabase (ריק = מצב מקומי) |
| `auth.js` | עטיפת התחברות סביב Supabase (נפילה חיננית למצב מקומי) |
| `platform.js` | בקר מעבר נחיתה⇄אפליקציה + UI התחברות |
| `engine.js` | מנוע חישוב (פרסור CSV, FIFO, סטטיסטיקות) |
| `journal.js` | ממשק היומן (לוח שנה, עקומת הון, עסקאות) |

## הרצה מקומית
```
python -m http.server 8767
```
פתח http://localhost:8767

## TODO (הבא בתור)
- [ ] שכבת אחסון בענן (Supabase) שמחליפה את `localStorage` פר-משתמש
- [ ] הגדרת פרויקט Supabase + Google OAuth
- [ ] דיפלוי ל-Vercel + חיבור GitHub
- [ ] תרגום EN + toggle שפה
