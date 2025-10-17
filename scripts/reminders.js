// scripts/reminders.js  (versión completa, CommonJS)
console.log('Admin SA project_id:', JSON.parse(process.env.GCP_SA_KEY).project_id);
console.log('ENV GCP_PROJECT_ID  :', process.env.GCP_PROJECT_ID);

const admin = require('firebase-admin');
const moment = require('moment-timezone');

// Lee credenciales del Secret de GitHub Actions
const sa = JSON.parse(process.env.GCP_SA_KEY);

// Inicializa Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(sa),
  projectId: process.env.GCP_PROJECT_ID,
});

const DB = admin.firestore();

// Utilidad: mapa día (español) a isoWeekday (1=lu ... 7=do)
function toWeekday(dia) {
  const s = String(dia || '')
    .toLowerCase()
    .replaceAll('á','a').replaceAll('é','e').replaceAll('í','i').replaceAll('ó','o').replaceAll('ú','u')
    .trim();
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
  const defaultTz = 'America/Mexico_City';
  const snap = await DB.collection('schedules').get();

  console.log(`📚 Found ${snap.size} schedule doc(s).`);

  let sendCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data();

    // Usa el token del campo o, si no existe, el ID del documento
    const token = data.token || doc.id;
    if (!token) {
      console.log(`⚠️  Doc ${doc.id} sin token, se omite.`);
      continue;
    }

    const classes = Array.isArray(data.classes) ? data.classes : [];
    if (!classes.length) {
      console.log(`ℹ️  ${token.slice(0, 12)}… sin clases, se omite.`);
      continue;
    }

    const tz = data.tz || defaultTz;
    const now = moment().tz(tz);

    for (const cls of classes) {
      const wd = toWeekday(cls.dia);
      const [h, m] = String(cls.inicio || '07:00').split(':').map(Number);

      // Próxima ocurrencia semanal de esa clase
      let start = now.clone().isoWeekday(wd).hour(h).minute(m).second(0).millisecond(0);
      if (start.isBefore(now)) start = start.add(1, 'week');

      // Ventanas T-10 y T-5 (con tolerancia de 10 min hacia atrás y 1 min hacia adelante)
      for (const minutesBefore of [10, 5]) {
        const execAt = start.clone().subtract(minutesBefore, 'minutes');
        const diffMin = execAt.diff(now, 'minutes');

        if (diffMin >= -10 && diffMin <= 1) {
          const title = `Clase: ${cls.materia ?? cls.nombre ?? 'Materia'}`;
          const body = `Empieza a las ${start.format('HH:mm')}${cls.salon ? ` • Salón ${cls.salon}` : ''}`;

          console.log(
            `📤 Enviando a ${token.slice(0, 12)}… | ${title} | T-${minutesBefore} | ${start.format()} (${tz})`
          );

          await admin.messaging().send({
            token,

            // Hace que Android la muestre en segundo plano
            notification: { title, body },

            android: {
              priority: 'high',
              notification: {
                channelId: 'reminders',
                sound: 'default',
              },
              ttl: 40 * 60 * 1000, // 40 min
            },

            apns: {
              payload: {
                aps: {
                  alert: { title, body },
                  sound: 'default',
                },
              },
            },

            // Datos extra (opcionales)
            data: {
              type: 'class_reminder',
              minutesBefore: String(minutesBefore),
              classStartIso: start.toISOString(),
              materia: String(cls.materia ?? cls.nombre ?? ''),
            },
          });

          sendCount++;
        }
      }
    }
  }

  console.log(sendCount ? `✅ Sent ${sendCount} notifications` : 'ℹ️ No notifications to send this tick.');
}

// Ejecuta
run().catch((e) => {
  console.error(e);
  process.exit(1);
});

