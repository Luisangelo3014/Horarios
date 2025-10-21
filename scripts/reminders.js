// scripts/reminders.js
'use strict';

const admin = require('firebase-admin');
const moment = require('moment-timezone');

console.log('🔧 Env keys loaded:', Object.keys(process.env).filter(k => k.startsWith('GCP_')));

// --- Inicialización única del Admin SDK ---
function initAdmin() {
  const sa = JSON.parse(process.env.GCP_SA_KEY || '{}');
  if (!sa.client_email) {
    throw new Error('GCP_SA_KEY no está definido o es inválido');
  }
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      projectId: process.env.GCP_PROJECT_ID,
    });
  }
  console.log('Admin projectId:', admin.app().options.projectId);
  console.log('SA email:', sa.client_email);

  console.log('SA project_id:', sa.project_id);


  console.log('Admin projectId :', admin.app().options.projectId);
  console.log('Admin projNumber:', process.env.GCP_PROJECT_NUMBER);
}

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
  initAdmin();
  const DB = admin.firestore();

  const defaultTz = 'America/Mexico_City';
  const snap = await DB.collection('schedules').get();

  console.log(`📚 Found ${snap.size} schedule doc(s).`);

  let sendCount = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    // justo antes de: const token = data.token || doc.id;
    const docId = doc.id;
    const tokenField = data.token;
    console.log('📄 Doc:', docId.slice(0,12), '| token(field):', tokenField?.slice(0,12));

    // Usa campo token o (fallback) id del doc
   const token = data.token; // <- sin fallback
    if (!token) {
    console.log(`⚠️ Doc ${doc.id} sin campo token (ID es ${doc.id.slice(0,12)}…), se omite.`);
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

      // Ventanas T-10 y T-5 (tolerancia: -10 a +1 min)
      for (const minutesBefore of [10, 5]) {
        const execAt = start.clone().subtract(minutesBefore, 'minutes');
        const diffMin = execAt.diff(now, 'minutes');

        if (diffMin >= -10 && diffMin <= 1) {
          const title = `Clase: ${cls.materia ?? cls.nombre ?? 'Materia'}`;
          const body = `Empieza a las ${start.format('HH:mm')}${cls.salon ? ` • Salón ${cls.salon}` : ''}`;

          console.log(
            `📤 Enviando a ${token.slice(0, 12)}… | ${title} | T-${minutesBefore} | ${start.format()} (${tz})`
          );

          try {
            await admin.messaging().send({
              token,
              notification: { title, body },
              android: {
                priority: 'high',
                notification: { channelId: 'reminders', sound: 'default' },
                ttl: 40 * 60 * 1000,
              },
              apns: { payload: { aps: { alert: { title, body }, sound: 'default' } } },
              data: {
                type: 'class_reminder',
                minutesBefore: String(minutesBefore),
                classStartIso: start.toISOString(),
                materia: String(cls.materia ?? cls.nombre ?? ''),
              },
            });
            sendCount++;
          } catch (e) {
            // No detengas todo el job si un token falla
            console.error(`❌ Error enviando a ${token.slice(0,12)}…:`, e?.errorInfo?.code || e?.code || e.message);
          }
        }
      }
    }
  }

  console.log(sendCount ? `✅ Sent ${sendCount} notifications` : 'ℹ️ No notifications to send this tick.');
}

// Ejecuta como script
if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

// Exporta para pruebas (opcional)
module.exports = { run };




