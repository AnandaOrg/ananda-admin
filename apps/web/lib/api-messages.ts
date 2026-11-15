// Messages the API sends with an error, shown in the person's language (design system: Toasts and errors,
// "never a raw message from the server"). The API words its errors in plain English; Bulgarian and Hebrew
// are looked up here, and anything not listed falls back to one generic sentence so no English or server
// text ever reaches a BG/HE screen. Add a row here when the API gets a new message people can act on.

type Lang = 'bg' | 'he';
type Row = [en: string, bg: string, he: string];

const GENERIC = { bg: 'Не се получи. Опитайте пак.', he: 'הפעולה לא הושלמה. אפשר לנסות שוב.' } as const;
const GENERIC_FIELD = { bg: 'Проверете това поле', he: 'יש לבדוק את השדה' } as const;

/** Whole-sentence messages (form level, shown above the buttons). */
const MESSAGES: Row[] = [
  ['Something went wrong. Try again.', 'Нещо се обърка. Опитайте пак.', 'משהו השתבש. אפשר לנסות שוב.'],
  ['Check your connection and try again.', 'Проверете връзката и опитайте пак.', 'כדאי לבדוק את החיבור ולנסות שוב.'],
  ['Something went wrong on our side. Try again in a minute.', 'Нещо се обърка при нас. Опитайте след минута.', 'משהו השתבש אצלנו. כדאי לנסות שוב בעוד דקה.'],
  ['Check the highlighted fields', 'Проверете отбелязаните полета', 'יש לבדוק את השדות המסומנים'],
  ['You do not have access to this', 'Нямате достъп до това', 'אין לך גישה לזה'],
  ['Not found', 'Не е намерено', 'לא נמצא'],
  ['Customer not found', 'Клиентът не е намерен', 'הלקוח לא נמצא'],
  ['Order not found', 'Поръчката не е намерена', 'ההזמנה לא נמצאה'],
  ['Broker not found', 'Брокерът не е намерен', 'הברוקר לא נמצא'],
  ['Document not found', 'Документът не е намерен', 'המסמך לא נמצא'],
  ['Event not found', 'Събитието не е намерено', 'האירוע לא נמצא'],
  ['Expense not found', 'Разходът не е намерен', 'ההוצאה לא נמצאה'],
  ['File not found', 'Файлът не е намерен', 'הקובץ לא נמצא'],
  ['Member not found', 'Членът не е намерен', 'חבר הצוות לא נמצא'],
  ['Message not found', 'Съобщението не е намерено', 'ההודעה לא נמצאה'],
  ['Purchase not found', 'Заявката не е намерена', 'הזמנת הרכש לא נמצאה'],
  ['Purchase order not found', 'Заявката не е намерена', 'הזמנת הרכש לא נמצאה'],
  ['Payable not found', 'Задължението не е намерено', 'החיוב לא נמצא'],
  ['Request not found', 'Заявката не е намерена', 'הבקשה לא נמצאה'],
  ['Role not found', 'Правата не са намерени', 'התפקיד לא נמצא'],
  ['Stock count not found', 'Броенето не е намерено', 'הספירה לא נמצאה'],
  ['Supplier not found', 'Доставчикът не е намерен', 'הספק לא נמצא'],
  ['The e-mail or password is not right', 'Имейлът или паролата не са верни', 'האימייל או הסיסמה שגויים'],
  ['That code did not work. Enter the current code from your app.', 'Кодът не е верен. Въведете текущия код от приложението.', 'הקוד לא תקין. יש להזין את הקוד הנוכחי מהאפליקציה.'],
  ['Scan the QR code first, then enter the code from your app.', 'Първо сканирайте QR кода, после въведете кода от приложението.', 'קודם יש לסרוק את קוד ה-QR, ואז להזין את הקוד מהאפליקציה.'],
  ['Two-step sign-in is already set up', 'Двустепенният вход вече е настроен', 'הכניסה הדו־שלבית כבר הוגדרה'],
  ["You're looking back at a past day. Nothing can be changed.", 'Гледате минал ден. Нищо не може да се променя.', 'את/ה צופה ביום שעבר. אי אפשר לשנות דבר.'],
  ['A customer with this VAT number is already in ANANDA', 'Клиент с този ДДС номер вече е в ANANDA', 'לקוח עם מספר מע״מ זה כבר קיים ב-ANANDA'],
  ['Choose a broker, or No broker', 'Изберете брокер или „Без брокер“', 'יש לבחור ברוקר או ״ללא ברוקר״'],
  ['Choose a broker', 'Изберете брокер', 'יש לבחור ברוקר'],
  ['Choose a customer', 'Изберете клиент', 'יש לבחור לקוח'],
  ['Choose a file', 'Изберете файл', 'יש לבחור קובץ'],
  ['Choose a file to upload', 'Изберете файл за качване', 'יש לבחור קובץ להעלאה'],
  ['Choose a logo file', 'Изберете файл с лого', 'יש לבחור קובץ לוגו'],
  ['Choose the type', 'Изберете вид', 'יש לבחור סוג'],
  ['Choose brokers from the list', 'Изберете брокери от списъка', 'יש לבחור ברוקרים מהרשימה'],
  ['Choose a broker invited to this event', 'Изберете брокер, поканен на събитието', 'יש לבחור ברוקר שהוזמן לאירוע'],
  ['Say what it is', 'Кажете какво е', 'יש לציין מה זה'],
  ['Enter a valid e-mail address', 'Въведете валиден имейл', 'יש להזין כתובת אימייל תקינה'],
  ['Enter a valid e-mail', 'Въведете валиден имейл', 'יש להזין אימייל תקין'],
  ['Enter the cartons sold', 'Въведете продадените кашони', 'יש להזין את הקרטונים שנמכרו'],
  ['Enter the cartons to credit', 'Въведете кашоните за кредитиране', 'יש להזין את הקרטונים לזיכוי'],
  ['Enter the cartons to move', 'Въведете кашоните за преместване', 'יש להזין את הקרטונים להעברה'],
  ['Enter the cartons you delivered now', 'Въведете доставените сега кашони', 'יש להזין את הקרטונים שנמסרו עכשיו'],
  ['Change at least one quantity', 'Променете поне едно количество', 'יש לשנות לפחות כמות אחת'],
  ['Take a photo of the signed note', 'Снимайте подписаната бележка', 'יש לצלם את התעודה החתומה'],
  ['Fill in your company and bank details first', 'Първо попълнете фирмените и банковите си данни', 'קודם יש למלא את פרטי החברה והבנק'],
  ['Fill in your company details first', 'Първо попълнете фирмените си данни', 'קודם יש למלא את פרטי החברה'],
  ["Add the accountant's e-mail in Settings first", 'Първо добавете имейла на счетоводителя в Настройки', 'קודם יש להוסיף את האימייל של רואה החשבון בהגדרות'],
  ['AI polishing is not available right now. Edit the text by hand.', 'Подобряването с AI не е налично сега. Редактирайте текста ръчно.', 'שיפור הטקסט באמצעות AI אינו זמין כרגע. אפשר לערוך ידנית.'],
  ['The text could not be polished. Edit it by hand.', 'Текстът не можа да се подобри. Редактирайте го ръчно.', 'לא ניתן היה לשפר את הטקסט. אפשר לערוך ידנית.'],
  ['AI polishing is not set up', 'Подобряването с AI не е настроено', 'שיפור הטקסט באמצעות AI לא הוגדר'],
  ['This order changed meanwhile. Open it again.', 'Поръчката е променена междувременно. Отворете я отново.', 'ההזמנה השתנתה בינתיים. יש לפתוח אותה מחדש.'],
  ['This request changed meanwhile. Reload and try again.', 'Заявката е променена междувременно. Презаредете и опитайте пак.', 'הבקשה השתנתה בינתיים. יש לרענן ולנסות שוב.'],
  ['This request was already decided', 'По заявката вече има решение', 'כבר התקבלה החלטה בבקשה הזו'],
  ['This request is waiting again already', 'Заявката вече чака отново', 'הבקשה כבר ממתינה שוב'],
  ['This request can no longer be undone', 'Заявката вече не може да се отмени', 'אי אפשר עוד לבטל את הבקשה'],
  ['A request for this order is already waiting', 'Вече има чакаща заявка за тази поръчка', 'כבר יש בקשה ממתינה להזמנה הזו'],
  ['This payment request was already sent', 'Заявката за плащане вече е изпратена', 'בקשת התשלום כבר נשלחה'],
  ['This order is cancelled', 'Поръчката е анулирана', 'ההזמנה בוטלה'],
  ['This payment changed since, so it cannot be undone', 'Плащането е променено междувременно и не може да се отмени', 'התשלום השתנה בינתיים ואי אפשר לבטל אותו'],
  ['This expense changed since, so it cannot be undone', 'Разходът е променен междувременно и не може да се отмени', 'ההוצאה השתנתה בינתיים ואי אפשר לבטל אותה'],
  ['This customer changed since, so it cannot be undone', 'Клиентът е променен междувременно и не може да се отмени', 'הלקוח השתנה בינתיים ואי אפשר לבטל'],
  ['An order was started for this customer since, so it cannot be undone', 'Междувременно е започната поръчка за този клиент и не може да се отмени', 'בינתיים נפתחה הזמנה ללקוח הזה ואי אפשר לבטל'],
  ['The logo changed since, so it cannot be undone', 'Логото е променено междувременно и не може да се отмени', 'הלוגו השתנה בינתיים ואי אפשר לבטל'],
  ['This order is not cancelled', 'Поръчката не е анулирана', 'ההזמנה לא בוטלה'],
  ['This order is paid in full', 'Поръчката е платена изцяло', 'ההזמנה שולמה במלואה'],
  ['This order is not at the warehouse', 'Поръчката не е в склада', 'ההזמנה לא נמצאת במחסן'],
  ['This order is not waiting for a payment', 'Поръчката не чака плащане', 'ההזמנה לא ממתינה לתשלום'],
  ['This order was not delivered in part', 'Поръчката не е доставена частично', 'ההזמנה לא נמסרה חלקית'],
  ['The order must be paid in full before shipping', 'Поръчката трябва да е платена изцяло преди изпращане', 'יש לשלם על ההזמנה במלואה לפני המשלוח'],
  ['Only fully paid orders can be invoiced', 'Само изцяло платени поръчки могат да се фактурират', 'אפשר להפיק חשבונית רק להזמנות ששולמו במלואן'],
  ['Only paid orders with stock can be sent to the warehouse', 'Само платени поръчки с наличност могат да се изпратят към склада', 'אפשר לשלוח למחסן רק הזמנות ששולמו ויש להן מלאי'],
  ['Only drafts can be deleted', 'Само чернови могат да се изтриват', 'אפשר למחוק רק טיוטות'],
  ['Only drafts can be edited. Ask for a correction instead.', 'Само чернови могат да се редактират. Поискайте корекция.', 'אפשר לערוך רק טיוטות. אפשר לבקש תיקון.'],
  ['Orders can be cancelled only before shipping', 'Поръчките могат да се анулират само преди изпращане', 'אפשר לבטל הזמנות רק לפני המשלוח'],
  ['Corrections are possible only before shipping. After invoicing, issue a credit note.', 'Корекции са възможни само преди изпращане. След фактуриране издайте кредитно известие.', 'תיקון אפשרי רק לפני המשלוח. אחרי החשבונית יש להנפיק הודעת זיכוי.'],
  ['The order has shipped; the correction can no longer be applied', 'Поръчката е изпратена, корекцията вече не може да се приложи', 'ההזמנה נשלחה, אי אפשר עוד להחיל את התיקון'],
  ['Invoices are issued once the order is delivered', 'Фактурите се издават след доставка на поръчката', 'חשבוניות מונפקות לאחר מסירת ההזמנה'],
  ['Credit notes follow an invoice', 'Кредитно известие се издава след фактура', 'הודעת זיכוי מונפקת לאחר חשבונית'],
  ['The amount is more than what is owed', 'Сумата е повече от дължимата', 'הסכום גבוה מהחוב'],
  ['More than what is left on the invoice', 'Повече от остатъка по фактурата', 'יותר ממה שנשאר בחשבונית'],
  ['You cannot deliver more than is left', 'Не можете да доставите повече от остатъка', 'אי אפשר למסור יותר ממה שנשאר'],
  ['Decide between a credit note and re-delivery first', 'Първо изберете между кредитно известие и повторна доставка', 'קודם יש לבחור בין הודעת זיכוי למסירה חוזרת'],
  ['A special price can be asked for on a draft only', 'Специална цена може да се поиска само за чернова', 'אפשר לבקש מחיר מיוחד רק בטיוטה'],
  ['Ask for a price below the list price', 'Поискайте цена под тази от листата', 'יש לבקש מחיר נמוך ממחיר המחירון'],
  ['Reach the minimum order first, then ask for a special price', 'Първо достигнете минималната поръчка, после поискайте специална цена', 'קודם יש להגיע להזמנה המינימלית ואז לבקש מחיר מיוחד'],
  ['The special price is waiting for an admin. Send it once it is approved.', 'Специалната цена чака администратор. Изпратете я, след като бъде одобрена.', 'המחיר המיוחד ממתין למנהל. אפשר לשלוח אותו לאחר האישור.'],
  ['Ask an admin to change an approved customer', 'Поискайте от администратор да промени одобрен клиент', 'יש לבקש ממנהל לשנות לקוח מאושר'],
  ['Only an admin can archive customers', 'Само администратор може да архивира клиенти', 'רק מנהל יכול להעביר לקוחות לארכיון'],
  ['Only an admin can change the broker', 'Само администратор може да смени брокера', 'רק מנהל יכול להחליף ברוקר'],
  ['Only an admin can send orders to the warehouse', 'Само администратор може да изпраща поръчки към склада', 'רק מנהל יכול לשלוח הזמנות למחסן'],
  ['This customer belongs to another broker', 'Този клиент е на друг брокер', 'הלקוח הזה שייך לברוקר אחר'],
  ['This customer is not approved yet', 'Този клиент още не е одобрен', 'הלקוח הזה עדיין לא אושר'],
  ['This customer is not free to claim', 'Този клиент не може да се поема', 'אי אפשר לשייך את הלקוח הזה'],
  ['Customers stay with their broker when ownership ends', 'Клиентите остават при брокера си, когато периодът изтече', 'לקוחות נשארים אצל הברוקר שלהם בתום תקופת השיוך'],
  ['This purchase has already been received', 'Заявката вече е получена', 'הרכש כבר התקבל'],
  ['This purchase has not been received yet', 'Заявката още не е получена', 'הרכש עדיין לא התקבל'],
  ['This purchase is cancelled', 'Заявката е анулирана', 'הרכש בוטל'],
  ['Only an ordered purchase can be marked as on the way', 'Само поръчана заявка може да се маркира като на път', 'אפשר לסמן כבדרך רק רכש שהוזמן'],
  ['The supplier invoice is already recorded', 'Фактурата от доставчика вече е записана', 'חשבונית הספק כבר נרשמה'],
  ['This bill is already paid', 'Тази сметка вече е платена', 'החשבון הזה כבר שולם'],
  ['This expense is already paid', 'Този разход вече е платен', 'ההוצאה הזו כבר שולמה'],
  ['This count has already been reconciled', 'Това броене вече е изравнено', 'הספירה הזו כבר הותאמה'],
  ['Not that much stock at the event', 'На събитието няма толкова наличност', 'אין כל כך הרבה מלאי באירוע'],
  ['There is nothing ready to pay for this broker', 'За този брокер няма нищо готово за плащане', 'אין דבר מוכן לתשלום עבור הברוקר הזה'],
  ['There is nothing to mark as paid for this broker', 'За този брокер няма какво да се отбележи като платено', 'אין מה לסמן כשולם עבור הברוקר הזה'],
  ['This broker has not accepted the invitation yet', 'Този брокер още не е приел поканата', 'הברוקר הזה עדיין לא אישר את ההזמנה'],
  ['This invitation is no longer open', 'Поканата вече не е отворена', 'ההזמנה כבר לא פתוחה'],
  ['This invitation link has expired. Ask an admin to send a new one.', 'Връзката за поканата е изтекла. Поискайте нова от администратор.', 'הקישור להזמנה פג תוקף. אפשר לבקש ממנהל הזמנה חדשה.'],
  ['Cancel the invitation instead', 'Вместо това отменете поканата', 'במקום זה יש לבטל את ההזמנה'],
  ['This person has already set a password', 'Този човек вече е задал парола', 'האדם הזה כבר קבע סיסמה'],
  ['This person never set a password. Resend the invitation instead.', 'Този човек не е задавал парола. Изпратете поканата отново.', 'האדם הזה לא קבע סיסמה. יש לשלוח את ההזמנה שוב.'],
  ['You cannot change your own role or status. Ask another System admin.', 'Не можете да променяте собствените си права или статус. Поискайте от друг Системен администратор.', 'אי אפשר לשנות את התפקיד או הסטטוס שלך. אפשר לבקש ממנהל מערכת אחר.'],
  ['Keep at least one active System admin', 'Трябва да остане поне един активен Системен администратор', 'יש להשאיר לפחות מנהל מערכת פעיל אחד'],
  ['Move the members to another role first', 'Първо преместете членовете към други права', 'קודם יש להעביר את חברי הצוות לתפקיד אחר'],
  ['System roles cannot be removed', 'Стандартните права не могат да се премахват', 'אי אפשר להסיר תפקידי מערכת'],
  ['System roles cannot be changed. Duplicate it as a custom role instead.', 'Стандартните права не могат да се променят. Дублирайте ги като персонални.', 'אי אפשר לשנות תפקידי מערכת. אפשר לשכפל כתפקיד מותאם.'],
  ['Only System admin roles can change business rules', 'Само Системен администратор може да променя бизнес правилата', 'רק מנהל מערכת יכול לשנות כללים עסקיים'],
  ['Only a System admin can preview roles', 'Само Системен администратор може да прегледа права', 'רק מנהל מערכת יכול לצפות בתפקידים'],
  ['Broker roles always see only their own customers and orders', 'Брокерите винаги виждат само своите клиенти и поръчки', 'ברוקרים רואים תמיד רק את הלקוחות וההזמנות שלהם'],
  ['The broker role is fixed: brokers always see only their own customers and orders', 'Правата на брокер са фиксирани: виждат само своите клиенти и поръчки', 'תפקיד הברוקר קבוע: ברוקרים רואים רק את הלקוחות וההזמנות שלהם'],
  ['Only the broker fills in their own set-up', 'Настройката се попълва само от самия брокер', 'רק הברוקר ממלא את ההגדרה שלו'],
  ['Only the broker signs their own agreement', 'Договорът се подписва само от самия брокер', 'רק הברוקר חותם על ההסכם שלו'],
  ['You have already signed the agreement', 'Вече сте подписали договора', 'כבר חתמת על ההסכם'],
  ['The agreement is already signed. Ask an Admin to change your details.', 'Договорът вече е подписан. Поискайте промяна на данните от администратор.', 'ההסכם כבר נחתם. אפשר לבקש ממנהל לשנות את הפרטים.'],
  ['The logo is too large', 'Логото е твърде голямо', 'הלוגו גדול מדי'],
  ['No logo yet', 'Още няма лого', 'עדיין אין לוגו'],
  ['This document has no file', 'Този документ няма файл', 'למסמך הזה אין קובץ'],
  ['Not printable', 'Не може да се отпечата', 'אי אפשר להדפיס'],
  ['The limit is 10 MB.', 'Ограничението е 10 MB.', 'המגבלה היא 10 MB.'],
  ['Unknown rule', 'Непознато правило', 'כלל לא מוכר'],
  ['Unknown setting', 'Непозната настройка', 'הגדרה לא מוכרת'],
  ['Unknown settings card', 'Непозната карта с настройки', 'כרטיס הגדרות לא מוכר'],
  ['The broker role is missing', 'Липсват права за брокер', 'תפקיד הברוקר חסר'],
];

/** Field-level messages (shown under one input). */
const FIELDS: Row[] = [
  ['Required', 'Задължително', 'שדה חובה'],
  ['Fill this in', 'Попълнете полето', 'יש למלא שדה זה'],
  ['Already in ANANDA', 'Вече е в ANANDA', 'כבר קיים ב-ANANDA'],
  ['Choose a broker', 'Изберете брокер', 'יש לבחור ברוקר'],
  ['Choose a customer', 'Изберете клиент', 'יש לבחור לקוח'],
  ['Choose a file', 'Изберете файл', 'יש לבחור קובץ'],
  ['Choose the type', 'Изберете вид', 'יש לבחור סוג'],
  ['Choose an approved supplier', 'Изберете одобрен доставчик', 'יש לבחור ספק מאושר'],
  ['Choose an SVG or PNG file', 'Изберете SVG или PNG файл', 'יש לבחור קובץ SVG או PNG'],
  ['Choose one of the bank accounts', 'Изберете една от банковите сметки', 'יש לבחור אחד מחשבונות הבנק'],
  ['Choose brokers from the list', 'Изберете брокери от списъка', 'יש לבחור ברוקרים מהרשימה'],
  ['Choose a broker invited to this event', 'Изберете брокер, поканен на събитието', 'יש לבחור ברוקר שהוזמן לאירוע'],
  ['Choose today or a later date', 'Изберете днес или по-късна дата', 'יש לבחור את היום או תאריך מאוחר יותר'],
  ['Pick today or an earlier date', 'Изберете днес или по-ранна дата', 'יש לבחור את היום או תאריך מוקדם יותר'],
  ['Pick a role', 'Изберете права', 'יש לבחור תפקיד'],
  ['Enter a valid e-mail address', 'Въведете валиден имейл', 'יש להזין אימייל תקין'],
  ['Enter a valid e-mail', 'Въведете валиден имейл', 'יש להזין אימייל תקין'],
  ['Enter cartons for at least one flavour', 'Въведете кашони за поне един вкус', 'יש להזין קרטונים לפחות לטעם אחד'],
  ['Enter the cartons sold', 'Въведете продадените кашони', 'יש להזין את הקרטונים שנמכרו'],
  ['Enter the cartons to move', 'Въведете кашоните за преместване', 'יש להזין את הקרטונים להעברה'],
  ['Enter the cartons you delivered now', 'Въведете доставените сега кашони', 'יש להזין את הקרטונים שנמסרו עכשיו'],
  ['Enter the units counted', 'Въведете преброените бройки', 'יש להזין את היחידות שנספרו'],
  ['Fixed for broker roles', 'Фиксирано за брокерите', 'קבוע לברוקרים'],
  ['Only System admin roles can change business rules', 'Само Системен администратор може да променя бизнес правилата', 'רק מנהל מערכת יכול לשנות כללים עסקיים'],
  ['Say what it is, so the Admin knows where it belongs.', 'Кажете какво е, за да знае администраторът къде да го сложи.', 'יש לציין מה זה, כדי שהמנהל ידע לאן לשייך.'],
  ['Take a photo of the signed note', 'Снимайте подписаната бележка', 'יש לצלם את התעודה החתומה'],
  ['That code did not work', 'Кодът не е верен', 'הקוד לא תקין'],
  ['The arrival date cannot be in the future', 'Датата на пристигане не може да е в бъдещето', 'תאריך ההגעה לא יכול להיות בעתיד'],
  ['The end date is before the start date', 'Крайната дата е преди началната', 'תאריך הסיום קודם לתאריך ההתחלה'],
  ['The form could not be read. Try again.', 'Формулярът не можа да се прочете. Опитайте пак.', 'לא ניתן היה לקרוא את הטופס. אפשר לנסות שוב.'],
  ['The limit is 10 MB.', 'Ограничението е 10 MB.', 'המגבלה היא 10 MB.'],
  ['The payment date cannot be in the future', 'Датата на плащане не може да е в бъдещето', 'תאריך התשלום לא יכול להיות בעתיד'],
  ['This e-mail already has an account', 'Този имейл вече има профил', 'לאימייל הזה כבר יש חשבון'],
  ['This is less than what was already paid to the carrier', 'Това е по-малко от вече платеното на превозвача', 'הסכום נמוך ממה ששולם כבר למוביל'],
  ['Upload a photo (JPG, PNG, HEIC) or a PDF', 'Качете снимка (JPG, PNG, HEIC) или PDF', 'יש להעלות תמונה (JPG, PNG, HEIC) או PDF'],
  ['Upload a photo or a PDF', 'Качете снимка или PDF', 'יש להעלות תמונה או PDF'],
  ['Upload a scan or clear photos of all pages', 'Качете скан или ясни снимки на всички страници', 'יש להעלות סריקה או תמונות ברורות של כל העמודים'],
  ['Use a PDF, JPG or PNG', 'Използвайте PDF, JPG или PNG', 'יש להשתמש ב-PDF, JPG או PNG'],
  ['Use a PDF, JPG, PNG or HEIC.', 'Само PDF, JPG, PNG или HEIC.', 'רק PDF, JPG, PNG או HEIC.'],
  ['Use a file under 2 MB', 'Използвайте файл под 2 MB', 'יש להשתמש בקובץ קטן מ-2 MB'],
  ['Use an SVG or PNG file', 'Използвайте SVG или PNG файл', 'יש להשתמש בקובץ SVG או PNG'],
  ['Waiting for approval', 'Чака одобрение', 'ממתין לאישור'],
  ['Warehouse roles never see prices', 'Складът никога не вижда цени', 'תפקידי מחסן לא רואים מחירים'],
  ['Your current password is not right', 'Текущата парола не е вярна', 'הסיסמה הנוכחית שגויה'],
  ['Another role already has this name', 'Други права вече имат това име', 'לתפקיד אחר כבר יש את השם הזה'],
  ["This IBAN doesn't add up. Check for a missing or swapped character.", 'Този IBAN не е верен. Проверете за липсващ или разменен знак.', 'ה-IBAN לא תקין. יש לבדוק אם חסר תו או שתווים הוחלפו.'],
  ['A broker\'s account stays a broker. Invite them again with another e-mail for other access.', 'Профилът на брокер си остава брокерски. Поканете го отново с друг имейл за друг достъп.', 'חשבון של ברוקר נשאר ברוקר. אפשר להזמין אותו שוב עם אימייל אחר לגישה אחרת.'],
  ['A supplier can only be the default for flavours it is approved for', 'Доставчикът може да е основен само за вкусове, за които е одобрен', 'ספק יכול להיות ברירת מחדל רק לטעמים שאושר עבורם'],
];

const mk = (rows: Row[], i: 1 | 2) => new Map(rows.map((r) => [r[0], r[i]]));
const MAPS = { msg: { bg: mk(MESSAGES, 1), he: mk(MESSAGES, 2) }, field: { bg: mk(FIELDS, 1), he: mk(FIELDS, 2) } };

/** Messages that carry a number or name (matched by shape). */
const PATTERNS: [RegExp, Record<Lang, (m: RegExpMatchArray) => string>][] = [
  [/^Add (\d+) more cartons to reach the minimum of (\d+)$/, { bg: (m) => `Добавете още ${m[1]} кашона до минимума от ${m[2]}`, he: (m) => `יש להוסיף עוד ${m[1]} קרטונים עד למינימום של ${m[2]}` }],
  [/^The minimum order is (\d+) cartons$/, { bg: (m) => `Минималната поръчка е ${m[1]} кашона`, he: (m) => `ההזמנה המינימלית היא ${m[1]} קרטונים` }],
  [/^At most (\d+) cartons of (.+) can be credited$/, { bg: (m) => `Най-много ${m[1]} кашона ${m[2]} могат да се кредитират`, he: (m) => `אפשר לזכות לכל היותר ${m[1]} קרטונים של ${m[2]}` }],
  [/^At most (\d+)$/, { bg: (m) => `Най-много ${m[1]}`, he: (m) => `לכל היותר ${m[1]}` }],
  [/^Not enough stock for (.+)\. Untick it and try again\.$/, { bg: (m) => `Няма достатъчно наличност за ${m[1]}. Махнете отметката и опитайте пак.`, he: (m) => `אין מספיק מלאי עבור ${m[1]}. יש להסיר את הסימון ולנסות שוב.` }],
  [/^(.+) was already nudged today$/, { bg: (m) => `${m[1]} вече е подсетен днес`, he: (m) => `${m[1]} כבר קיבל תזכורת היום` }],
  [/^(.+) has not signed the agreement yet$/, { bg: (m) => `${m[1]} още не е подписал договора`, he: (m) => `${m[1]} עדיין לא חתם על ההסכם` }],
  [/^(.+) already countersigned this agreement$/, { bg: (m) => `${m[1]} вече е подписал договора`, he: (m) => `${m[1]} כבר חתם על ההסכם` }],
  [/^(.+)'s set-up isn't finished: countersign the broker agreement first$/, { bg: (m) => `Настройката на ${m[1]} не е завършена: първо подпишете брокерския договор`, he: (m) => `ההגדרה של ${m[1]} לא הסתיימה: קודם יש לחתום על הסכם הברוקר` }],
  [/payment request already (?:went|was)/, { bg: () => 'Заявката за плащане вече е изпратена, затова одобрението остава.', he: () => 'בקשת התשלום כבר נשלחה, ולכן האישור נשאר.' }],
  [/^Decisions can be undone for (\d+) minutes\./, { bg: (m) => `Решенията могат да се отменят в рамките на ${m[1]} минути. Помолете брокера да я изпрати отново.`, he: (m) => `אפשר לבטל החלטה במשך ${m[1]} דקות. אפשר לבקש מהברוקר לשלוח שוב.` }],
  [/^A payment can be undone for (\d+) minutes\./, { bg: (m) => `Плащане може да се отмени в рамките на ${m[1]} минути. Помолете финансите да го коригират.`, he: (m) => `אפשר לבטל תשלום במשך ${m[1]} דקות. אפשר לבקש מהכספים לתקן.` }],
  [/^This can be undone for (\d+) minutes$/, { bg: (m) => `Може да се отмени в рамките на ${m[1]} минути`, he: (m) => `אפשר לבטל במשך ${m[1]} דקות` }],
  [/^The EU register says this customer's VAT number isn't valid\./, { bg: () => 'Регистърът на ЕС казва, че ДДС номерът на клиента не е валиден. Поправете го в картата на клиента и изпратете заявката за плащане.', he: () => 'מרשם האיחוד האירופי מציין שמספר המע״מ של הלקוח אינו תקין. יש לתקן אותו בכרטיס הלקוח ואז לשלוח את בקשת התשלום.' }],
  [/^This order has a payment\./, { bg: () => 'Поръчката има плащане. Поискайте от администратор.', he: () => 'להזמנה יש תשלום. אפשר לבקש ממנהל.' }],
  [/^A Bulgarian EIK has 9 digits/, { bg: () => 'ЕИК е с 9 цифри; ДДС номерът е BG и ЕИК.', he: () => 'ח״פ בולגרי הוא בן 9 ספרות; מספר מע״מ הוא BG ואחריו הח״פ.' }],
  [/^Enter the EU VAT number/, { bg: () => 'Въведете ДДС номер от ЕС, напр. EL123456789', he: () => 'יש להזין מספר מע״מ אירופי, למשל EL123456789' }],
  [/^At least (\d+) /, { bg: (m) => `Поне ${m[1]}`, he: (m) => `לפחות ${m[1]}` }],
];

function lang(): Lang | null {
  if (typeof document === 'undefined') return null;
  const l = document.documentElement.lang;
  return l === 'bg' || l === 'he' ? l : null;
}

function translate(kind: 'msg' | 'field', text: string, l: Lang): string {
  const hit = MAPS[kind][l].get(text) ?? MAPS[kind === 'msg' ? 'field' : 'msg'][l].get(text);
  if (hit) return hit;
  for (const [re, f] of PATTERNS) {
    const m = text.match(re);
    if (m) return f[l](m);
  }
  return kind === 'msg' ? GENERIC[l] : GENERIC_FIELD[l];
}

/** The sentence for a failed action in the page language (EN keeps the API's own plain wording). */
export function localizeApiMessage(text: string): string {
  const l = lang();
  return l ? translate('msg', text, l) : text;
}

/** The note under one field in the page language. */
export function localizeFieldMessage(text: string): string {
  const l = lang();
  return l ? translate('field', text, l) : text;
}
