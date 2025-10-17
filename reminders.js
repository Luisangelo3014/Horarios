// scripts/reminders.js
const admin = require('firebase-admin');
const moment = require('moment-timezone');

const sa = JSON.parse(process.env.GCP_SA_KEY);
admin.initializeApp({
  credential: admin.credential.cert(sa),
  projectId: process.env.GCP_PROJECT_ID,
});

const DB = admin.firestore();

// Normalizador de día (igual que en Flutter)
function toWeekday(dia) {
  const s = (dia||'').toLowerCase()
    .replaceAll('á','a').replaceAll('é','e').replaceAll('í','i').replaceAll('ó','o').replaceAll('ú','u').trim();
  if (s.startsWith('lun')) return 1;
  if (s.startsWith('mar')) return 2;
  if (s.startsWith('mie')) return 3;
  if (s.startsWith('jue')) return 4;
  if (s.startsWith('vie')) return 5;
  if (s.startsWith('sab')) return 6;
  if (s.startsWith('dom')) return 7;
  return 1;
}

async function run() {
  const now = moment().tz('America/Mexico_City'); // o la tz por defecto
  const graceMin = 10; // ventana de gracia

  // 1) Lee todos los schedules
  const snap = await DB.collection('schedules').get();
  const sends = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const token = data.token;
    const tz = data.tz || 'America/Mexico_City';
    const classes = Array.isArray(data.classes) ? data.classes : [];
    const nowTz = moment().tz(tz);

    // 2) Para cada clase, genera T-10 y T-5 de la PRÓXIMA ocurrencia semanal
    for (const cls of classes) {
      const wd = toWeekday(cls.dia);
      const [h, m] = (cls.inicio||'07:00').split(':').map(Number);

      // Próximo inicio de clase según tz/weekday
      let start = nowTz.clone().isoWeekday(wd).hour(h).minute(m).second(0).millisecond(0);
      if (start.isBefore(nowTz)) start = start.add(1, 'week');

      for (const minutesBefore of [10,5]) {
        const execAt = start.clone().subtract(minutesBefore, 'minutes');

        // ¿Debemos enviar ahora? ventana = [-graceMin, +1] minutos desde "ahora"
        const diffMin = execAt.diff(nowTz, 'minutes');
        if (diffMin >= -graceMin && diffMin <= 1) {
          // Enviar FCM
          const title = `⏰ ${cls.materia || 'Clase'}`;
          const hourStr = start.format('HH:mm');
          const body = cls.salon ? `Empieza a las ${hourStr} en ${cls.salon}.` : `Empieza a las ${hourStr}.`;

          const msg = {
            token,
            android: {
              priority: 'high',
              ttl: 40 * 60 * 1000, // 40 min
              notification: { title, body },
            },
            apns: { headers: { 'apns-priority': '10' } },
            data: {
              type: 'class_reminder',
              minutesBefore: String(minutesBefore),
              classStartIso: start.toISOString(),
            },
          };

          sends.push(admin.messaging().send(msg));
        }
      }
    }
  }

  if (sends.length) {
    await Promise.allSettled(sends);
    console.log(`Sent ${sends.length} notifications`);
  } else {
    console.log('No notifications to send this tick.');
  }
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
