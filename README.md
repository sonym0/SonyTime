# Sony time V1.1

Stack: Capacitor 8.5.2 + Filesystem 8.1.3 + Share 8.0.2 + SheetJS 0.18.5 + Cairo 5.3.0.

تطبيق شخصي للحضور والانصراف، يعمل Offline بالكامل.

## ما تم تنفيذه
- لا يوجد CDN أو Google Fonts runtime.
- SheetJS موجود كاعتماد npm ويتم دمجه داخل build النهائي، وليس تحميله من الإنترنت.
- Cairo موجود كاعتماد محلي ويتم نسخه إلى `public/assets/fonts` أثناء build.
- البيانات في `Documents/SonyTime/data.json` عبر Capacitor Filesystem على Android.
- حفظ تلقائي بعد الحضور والانصراف والحذف ومسح الشهر.
- نسخة احتياطية يومية عند أول فتح للتطبيق في ذلك اليوم داخل `Documents/SonyTime/backup/`.
- زر استرجاع أحدث نسخة احتياطية.
- ملفات Excel داخل `Documents/SonyTime/exports/` مع زر مشاركة آخر ملف.
- RTL وتصميم Sony time الأصلي محفوظ.

## بناء APK بدون Android Studio
1. ارفع المشروع إلى GitHub.
2. افتح تبويب **Actions**.
3. شغّل workflow باسم **Build Sony time APK** أو اعمل Push جديد.
4. بعد نجاح الـ workflow افتح الـ Run.
5. من **Artifacts** نزّل `sony-time-v1.1-debug-apk`.
6. فك الضغط وثبّت `app-debug.apk` على الهاتف.

> ملاحظة: النسخة الاحتياطية اليومية تُنشأ تلقائيًا عند أول تشغيل للتطبيق في كل يوم. تشغيل JS في الخلفية 24/7 ليس مضمونًا على Android، لذلك لم أدّعِ جدولة خلفية لم تُختبر.

## ملاحظة Android Documents
Capacitor Filesystem يستخدم `Directory.Documents`. على Android 11+ الملفات التي ينشئها التطبيق داخل Documents تكون ضمن نطاق الملفات التي يستطيع التطبيق الوصول إليها. هذا هو السلوك المقصود لهذا التطبيق الشخصي.
