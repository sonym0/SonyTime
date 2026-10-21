Esraa v3 (تطبيق حضور وانصراف شخصي، الهوية: ريشة نيون، اسم Esraa ♥🦌) — Capacitor + Vite + SheetJS، RTL عربي، Offline بالكامل (ممنوع CDN/إنترنت/Supabase).
src/data.js: normalize()/merge() لقراءة أي JSON. src/main.js: الواجهة والتخزين (Documents/SonyTime). src/style.css: التصميم.
القواعد: لا تكتب فوق data.json لو القراءة فشلت (locked). snapshot قبل أي استبدال/مسح. الاستيراد عبر input[type=file] (بدون صلاحيات).
قبل أي commit: node --check src/main.js && npm run check:offline. ادفع على فرع جديد؛ workflow "Build Sony time APK" يبني الـ APK.

الهوية: public/assets/bg.jpg (خلفية) و logo.png، وأيقونات أندرويد في branding/android-res (الـ workflow بينسخها). التخزين الأساسي Directory.Data وليس Documents.
