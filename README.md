# Sony time V1.1

Stack: Capacitor 8.5.2 + Filesystem 8.1.3 + Share 8.0.2 + SheetJS 0.18.5 + Cairo 5.3.0.

تطبيق شخصي للحضور والانصراف، يعمل Offline بالكامل.

## ما تم تنفيذه
- لا يوجد CDN أو Google Fonts runtime.
- SheetJS موجود كاعتماد npm ويتم دمجه داخل build النهائي، وليس تحميله من الإنترنت.
- Cairo موجود كاعتماد محلي ويتم نسخه إلى `public/assets/fonts` أثناء build.
- البيانات في `Documents/SonyTime/data.json` عبر Capacitor Filesystem على Android.
- حفظ تلقائي بعد الحضور والانصراف والحذف ومسح الشهر.
- نسخة يومية تتحقق من سلامتها ولا تستبدل نسخة سابقة سليمة؛ تُحفظ نسخ أمان قبل كل كتابة للسجل.
- التحقق من بنية سجل الحضور والنسخ الاحتياطية قبل الحفظ أو الاستعادة؛ فشل القراءة/JSON التالف لا يتحول إلى سجل فارغ.
- تصدير نسخة JSON عبر قائمة مشاركة Android لاختيار Files/Drive أو تنزيلها في المتصفح، واستيرادها عبر منتقي الملفات مع تأكيد قبل الاستبدال.
- الملف التالف الأصلي يُحفظ في `Documents/SonyTime/recovery/` قبل الاستعادة؛ لا يتم استبداله بصمت.
- ملفات Excel داخل `Documents/SonyTime/exports/` مع زر مشاركة آخر ملف.
- RTL وتصميم Sony time الأصلي محفوظ.

## بناء APK اختباري بدون Android Studio
1. يلزم وجود commit وفرع التطوير على GitHub؛ التعديلات المحلية غير المرفوعة لا تصل إلى Actions.
2. افتح **Actions → Build Sony time APK → Run workflow** واختر فرع التطوير، أو استخدم البناء التلقائي عند Push.
3. بعد نجاح الـ workflow نزّل Artifact باسم `sony-time-test-v1.1-debug-apk`.
4. هذا APK اختباري موقّع بتوقيع Debug فقط، ولا ينشئ Release أو يستخدم مفتاح التوقيع الإنتاجي.
5. معرّف الاختبار `com.sonytime.app.test`؛ لا تثبّته فوق النسخة الأساسية، وافحص المعرّف والتوقيع قبل التثبيت.

علامة الاختبار في الـworkflow تغيّر أيضًا مساحة التخزين إلى `Documents/SonyTimeTest/` و`Cache/SonyTimeTest/`. البناء العادي يظل على `com.sonytime.app` ومسارات `SonyTime/` الأصلية.

> ملاحظة: النسخة الاحتياطية اليومية تُنشأ تلقائيًا عند أول تشغيل للتطبيق في كل يوم. تشغيل JS في الخلفية 24/7 ليس مضمونًا على Android، لذلك لم أدّعِ جدولة خلفية لم تُختبر.

## ملاحظة Android Documents
Capacitor Filesystem يستخدم `Directory.Documents`. على Android 11+ الملفات التي ينشئها التطبيق داخل Documents تكون ضمن نطاق الملفات التي يستطيع التطبيق الوصول إليها. هذا هو السلوك المقصود لهذا التطبيق الشخصي.

## مزامنة السحابة مع Supabase (اختياري)
- التطبيق يعمل Offline افتراضيًا؛ البيانات تُحفظ محليًا في `Documents/SonyTime/data.json`.
- إذا ضبطت متغيري البيئة `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY` (في `.env` محليًا أو في GitHub Secrets للبناء)، يُرفع كل تغيير إلى جدول `attendance_sessions` على Supabase بعد كل عملية حفظ.
- عند بدء التشغيل، إذا كان الملف المحلي مفقودًا أو تالفًا، يحاول التطبيق سحب السجلات من Supabase واستعادتها.
- زر "مزامنة مع السحابة الآن" في شاشة التطبيق يتيح مزامنة فورية يدوية عند وجود إنترنت.
- لا تُPrint أو تُخزن مفاتيح API داخل الكود المصدري؛ تُقرأ فقط من متغيرات البيئة وقت البناء.

### جدول Supabase المطلوب
```sql
create table attendance_sessions (
  id bigint primary key,
  i timestamp with time zone not null,
  o timestamp with time zone,
  updated_at timestamp with time zone default now()
);
alter table attendance_sessions enable row level security;
-- يمكن وضع سياسات RLS حسب الحاجة (المثال يفتح القراءة/الكتابة للأغراض الشخصية)
create policy "Allow all" on attendance_sessions for all using (true);
```
