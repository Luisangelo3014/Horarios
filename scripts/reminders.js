const snap = await DB.collection('schedules').get();
let sendCount = 0;

for (const doc of snap.docs) {
  const data = doc.data();

  // Toma el token del campo o del ID del doc
  const token = data.token || doc.id;
  if (!token) {
    console.log(`⚠️  Documento ${doc.id} sin token. Saltando.`);
    continue;
  }

  // Asegura arreglo de clases
  const classes = Array.isArray(data.classes) ? data.classes : [];
  if (!classes.length) {
    console.log(`ℹ️  ${token.slice(0, 12)}… sin clases. Saltando.`);
    continue;
  }

  const tz = data.tz || 'America/Mexico_City';
  const now = moment().tz(tz);
  const nowIsoWd = now.isoWeekday(); // 1 lunes … 7 domingo

  // Mapea día → número
  const toWd = (dia) => {
    const s = (dia || '').toLowerCase()
      .replace('á','a').replace('é','e').replace('í','i')
      .replace('ó','o').replace('ú','u').trim();
    if (s.startsWith('lun')) return 1;
    if (s.startsWith('mar')) return 2;
    if (s.startsWith('mie')) return 3;
    if (s.startsWith('jue')) return 4;
    if (s.startsWith('vie')) return 5;
    if (s.startsWith('sab')) return 6;
    if (s.startsWith('dom')) return 7;
    return 1;
  };

  for (const h of classes) {
    const wd = toWd(h.dia);
    const [hh, mm] = String(h.inicio || '07:00').split(':').map(Number);

    // próxima ocurrencia de esa clase
    let start = now.clone().isoWeekday(wd).hour(hh).minute(mm).second(0).millisecond(0);
    if (start.isBefore(now)) start = start.add(1, 'week');

    for (const minutesBefore of [10, 5]) {
      const execAt = start.clone().subtract(minutesBefore, 'minutes');
      const diffMin = execAt.diff(now, 'minutes');

      // ventana de disparo: entre -10 y +1 min de la marca objetivo
      if (diffMin >= -10 && diffMin <= 1) {
        const title = `Clase: ${h.materia ?? h.nombre ?? 'Materia'}`;
        const body  = `Empieza a las ${start.format('HH:mm')}${h.salon ? ` • Salón ${h.salon}` : ''}`;

        console.log(`📤 Enviando a ${token.slice(0, 12)}…  (${minutesBefore} min antes)  ${title}`);

        await admin.messaging().send({
          token, // 👈 AHORA SÍ SIEMPRE HAY TOKEN

          // hace que Android muestre la noti en segundo plano
          notification: { title, body },

          android: {
            priority: 'high',
            notification: {
              channelId: 'reminders',
              sound: 'default',
            },
          },

          apns: {
            payload: {
              aps: { alert: { title, body }, sound: 'default' }
            }
          },

          // datos extra opcionales
          data: {
            type: 'class_reminder',
            minutesBefore: String(minutesBefore),
            classStartIso: start.toISOString(),
            materia: String(h.materia ?? h.nombre ?? ''),
          },
        });

        sendCount++;
      }
    }
  }
}

console.log(sendCount ? `Sent ${sendCount} notifications` : 'No notifications to send this tick.');
